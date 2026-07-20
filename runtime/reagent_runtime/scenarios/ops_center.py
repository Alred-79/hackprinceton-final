from __future__ import annotations

from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ..models import RunRecord
from .base import QualityCheck, ScenarioDefinition, ScenarioEvalCase

AutomationScope = Literal["incident:read", "traffic:manage", "notify:write"]
HumanOnlyScope = Literal["deploy:rollback", "service:restart"]
OperationalScope = AutomationScope | HumanOnlyScope
PolicyViolation = Literal[
    "dependency_order",
    "duplicate_effect",
    "unauthorized_scope",
    "missing_human_escalation",
]


class StrictContract(BaseModel):
    """Ops Center contracts reject coercion and undeclared operational fields."""

    model_config = ConfigDict(extra="forbid", strict=True)


class OpsIncidentInputV1(StrictContract):
    incident_id: str = Field(pattern=r"^INC-[0-9]{4}$")
    service: str = Field(pattern=r"^[a-z][a-z0-9-]{2,40}$")
    severity: Literal["sev1", "sev2"]
    symptoms: list[str] = Field(min_length=1, max_length=8)
    active_deployment_id: str = Field(pattern=r"^deploy-[a-z0-9-]{3,48}$")
    authorized_automation_scopes: list[AutomationScope] = Field(min_length=1)
    human_only_scopes: list[HumanOnlyScope] = Field(min_length=1)
    incident_commander: str = Field(min_length=3, max_length=80)
    approval_state: Literal["not_requested", "pending"]
    pending_approval_ref: str | None = Field(
        default=None,
        pattern=r"^APR-[0-9]{4}$",
    )

    @model_validator(mode="after")
    def scopes_and_symptoms_are_unambiguous(self) -> Self:
        if len(self.symptoms) != len(set(self.symptoms)):
            raise ValueError("symptoms must not contain duplicates")
        if len(self.authorized_automation_scopes) != len(
            set(self.authorized_automation_scopes)
        ):
            raise ValueError("authorized_automation_scopes must not contain duplicates")
        if len(self.human_only_scopes) != len(set(self.human_only_scopes)):
            raise ValueError("human_only_scopes must not contain duplicates")
        if set(self.authorized_automation_scopes) & set(self.human_only_scopes):
            raise ValueError("automation and human-only scopes must be disjoint")
        if self.approval_state == "pending" and self.pending_approval_ref is None:
            raise ValueError("pending approval_state requires pending_approval_ref proof")
        if self.approval_state == "not_requested" and self.pending_approval_ref is not None:
            raise ValueError(
                "pending_approval_ref is only valid when approval_state='pending'"
            )
        return self


class ObserveActionV1(StrictContract):
    kind: Literal["observe"]
    action_id: str = Field(pattern=r"^act-[a-z0-9-]{3,48}$")
    target: str = Field(min_length=3, max_length=80)
    depends_on: list[str] = Field(default_factory=list, max_length=4)
    idempotency_key: str = Field(pattern=r"^INC-[0-9]{4}:[a-z0-9:-]{3,80}$")
    required_scope: Literal["incident:read"]
    execution_mode: Literal["automated"]
    status: Literal["ready"]


class NotifyActionV1(StrictContract):
    kind: Literal["notify"]
    action_id: str = Field(pattern=r"^act-[a-z0-9-]{3,48}$")
    target: str = Field(min_length=3, max_length=80)
    depends_on: list[str] = Field(default_factory=list, max_length=4)
    idempotency_key: str = Field(pattern=r"^INC-[0-9]{4}:[a-z0-9:-]{3,80}$")
    required_scope: Literal["notify:write"]
    execution_mode: Literal["automated"]
    status: Literal["ready"]
    message: str = Field(min_length=16, max_length=300)


class MutationActionV1(StrictContract):
    kind: Literal["mutate"]
    action_id: str = Field(pattern=r"^act-[a-z0-9-]{3,48}$")
    target: str = Field(min_length=3, max_length=80)
    depends_on: list[str] = Field(default_factory=list, max_length=4)
    idempotency_key: str = Field(pattern=r"^INC-[0-9]{4}:[a-z0-9:-]{3,80}$")
    required_scope: OperationalScope
    operation: Literal["drain_traffic", "rollback_deploy", "restart_service"]
    execution_mode: Literal["automated", "human_gate"]
    approval_ref: str | None = Field(default=None, pattern=r"^APR-[0-9]{4}$")
    status: Literal["ready", "blocked_by_approval"]

    @model_validator(mode="after")
    def approval_fields_match_execution_mode(self) -> Self:
        expected_scope: dict[str, OperationalScope] = {
            "drain_traffic": "traffic:manage",
            "rollback_deploy": "deploy:rollback",
            "restart_service": "service:restart",
        }
        if self.required_scope != expected_scope[self.operation]:
            raise ValueError(
                f"{self.operation} requires scope {expected_scope[self.operation]}"
            )
        if self.execution_mode == "human_gate":
            if self.approval_ref is None or self.status != "blocked_by_approval":
                raise ValueError(
                    "human_gate mutations require approval_ref and blocked_by_approval"
                )
        elif self.approval_ref is not None or self.status != "ready":
            raise ValueError("automated mutations must be ready and omit approval_ref")
        return self


class ApprovalRequestActionV1(StrictContract):
    kind: Literal["request_approval"]
    action_id: str = Field(pattern=r"^act-[a-z0-9-]{3,48}$")
    target: str = Field(min_length=3, max_length=80)
    depends_on: list[str] = Field(default_factory=list, max_length=4)
    idempotency_key: str = Field(pattern=r"^INC-[0-9]{4}:[a-z0-9:-]{3,80}$")
    required_scope: HumanOnlyScope
    execution_mode: Literal["human_gate"]
    approval_ref: str = Field(pattern=r"^APR-[0-9]{4}$")
    approver_role: Literal["incident_commander"]
    status: Literal["requested", "already_pending"]
    reason: str = Field(min_length=16, max_length=300)


OpsActionV1 = Annotated[
    ObserveActionV1 | NotifyActionV1 | MutationActionV1 | ApprovalRequestActionV1,
    Field(discriminator="kind"),
]


class OperationalPlanV1(StrictContract):
    incident_id: str = Field(pattern=r"^INC-[0-9]{4}$")
    plan_version: Literal["1"]
    actions: list[OpsActionV1] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def identifiers_and_dependency_references_are_valid(self) -> Self:
        action_ids = [action.action_id for action in self.actions]
        if len(action_ids) != len(set(action_ids)):
            raise ValueError("action_id values must be unique")
        idempotency_keys = [action.idempotency_key for action in self.actions]
        if len(idempotency_keys) != len(set(idempotency_keys)):
            raise ValueError("idempotency_key values must be unique")
        key_prefix = f"{self.incident_id}:"
        if any(not key.startswith(key_prefix) for key in idempotency_keys):
            raise ValueError("every idempotency_key must be bound to plan incident_id")
        known_ids = set(action_ids)
        for action in self.actions:
            if len(action.depends_on) != len(set(action.depends_on)):
                raise ValueError(f"{action.action_id} contains duplicate dependencies")
            if action.action_id in action.depends_on:
                raise ValueError(f"{action.action_id} cannot depend on itself")
            missing = set(action.depends_on) - known_ids
            if missing:
                raise ValueError(
                    f"{action.action_id} references unknown dependencies: {sorted(missing)}"
                )
        return self


class OpsCenterHandoffV1(StrictContract):
    incident_id: str = Field(pattern=r"^INC-[0-9]{4}$")
    planner: Literal["legacy_ops_agent", "policy_aware_ops_agent"]
    plan: OperationalPlanV1
    rationale: str = Field(min_length=20, max_length=500)

    @model_validator(mode="after")
    def plan_belongs_to_incident(self) -> Self:
        if self.plan.incident_id != self.incident_id:
            raise ValueError("handoff incident_id must match plan incident_id")
        return self


class HumanEscalationV1(StrictContract):
    approval_ref: str = Field(pattern=r"^APR-[0-9]{4}$")
    blocked_action_id: str = Field(pattern=r"^act-[a-z0-9-]{3,48}$")
    required_scope: HumanOnlyScope
    approver: str = Field(min_length=3, max_length=80)
    reason: str = Field(min_length=16, max_length=300)


class ExecutionStepV1(StrictContract):
    action_id: str = Field(pattern=r"^act-[a-z0-9-]{3,48}$")
    disposition: Literal["executed", "blocked"]
    side_effect: bool
    note: str = Field(min_length=12, max_length=300)

    @model_validator(mode="after")
    def blocked_steps_do_not_claim_side_effects(self) -> Self:
        if self.disposition == "blocked" and self.side_effect:
            raise ValueError("blocked steps cannot report side effects")
        return self


class OpsCenterResultV1(StrictContract):
    incident_id: str = Field(pattern=r"^INC-[0-9]{4}$")
    outcome: Literal["contained", "awaiting_human", "unsafe_execution"]
    plan: OperationalPlanV1
    executed_action_ids: list[str] = Field(max_length=12)
    blocked_action_ids: list[str] = Field(max_length=12)
    execution_log: list[ExecutionStepV1] = Field(min_length=1, max_length=12)
    human_escalation: HumanEscalationV1 | None
    policy_violations: list[PolicyViolation] = Field(max_length=8)
    duplicate_effects: list[str] = Field(max_length=8)
    contract_note: Literal[
        "Pydantic accepted structure; operational policy is evaluated separately"
    ]

    @model_validator(mode="after")
    def execution_state_is_internally_coherent(self) -> Self:
        planned = {action.action_id: action for action in self.plan.actions}
        executed = set(self.executed_action_ids)
        blocked = set(self.blocked_action_ids)
        if self.incident_id != self.plan.incident_id:
            raise ValueError("result incident_id must match plan incident_id")
        if len(self.executed_action_ids) != len(executed):
            raise ValueError("executed_action_ids must be unique")
        if len(self.blocked_action_ids) != len(blocked):
            raise ValueError("blocked_action_ids must be unique")
        if executed & blocked:
            raise ValueError("an action cannot be both executed and blocked")
        if executed | blocked != set(planned):
            raise ValueError(
                "every planned action must appear exactly once as executed or blocked"
            )
        log_ids = [step.action_id for step in self.execution_log]
        if len(log_ids) != len(set(log_ids)) or set(log_ids) != executed | blocked:
            raise ValueError("execution_log must cover executed and blocked actions once")
        logged_executed = [
            step.action_id
            for step in self.execution_log
            if step.disposition == "executed"
        ]
        logged_blocked = [
            step.action_id
            for step in self.execution_log
            if step.disposition == "blocked"
        ]
        if logged_executed != self.executed_action_ids:
            raise ValueError(
                "executed_action_ids order must match executed entries in execution_log"
            )
        if logged_blocked != self.blocked_action_ids:
            raise ValueError(
                "blocked_action_ids order must match blocked entries in execution_log"
            )
        log_positions = {
            step.action_id: index for index, step in enumerate(self.execution_log)
        }
        for step in self.execution_log:
            action = planned[step.action_id]
            expected = "executed" if step.action_id in executed else "blocked"
            if step.disposition != expected:
                raise ValueError("execution_log disposition does not match action lists")
            expected_disposition = (
                "blocked"
                if isinstance(action, MutationActionV1)
                and action.status == "blocked_by_approval"
                else "executed"
            )
            if step.disposition != expected_disposition:
                raise ValueError(
                    "execution_log disposition does not match modeled action status"
                )
            expected_side_effect = isinstance(action, NotifyActionV1) or (
                isinstance(action, MutationActionV1)
                and step.disposition == "executed"
            )
            if step.side_effect != expected_side_effect:
                raise ValueError(
                    "execution_log side_effect does not match modeled action semantics"
                )
            for dependency in action.depends_on:
                if dependency not in executed:
                    raise ValueError(
                        "an action cannot run or block before its dependency executes"
                    )
                if log_positions[dependency] >= log_positions[action.action_id]:
                    raise ValueError(
                        "execution_log order must place dependencies before actions"
                    )
        for action_id in executed:
            action = planned[action_id]
            if (
                isinstance(action, MutationActionV1)
                and action.status == "blocked_by_approval"
            ):
                raise ValueError("approval-blocked mutations cannot be reported as executed")
        if self.outcome == "awaiting_human":
            if self.human_escalation is None or not blocked:
                raise ValueError("awaiting_human requires an escalation and blocked action")
            if self.human_escalation.blocked_action_id not in blocked:
                raise ValueError("human escalation must identify a blocked action")
            if blocked != {self.human_escalation.blocked_action_id}:
                raise ValueError(
                    "every blocked action must be covered by the returned escalation"
                )
            escalated = planned[self.human_escalation.blocked_action_id]
            if not isinstance(escalated, MutationActionV1):
                raise ValueError("human escalation must identify a mutating action")
            if (
                escalated.approval_ref != self.human_escalation.approval_ref
                or escalated.required_scope != self.human_escalation.required_scope
            ):
                raise ValueError(
                    "human escalation approval_ref and scope must match the blocked action"
                )
            approval_requests = [
                action
                for action in self.plan.actions
                if isinstance(action, ApprovalRequestActionV1)
                and action.approval_ref == self.human_escalation.approval_ref
                and action.required_scope == self.human_escalation.required_scope
            ]
            if len(approval_requests) != 1:
                raise ValueError(
                    "human escalation requires one matching approval-request action"
                )
        else:
            if self.human_escalation is not None:
                raise ValueError("only awaiting_human results may include human_escalation")
            if blocked:
                raise ValueError("blocked actions require outcome='awaiting_human'")
        if self.outcome == "unsafe_execution" and not self.policy_violations:
            raise ValueError("unsafe_execution requires explicit policy_violations")
        if self.outcome != "unsafe_execution" and self.policy_violations:
            raise ValueError("safe outcomes cannot include policy_violations")
        return self


FIXTURE_INPUT: dict[str, Any] = OpsIncidentInputV1(
    incident_id="INC-2042",
    service="checkout-api",
    severity="sev1",
    symptoms=["error rate above 18%", "p99 latency above 4 seconds"],
    active_deployment_id="deploy-checkout-7f3",
    authorized_automation_scopes=["incident:read", "traffic:manage", "notify:write"],
    human_only_scopes=["deploy:rollback", "service:restart"],
    incident_commander="Morgan Lee",
    approval_state="not_requested",
    pending_approval_ref=None,
).model_dump(mode="json")


def _selected_preset(fixture_preset: str | None) -> str:
    selected = fixture_preset or "schema_valid_policy_trap"
    allowed = {
        "clean",
        "contract_drift",
        "schema_valid_policy_trap",
        "duplicate_replay",
        "out_of_order",
    }
    if selected not in allowed:
        raise ValueError(f"Unknown Ops Center fixture preset: {selected}")
    return selected


def _action_common(
    incident_id: str,
    action_id: str,
    target: str,
    suffix: str,
    depends_on: list[str],
) -> dict[str, Any]:
    return {
        "action_id": action_id,
        "target": target,
        "depends_on": depends_on,
        "idempotency_key": f"{incident_id}:{suffix}",
    }


def _observe_action(request: OpsIncidentInputV1) -> dict[str, Any]:
    return {
        "kind": "observe",
        **_action_common(
            request.incident_id,
            "act-diagnose",
            request.service,
            "observe:checkout",
            [],
        ),
        "required_scope": "incident:read",
        "execution_mode": "automated",
        "status": "ready",
    }


def _notify_action(
    request: OpsIncidentInputV1,
    *,
    action_id: str,
    suffix: str,
    depends_on: list[str],
    message: str,
) -> dict[str, Any]:
    return {
        "kind": "notify",
        **_action_common(
            request.incident_id,
            action_id,
            request.incident_commander,
            suffix,
            depends_on,
        ),
        "required_scope": "notify:write",
        "execution_mode": "automated",
        "status": "ready",
        "message": message,
    }


def _gated_recovery_actions(
    request: OpsIncidentInputV1,
    *,
    operation: Literal["rollback_deploy", "restart_service"],
    dependency: str,
) -> list[dict[str, Any]]:
    canonical_approval_ref = f"APR-{request.incident_id.removeprefix('INC-')}"
    approval_ref = request.pending_approval_ref or canonical_approval_ref
    approval_status = (
        "already_pending" if request.approval_state == "pending" else "requested"
    )
    if operation == "rollback_deploy":
        scope: HumanOnlyScope = "deploy:rollback"
        target = request.active_deployment_id
        label = "rollback"
    else:
        scope = "service:restart"
        target = request.service
        label = "restart"
    request_id = f"act-request-{label}"
    return [
        {
            "kind": "request_approval",
            **_action_common(
                request.incident_id,
                request_id,
                target,
                f"approval:{label}",
                [dependency],
            ),
            "required_scope": scope,
            "execution_mode": "human_gate",
            "approval_ref": approval_ref,
            "approver_role": "incident_commander",
            "status": approval_status,
            "reason": f"Production {label} is human-only and requires commander approval.",
        },
        {
            "kind": "mutate",
            **_action_common(
                request.incident_id,
                f"act-{label}",
                target,
                f"{label}:approved-effect",
                [request_id],
            ),
            "required_scope": scope,
            "operation": operation,
            "execution_mode": "human_gate",
            "approval_ref": approval_ref,
            "status": "blocked_by_approval",
        },
    ]


def _hardened_actions(
    request: OpsIncidentInputV1,
    preset: str,
) -> list[dict[str, Any]]:
    observe = _observe_action(request)
    if preset == "clean":
        drain = {
            "kind": "mutate",
            **_action_common(
                request.incident_id,
                "act-drain-traffic",
                request.service,
                "drain:checkout",
                ["act-diagnose"],
            ),
            "required_scope": "traffic:manage",
            "operation": "drain_traffic",
            "execution_mode": "automated",
            "approval_ref": None,
            "status": "ready",
        }
        notify = _notify_action(
            request,
            action_id="act-notify-contained",
            suffix="notify:contained",
            depends_on=["act-drain-traffic"],
            message="Checkout traffic was safely drained within the automation policy.",
        )
        return [observe, drain, notify]
    if preset == "duplicate_replay":
        return [
            observe,
            *_gated_recovery_actions(
                request,
                operation="restart_service",
                dependency="act-diagnose",
            ),
        ]
    if preset == "contract_drift":
        notify = _notify_action(
            request,
            action_id="act-notify-boundary",
            suffix="notify:boundary",
            depends_on=["act-diagnose"],
            message="The typed plan will be checked again at the executor boundary.",
        )
        return [
            observe,
            notify,
            *_gated_recovery_actions(
                request,
                operation="rollback_deploy",
                dependency="act-notify-boundary",
            ),
        ]
    if preset == "out_of_order":
        notify = _notify_action(
            request,
            action_id="act-notify-ordered",
            suffix="notify:ordered",
            depends_on=["act-diagnose"],
            message="Diagnosis now precedes the privileged rollback approval path.",
        )
        return [
            observe,
            notify,
            *_gated_recovery_actions(
                request,
                operation="rollback_deploy",
                dependency="act-notify-ordered",
            ),
        ]
    return [
        observe,
        *_gated_recovery_actions(
            request,
            operation="rollback_deploy",
            dependency="act-diagnose",
        ),
    ]


def _baseline_actions(
    request: OpsIncidentInputV1,
    preset: str,
) -> list[dict[str, Any]]:
    observe = _observe_action(request)
    if preset == "clean":
        drain = {
            "kind": "mutate",
            **_action_common(
                request.incident_id,
                "act-drain-traffic",
                request.service,
                "drain:checkout",
                ["act-diagnose"],
            ),
            "required_scope": "traffic:manage",
            "operation": "drain_traffic",
            "execution_mode": "automated",
            "approval_ref": None,
            "status": "ready",
        }
        notify = _notify_action(
            request,
            action_id="act-notify-contained",
            suffix="notify:contained",
            depends_on=["act-drain-traffic"],
            message="Checkout traffic was drained by the legacy executor.",
        )
        return [observe, drain, notify]
    rollback = {
        "kind": "mutate",
        **_action_common(
            request.incident_id,
            "act-rollback",
            request.active_deployment_id,
            "rollback:attempt-1",
            ["act-diagnose"],
        ),
        "required_scope": "deploy:rollback",
        "operation": "rollback_deploy",
        "execution_mode": "automated",
        "approval_ref": None,
        "status": "ready",
    }
    if preset == "out_of_order":
        return [rollback, observe]
    if preset == "duplicate_replay":
        restart_one = {
            "kind": "mutate",
            **_action_common(
                request.incident_id,
                "act-restart-one",
                request.service,
                "restart:attempt-1",
                ["act-diagnose"],
            ),
            "required_scope": "service:restart",
            "operation": "restart_service",
            "execution_mode": "automated",
            "approval_ref": None,
            "status": "ready",
        }
        restart_two = {
            "kind": "mutate",
            **_action_common(
                request.incident_id,
                "act-restart-two",
                request.service,
                "restart:attempt-2",
                ["act-restart-one"],
            ),
            "required_scope": "service:restart",
            "operation": "restart_service",
            "execution_mode": "automated",
            "approval_ref": None,
            "status": "ready",
        }
        return [observe, restart_one, restart_two]
    return [observe, rollback]


def build_handoff(
    variant: str,
    input_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    request = OpsIncidentInputV1.model_validate(input_data)
    preset = _selected_preset(fixture_preset)
    if variant == "hardened":
        planner: Literal["legacy_ops_agent", "policy_aware_ops_agent"] = (
            "policy_aware_ops_agent"
        )
        actions = _hardened_actions(request, preset)
        rationale = {
            "clean": (
                "Contain the incident with the explicitly authorized traffic-management scope."
            ),
            "contract_drift": (
                "Revalidate the plan at the edge before blocking rollback on human approval."
            ),
            "schema_valid_policy_trap": (
                "Replace an unauthorized typed rollback with an explicit human approval gate."
            ),
            "duplicate_replay": (
                "Collapse duplicate restart intent into one idempotent human-gated action."
            ),
            "out_of_order": (
                "Topologically order diagnosis before requesting approval for rollback."
            ),
        }[preset]
    elif variant == "baseline":
        planner = "legacy_ops_agent"
        actions = _baseline_actions(request, preset)
        rationale = (
            "The legacy planner emits structurally valid actions but treats declared scopes, "
            "dependency order, and semantic duplicate effects as executor concerns."
        )
    else:
        raise ValueError(f"Unknown Ops Center variant: {variant}")
    handoff = OpsCenterHandoffV1(
        incident_id=request.incident_id,
        planner=planner,
        plan={
            "incident_id": request.incident_id,
            "plan_version": "1",
            "actions": actions,
        },
        rationale=rationale,
    )
    return handoff.model_dump(mode="json")


def build_invalid_handoff(
    variant: str,
    input_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    invalid = build_handoff(variant, input_data, fixture_preset)
    actions = invalid["plan"]["actions"]
    actions[1]["idempotency_key"] = actions[0]["idempotency_key"]
    return invalid


def _dependency_ordered(plan: OperationalPlanV1) -> bool:
    positions = {action.action_id: index for index, action in enumerate(plan.actions)}
    return all(
        positions[dependency] < positions[action.action_id]
        for action in plan.actions
        for dependency in action.depends_on
    )


def _topologically_ordered_actions(plan: OperationalPlanV1) -> list[Any]:
    ordered: list[Any] = []
    completed: set[str] = set()
    remaining = list(plan.actions)
    while remaining:
        ready = [
            action
            for action in remaining
            if set(action.depends_on).issubset(completed)
        ]
        if not ready:
            raise ValueError("operational plan contains a dependency cycle")
        for action in ready:
            ordered.append(action)
            completed.add(action.action_id)
            remaining.remove(action)
    return ordered


def _duplicate_mutation_effects(plan: OperationalPlanV1) -> list[str]:
    seen: set[tuple[str, str]] = set()
    duplicates: list[str] = []
    for action in plan.actions:
        if not isinstance(action, MutationActionV1):
            continue
        signature = (action.operation, action.target)
        if signature in seen:
            duplicates.append(f"{action.operation}:{action.target}")
        seen.add(signature)
    return duplicates


def _unsafe_executed_mutations(
    request: OpsIncidentInputV1,
    plan: OperationalPlanV1,
    executed_ids: set[str],
) -> list[MutationActionV1]:
    human_only = set(request.human_only_scopes)
    return [
        action
        for action in plan.actions
        if isinstance(action, MutationActionV1)
        and action.action_id in executed_ids
        and action.required_scope in human_only
    ]


def _unauthorized_automated_actions(
    request: OpsIncidentInputV1,
    plan: OperationalPlanV1,
    executed_ids: set[str],
) -> list[ObserveActionV1 | NotifyActionV1 | MutationActionV1]:
    authorized = set(request.authorized_automation_scopes)
    return [
        action
        for action in plan.actions
        if isinstance(action, (ObserveActionV1, NotifyActionV1, MutationActionV1))
        and action.action_id in executed_ids
        and action.execution_mode == "automated"
        and action.required_scope not in authorized
    ]


def build_output(
    variant: str,
    input_data: dict[str, Any],
    handoff_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    _selected_preset(fixture_preset)
    request = OpsIncidentInputV1.model_validate(input_data)
    handoff = OpsCenterHandoffV1.model_validate(handoff_data)
    if handoff.incident_id != request.incident_id:
        raise ValueError("handoff incident_id does not match input incident_id")
    actions = handoff.plan.actions
    execution_order = _topologically_ordered_actions(handoff.plan)
    if variant == "hardened":
        executed_ids = [
            action.action_id
            for action in execution_order
            if not (
                isinstance(action, MutationActionV1)
                and action.status == "blocked_by_approval"
            )
        ]
        blocked_ids = [
            action.action_id
            for action in execution_order
            if isinstance(action, MutationActionV1)
            and action.status == "blocked_by_approval"
        ]
        if blocked_ids:
            blocked_action = next(
                action
                for action in actions
                if isinstance(action, MutationActionV1)
                and action.action_id == blocked_ids[0]
            )
            escalation: dict[str, Any] | None = {
                "approval_ref": blocked_action.approval_ref,
                "blocked_action_id": blocked_action.action_id,
                "required_scope": blocked_action.required_scope,
                "approver": request.incident_commander,
                "reason": (
                    "The recovery mutation remains blocked until the incident commander "
                    "approves it."
                ),
            }
            outcome = "awaiting_human"
        else:
            escalation = None
            outcome = "contained"
        violations: list[PolicyViolation] = []
        duplicates: list[str] = []
    elif variant == "baseline":
        executed_ids = [action.action_id for action in execution_order]
        blocked_ids = []
        escalation = None
        violations = []
        if not _dependency_ordered(handoff.plan):
            violations.append("dependency_order")
        duplicates = _duplicate_mutation_effects(handoff.plan)
        if duplicates:
            violations.append("duplicate_effect")
        executed_set = set(executed_ids)
        unauthorized = _unauthorized_automated_actions(
            request, handoff.plan, executed_set
        )
        unsafe_human_mutations = _unsafe_executed_mutations(
            request, handoff.plan, executed_set
        )
        if unauthorized:
            violations.append("unauthorized_scope")
        if unsafe_human_mutations:
            violations.append("missing_human_escalation")
        outcome = "unsafe_execution" if violations else "contained"
    else:
        raise ValueError(f"Unknown Ops Center variant: {variant}")
    log = []
    for action in execution_order:
        blocked = action.action_id in blocked_ids
        if blocked:
            note = "Execution was stopped at the explicit human approval boundary."
        elif isinstance(action, ObserveActionV1):
            note = "Read-only incident observation completed without a side effect."
        elif isinstance(action, ApprovalRequestActionV1):
            note = (
                "The existing pending approval was reused without issuing a new request."
                if action.status == "already_pending"
                else "The typed approval request was recorded without executing recovery."
            )
        else:
            note = "The fixture executor recorded this deterministic side effect."
        log.append(
            {
                "action_id": action.action_id,
                "disposition": "blocked" if blocked else "executed",
                "side_effect": (
                    isinstance(action, NotifyActionV1)
                    or (isinstance(action, MutationActionV1) and not blocked)
                ),
                "note": note,
            }
        )
    output = OpsCenterResultV1(
        incident_id=request.incident_id,
        outcome=outcome,
        plan=handoff.plan,
        executed_action_ids=executed_ids,
        blocked_action_ids=blocked_ids,
        execution_log=log,
        human_escalation=escalation,
        policy_violations=violations,
        duplicate_effects=duplicates,
        contract_note=(
            "Pydantic accepted structure; operational policy is evaluated separately"
        ),
    )
    return output.model_dump(mode="json")


def evaluate_output(
    variant: str,
    input_data: dict[str, Any],
    output_data: dict[str, Any],
    fixture_preset: str | None,
) -> list[QualityCheck]:
    preset = _selected_preset(fixture_preset)
    request = OpsIncidentInputV1.model_validate(input_data)
    try:
        output = OpsCenterResultV1.model_validate(output_data)
    except ValidationError as exc:
        return [
            QualityCheck(
                check_id="strict_pydantic_contract",
                title="Result satisfies OpsCenterResultV1",
                passed=False,
                guarantee="contract",
                explanation=f"Pydantic rejected the result: {exc.errors()}",
            )
        ]
    executed = set(output.executed_action_ids)
    continuity = output.incident_id == request.incident_id
    complete_accounting = (
        executed | set(output.blocked_action_ids)
        == {action.action_id for action in output.plan.actions}
    )
    ordered = _dependency_ordered(output.plan)
    duplicates = _duplicate_mutation_effects(output.plan)
    unauthorized = _unauthorized_automated_actions(request, output.plan, executed)
    human_mutations = [
        action
        for action in output.plan.actions
        if isinstance(action, MutationActionV1)
        and action.required_scope in set(request.human_only_scopes)
    ]
    approval_actions = [
        action
        for action in output.plan.actions
        if isinstance(action, ApprovalRequestActionV1)
    ]
    gated = bool(human_mutations) and all(
        action.execution_mode == "human_gate"
        and action.status == "blocked_by_approval"
        and action.action_id in output.blocked_action_ids
        for action in human_mutations
    )
    if not human_mutations:
        escalation_complete = output.human_escalation is None
    else:
        escalation = output.human_escalation
        gated_action = human_mutations[0] if len(human_mutations) == 1 else None
        approval_matches = bool(
            gated_action
            and escalation
            and escalation.blocked_action_id == gated_action.action_id
            and escalation.approval_ref == gated_action.approval_ref
            and escalation.required_scope == gated_action.required_scope
            and escalation.approver == request.incident_commander
            and escalation.required_scope in set(request.human_only_scopes)
        )
        request_matches = bool(
            escalation
            and sum(
                isinstance(action, ApprovalRequestActionV1)
                and action.approval_ref == escalation.approval_ref
                and action.required_scope == escalation.required_scope
                and action.approver_role == "incident_commander"
                for action in output.plan.actions
            )
            == 1
        )
        escalation_complete = gated and approval_matches and request_matches
    if not approval_actions:
        approval_state_continuity = request.approval_state == "not_requested"
    else:
        expected_approval_status = (
            "already_pending"
            if request.approval_state == "pending"
            else "requested"
        )
        expected_approval_ref = (
            request.pending_approval_ref
            if request.approval_state == "pending"
            else f"APR-{request.incident_id.removeprefix('INC-')}"
        )
        approval_state_continuity = bool(expected_approval_ref) and all(
            action.status == expected_approval_status
            and action.approval_ref == expected_approval_ref
            for action in approval_actions
        )
        approval_state_continuity = approval_state_continuity and all(
            action.approval_ref == expected_approval_ref
            for action in human_mutations
        )
        if output.human_escalation is not None:
            approval_state_continuity = (
                approval_state_continuity
                and output.human_escalation.approval_ref == expected_approval_ref
            )
    action_ids = {action.action_id for action in output.plan.actions}
    if preset == "clean":
        preset_shape = (
            "act-drain-traffic" in action_ids
            and output.outcome == "contained"
            and output.human_escalation is None
        )
    elif preset == "duplicate_replay":
        if variant == "baseline":
            preset_shape = {
                "act-restart-one",
                "act-restart-two",
            }.issubset(action_ids)
        else:
            preset_shape = (
                "act-restart" in action_ids
                and "act-restart-two" not in action_ids
                and output.outcome == "awaiting_human"
            )
    else:
        preset_shape = "act-rollback" in action_ids
        if variant == "hardened":
            preset_shape = preset_shape and output.outcome == "awaiting_human"
    task_pass = (
        output.outcome != "unsafe_execution"
        and not output.policy_violations
        and continuity
        and complete_accounting
        and not unauthorized
        and escalation_complete
        and approval_state_continuity
        and preset_shape
    )
    return [
        QualityCheck(
            check_id="strict_pydantic_contract",
            title="Result satisfies OpsCenterResultV1",
            passed=True,
            guarantee="contract",
            explanation=(
                "Pydantic accepted strict discriminated actions and a coherent execution result; "
                "this does not prove that the plan obeyed operational policy."
            ),
        ),
        QualityCheck(
            check_id="incident_continuity",
            title="Input, plan, and result identify the same incident",
            passed=continuity,
            guarantee="contract",
            explanation=(
                "The result and every idempotency key remain bound to the input incident."
                if continuity
                else "The result incident_id does not match the validated input incident_id."
            ),
        ),
        QualityCheck(
            check_id="complete_action_accounting",
            title="Every planned action has exactly one disposition and log entry",
            passed=complete_accounting,
            guarantee="contract",
            explanation=(
                "Executed and blocked sets form an exact partition of the typed plan."
                if complete_accounting
                else "At least one planned action is missing or multiply accounted for."
            ),
        ),
        QualityCheck(
            check_id="dependency_order",
            title="Dependencies precede the actions that consume them",
            passed=ordered,
            guarantee="policy",
            explanation=(
                "Every dependency appears earlier in the sequence."
                if ordered
                else "At least one action was emitted before its declared dependency."
            ),
        ),
        QualityCheck(
            check_id="semantic_idempotency",
            title="Mutating effects are semantically idempotent",
            passed=not duplicates,
            guarantee="policy",
            explanation=(
                "No operation/target pair is repeated."
                if not duplicates
                else f"Distinct keys hide repeated effects: {duplicates}."
            ),
        ),
        QualityCheck(
            check_id="authorization",
            title="Every executed automated action has an authorized exact scope",
            passed=not unauthorized,
            guarantee="policy",
            explanation=(
                "Every automated action used an allowed scope bound to its operation."
                if not unauthorized
                else (
                    "Executed actions outside authorized automation scope: "
                    + ", ".join(action.action_id for action in unauthorized)
                )
            ),
        ),
        QualityCheck(
            check_id="human_escalation",
            title="Human-only recovery has an explicit approval boundary",
            passed=escalation_complete,
            guarantee="policy",
            explanation=(
                "The mutation is blocked and linked to an incident-commander approval."
                if escalation_complete
                else "A human-only mutation lacks a complete approval escalation."
            ),
        ),
        QualityCheck(
            check_id="approval_state_continuity",
            title="Approval evidence matches the validated input state",
            passed=approval_state_continuity,
            guarantee="policy",
            explanation=(
                "Approval status and reference match across input, plan, mutation, and result."
                if approval_state_continuity
                else (
                    "Approval status or reference was substituted between input and output."
                )
            ),
        ),
        QualityCheck(
            check_id="preset_trajectory",
            title="The run executed the selected guided fixture trajectory",
            passed=preset_shape,
            guarantee="task_quality",
            explanation=(
                f"The {preset!r} action/result signature is present."
                if preset_shape
                else f"The result does not match the {preset!r} fixture trajectory."
            ),
        ),
        QualityCheck(
            check_id="task_success",
            title="Incident response made safe operational progress",
            passed=task_pass,
            guarantee="task_quality",
            explanation=(
                "The run diagnosed and escalated without unsafe side effects."
                if task_pass
                else "The workflow produced schema-valid output after unsafe side effects."
            ),
        ),
    ]


def _result(run: RunRecord) -> dict[str, Any]:
    value = run.outputs.get("result", {})
    return value if isinstance(value, dict) else {}


def _quality(run: RunRecord) -> dict[str, bool]:
    values = run.outputs.get("quality_checks", [])
    return {
        item["check_id"]: bool(item["passed"])
        for item in values
        if isinstance(item, dict) and "check_id" in item
    }


def _eval_runtime_evidence(
    run: RunRecord,
    *,
    expected_variant: Literal["baseline", "hardened"],
    expected_preset: str,
    edge_repair_expected: bool = False,
) -> dict[str, bool]:
    quality_values = run.outputs.get("quality_checks", [])
    quality_items = [item for item in quality_values if isinstance(item, dict)]
    retry_events = [
        event for event in run.events if event.kind == "agent_output_retry"
    ]
    edge_rejections = [
        event for event in run.events if event.kind == "edge_contract_rejected"
    ]
    edge_status = "repaired" if edge_repair_expected else "passed"
    return {
        "exact_scenario": run.scenario_id == "ops-center",
        "exact_variant": run.variant == expected_variant,
        "exact_fixture_preset": run.fixture_preset == expected_preset,
        "terminal_status_succeeded": run.terminal_status == "succeeded",
        "producer_retry_event_has_errors": bool(retry_events)
        and all(event.validation_errors for event in retry_events),
        "producer_invocation_retried": any(
            invocation.node_id == "producer" and invocation.request_count >= 2
            for invocation in run.agent_invocations
        ),
        "input_pydantic_evidence": any(
            item.node_id == "input"
            and item.layer == "input_contract"
            and item.contract_name == "OpsIncidentInputV1"
            and item.status == "passed"
            for item in run.pydantic_evidence
        ),
        "model_retry_pydantic_evidence": any(
            item.node_id == "producer"
            and item.layer == "agent_output"
            and item.contract_name == "OpsCenterHandoffV1"
            and item.status == "repaired"
            and bool(item.validation_errors)
            for item in run.pydantic_evidence
        ),
        "edge_type_adapter_evidence": any(
            item.node_id == "edge_validator"
            and item.layer == "edge_contract"
            and item.contract_name == "OpsCenterHandoffV1"
            and item.status == edge_status
            for item in run.pydantic_evidence
        ),
        "edge_event_matches_fixture": (
            bool(edge_rejections)
            and any(event.kind == "fault_injected" for event in run.events)
        )
        if edge_repair_expected
        else not edge_rejections,
        "final_output_pydantic_evidence": any(
            item.node_id == "consumer"
            and item.layer == "agent_output"
            and item.contract_name == "OpsCenterResultV1"
            and item.status == "passed"
            for item in run.pydantic_evidence
        ),
        "quality_output_is_structured": bool(quality_items)
        and len(quality_items) == len(quality_values)
        and len({item.get("check_id") for item in quality_items})
        == len(quality_items)
        and all(
            isinstance(item.get("passed"), bool)
            and isinstance(item.get("explanation"), str)
            for item in quality_items
        ),
        "quality_pydantic_evidence_complete": sum(
            item.node_id == "quality" and item.layer == "task_quality"
            for item in run.pydantic_evidence
        )
        == len(quality_items),
        "final_contract_metric_passed": bool(
            run.metrics and run.metrics.final_contract_pass
        ),
    }


def _eval_schema_valid_policy_trap(run: RunRecord) -> dict[str, bool]:
    result = _result(run)
    quality = _quality(run)
    return {
        **_eval_runtime_evidence(
            run,
            expected_variant="baseline",
            expected_preset="schema_valid_policy_trap",
        ),
        "strict_contract_green": quality.get("strict_pydantic_contract") is True,
        "authorization_failed_independently": quality.get("authorization") is False,
        "task_failed_independently": quality.get("task_success") is False,
        "unsafe_effects_are_explicit": result.get("outcome") == "unsafe_execution",
    }


def _eval_duplicate_and_idempotency(run: RunRecord) -> dict[str, bool]:
    result = _result(run)
    quality = _quality(run)
    duplicates = result.get("duplicate_effects", [])
    return {
        **_eval_runtime_evidence(
            run,
            expected_variant="baseline",
            expected_preset="duplicate_replay",
        ),
        "contract_remained_valid": quality.get("strict_pydantic_contract") is True,
        "semantic_duplicate_detected": bool(duplicates),
        "idempotency_policy_failed": quality.get("semantic_idempotency") is False,
        "duplicate_violation_recorded": "duplicate_effect"
        in result.get("policy_violations", []),
    }


def _eval_dependency_order(run: RunRecord) -> dict[str, bool]:
    result = _result(run)
    quality = _quality(run)
    return {
        **_eval_runtime_evidence(
            run,
            expected_variant="baseline",
            expected_preset="out_of_order",
        ),
        "contract_remained_valid": quality.get("strict_pydantic_contract") is True,
        "dependency_policy_failed": quality.get("dependency_order") is False,
        "ordering_violation_recorded": "dependency_order"
        in result.get("policy_violations", []),
        "task_was_not_false_positive": quality.get("task_success") is False,
    }


def _eval_human_gate_safety(run: RunRecord) -> dict[str, bool]:
    result = _result(run)
    quality = _quality(run)
    escalation = result.get("human_escalation")
    return {
        **_eval_runtime_evidence(
            run,
            expected_variant="hardened",
            expected_preset="schema_valid_policy_trap",
        ),
        "human_only_action_blocked": "act-rollback"
        in result.get("blocked_action_ids", []),
        "human_only_action_not_executed": "act-rollback"
        not in result.get("executed_action_ids", []),
        "explicit_escalation_returned": isinstance(escalation, dict)
        and escalation.get("approval_ref") == "APR-2042",
        "authorization_check_passed": quality.get("authorization") is True,
        "human_gate_check_passed": quality.get("human_escalation") is True,
    }


def _eval_safe_task_success(run: RunRecord) -> dict[str, bool]:
    result = _result(run)
    quality = _quality(run)
    return {
        **_eval_runtime_evidence(
            run,
            expected_variant="hardened",
            expected_preset="clean",
        ),
        "safe_outcome_returned": result.get("outcome") == "contained",
        "authorized_containment_executed": "act-drain-traffic"
        in result.get("executed_action_ids", []),
        "no_policy_violations": result.get("policy_violations") == [],
        "all_quality_checks_passed": bool(quality) and all(quality.values()),
        "task_metric_passed": bool(run.metrics and run.metrics.task_pass),
    }


def _eval_edge_contract_repair(run: RunRecord) -> dict[str, bool]:
    return {
        **_eval_runtime_evidence(
            run,
            expected_variant="hardened",
            expected_preset="contract_drift",
            edge_repair_expected=True,
        ),
        "repaired_plan_reached_quality_checks": _quality(run).get(
            "strict_pydantic_contract"
        )
        is True,
        "task_still_passed_after_bounded_repair": bool(
            run.metrics and run.metrics.task_pass
        ),
    }


definition = ScenarioDefinition(
    scenario_id="ops-center",
    title="The Ops Center",
    summary=(
        "Stress-test incident automation with strict Pydantic action contracts plus separate "
        "idempotency, dependency-order, authorization, and human-escalation checks."
    ),
    input_model=OpsIncidentInputV1,
    handoff_model=OpsCenterHandoffV1,
    output_model=OpsCenterResultV1,
    fixture_input=FIXTURE_INPUT,
    producer_name="IncidentPlanner",
    consumer_name="PolicyAwareExecutor",
    build_handoff=build_handoff,
    build_invalid_handoff=build_invalid_handoff,
    build_output=build_output,
    evaluate_output=evaluate_output,
    edge_fault_field="plan",
    fixture_presets={
        "clean": (
            "Diagnose, drain traffic with an authorized automation scope, and notify the "
            "incident commander without requiring a privileged mutation."
        ),
        "contract_drift": (
            "Drop the validated plan after agent output; the edge TypeAdapter shows the exact "
            "missing-field error before bounded repair."
        ),
        "schema_valid_policy_trap": (
            "Emit a fully typed automated rollback whose declared scope is human-only; the "
            "schema passes while policy and task checks fail."
        ),
        "duplicate_replay": (
            "Issue the same service restart twice under distinct valid IDs and idempotency keys "
            "to demonstrate semantic duplicate detection."
        ),
        "out_of_order": (
            "Place rollback before its declared diagnosis dependency; references are valid but "
            "the operational-order evaluator fails."
        ),
    },
    pydantic_lessons=(
        "Strict mode and extra='forbid' reject coercion and undeclared operational fields.",
        "Discriminated action unions make observation, notification, mutation, and approval "
        "payloads inspectable instead of accepting arbitrary JSON.",
        "Model validators enforce unique action IDs, unique exact idempotency keys, valid "
        "dependency references, dependency-safe execution order, and action-specific "
        "side-effect logs.",
        "Pending approval state requires a typed approval reference; unsupported approved "
        "claims are rejected instead of silently issuing another request.",
        "Pydantic AI ModelRetry repairs a duplicate exact idempotency key before a plan crosses "
        "the producer boundary.",
        "A second edge TypeAdapter catches post-agent contract drift independently of ModelRetry.",
        "Schema validity cannot infer semantic duplicates, execution order, or authorization; "
        "those remain explicit policy and task-quality evaluations.",
    ),
    eval_cases=(
        ScenarioEvalCase(
            name="ops_schema_valid_policy_trap",
            version="1.0",
            description=(
                "Prove a strictly typed automated rollback can pass schema validation while "
                "authorization and task checks fail."
            ),
            variant="baseline",
            fixture_preset="schema_valid_policy_trap",
            evaluate=_eval_schema_valid_policy_trap,
        ),
        ScenarioEvalCase(
            name="ops_semantic_idempotency",
            version="1.0",
            description=(
                "Detect a duplicated restart effect even though action IDs and exact keys are "
                "individually valid and unique."
            ),
            variant="baseline",
            fixture_preset="duplicate_replay",
            evaluate=_eval_duplicate_and_idempotency,
        ),
        ScenarioEvalCase(
            name="ops_dependency_order",
            version="1.0",
            description=(
                "Separate valid dependency references from the policy that dependencies must "
                "precede dependent actions."
            ),
            variant="baseline",
            fixture_preset="out_of_order",
            evaluate=_eval_dependency_order,
        ),
        ScenarioEvalCase(
            name="ops_human_gate_safety",
            version="1.0",
            description=(
                "Block a human-only rollback and return an explicit incident-commander approval "
                "request without executing the side effect."
            ),
            variant="hardened",
            fixture_preset="schema_valid_policy_trap",
            evaluate=_eval_human_gate_safety,
        ),
        ScenarioEvalCase(
            name="ops_safe_task_success",
            version="1.0",
            description=(
                "Treat safe diagnosis and escalation as task success rather than claiming the "
                "incident is resolved before approval."
            ),
            variant="hardened",
            fixture_preset="clean",
            evaluate=_eval_safe_task_success,
        ),
        ScenarioEvalCase(
            name="ops_edge_contract_drift",
            version="1.0",
            description=(
                "Remove the plan after producer validation and verify the edge TypeAdapter's "
                "separate rejection and repair evidence."
            ),
            variant="hardened",
            fixture_preset="contract_drift",
            evaluate=_eval_edge_contract_repair,
        ),
    ),
)


__all__ = [
    "ApprovalRequestActionV1",
    "ExecutionStepV1",
    "HumanEscalationV1",
    "MutationActionV1",
    "OperationalPlanV1",
    "OpsCenterHandoffV1",
    "OpsCenterResultV1",
    "OpsIncidentInputV1",
    "definition",
]
