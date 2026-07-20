from __future__ import annotations

import hashlib
import json
import unicodedata
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from ..models import RunRecord
from .base import QualityCheck, ScenarioDefinition, ScenarioEvalCase

TaskKind = Literal["formatting"]
WorkflowVariant = Literal["baseline", "hardened"]
Deliverable = Literal[
    "formatted_update",
    "executive_summary",
    "root_cause_analysis",
    "remediation_plan",
]
ModelTier = Literal["lightweight", "standard", "premium"]
GateMode = Literal["monitor", "enforce"]
ViolationCode = Literal[
    "unapproved_deliverable",
    "cost_cap_exceeded",
    "step_cap_exceeded",
    "premium_model_disallowed",
]


class StrictContract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ScopeBudgetAuthorizationV1(StrictContract):
    approved_deliverables: list[Literal["formatted_update"]] = Field(
        min_length=1, max_length=1
    )
    max_cost_cents: int = Field(ge=42, le=100)
    max_steps: Literal[2]
    premium_model_allowed: Literal[False]

    @field_validator("approved_deliverables")
    @classmethod
    def deliverables_are_unique(cls, value: list[Deliverable]) -> list[Deliverable]:
        if len(value) != len(set(value)):
            raise ValueError("approved_deliverables must not contain duplicates")
        return value


class GoldPlaterInputV1(StrictContract):
    request_id: str = Field(pattern=r"^GPL-[0-9]{4}$")
    task_kind: TaskKind
    instruction: str = Field(min_length=20, max_length=500)
    source_text: str = Field(min_length=40, max_length=2_000)
    required_facts: list[str] = Field(min_length=1, max_length=6)
    authorization: ScopeBudgetAuthorizationV1

    @field_validator("required_facts")
    @classmethod
    def facts_are_unique_and_grounded(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("required_facts must not contain duplicates")
        return value

    @model_validator(mode="after")
    def required_facts_exist_in_source(self) -> Self:
        missing = [fact for fact in self.required_facts if fact not in self.source_text]
        if missing:
            raise ValueError(f"required_facts are absent from source_text: {missing}")
        return self


def _input_fingerprint(request: GoldPlaterInputV1) -> str:
    canonical = json.dumps(
        request.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _violations(
    authorization: ScopeBudgetAuthorizationV1,
    deliverables: list[Deliverable],
    cost_cents: int,
    steps: int,
    model_tier: ModelTier,
) -> list[ViolationCode]:
    observed: list[ViolationCode] = []
    if not set(deliverables).issubset(authorization.approved_deliverables):
        observed.append("unapproved_deliverable")
    if cost_cents > authorization.max_cost_cents:
        observed.append("cost_cap_exceeded")
    if steps > authorization.max_steps:
        observed.append("step_cap_exceeded")
    if model_tier == "premium" and not authorization.premium_model_allowed:
        observed.append("premium_model_disallowed")
    return observed


class ScopedExecutionPlanV1(StrictContract):
    request_id: str = Field(pattern=r"^GPL-[0-9]{4}$")
    task_kind: TaskKind
    variant: WorkflowVariant
    input_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    authorization: ScopeBudgetAuthorizationV1
    planned_deliverables: list[Deliverable] = Field(min_length=1, max_length=4)
    model_tier: ModelTier
    estimated_cost_cents: int = Field(ge=1, le=20_000)
    execution_steps: int = Field(ge=1, le=30)
    gate_mode: GateMode
    violations: list[ViolationCode] = Field(default_factory=list, max_length=4)

    @field_validator("planned_deliverables")
    @classmethod
    def planned_deliverables_are_unique(cls, value: list[Deliverable]) -> list[Deliverable]:
        if len(value) != len(set(value)):
            raise ValueError("planned_deliverables must not contain duplicates")
        return value

    @model_validator(mode="after")
    def declare_and_enforce_scope_budget(self) -> Self:
        observed = _violations(
            self.authorization,
            self.planned_deliverables,
            self.estimated_cost_cents,
            self.execution_steps,
            self.model_tier,
        )
        if self.violations != observed:
            raise ValueError(f"violations must exactly declare observed violations: {observed}")
        expected_gate = "enforce" if self.variant == "hardened" else "monitor"
        if self.gate_mode != expected_gate:
            raise ValueError(
                f"{self.variant} plans require gate_mode={expected_gate!r}"
            )
        if self.gate_mode == "enforce" and observed:
            raise ValueError(f"enforced plans cannot proceed with violations: {observed}")
        return self


class GoldPlaterOutputV1(StrictContract):
    request_id: str = Field(pattern=r"^GPL-[0-9]{4}$")
    task_kind: TaskKind
    variant: WorkflowVariant
    input_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    authorization: ScopeBudgetAuthorizationV1
    delivered_deliverables: list[Deliverable] = Field(min_length=1, max_length=4)
    model_tier: ModelTier
    cost_cents: int = Field(ge=1, le=20_000)
    steps_used: int = Field(ge=1, le=30)
    gate_mode: GateMode
    violations: list[ViolationCode] = Field(default_factory=list, max_length=4)
    scope_status: Literal["within_scope", "expanded"]
    budget_status: Literal["within_budget", "exceeded"]
    declares_source_facts_preserved: bool
    result_text: str = Field(min_length=40, max_length=2_000)

    @field_validator("delivered_deliverables")
    @classmethod
    def delivered_items_are_unique(cls, value: list[Deliverable]) -> list[Deliverable]:
        if len(value) != len(set(value)):
            raise ValueError("delivered_deliverables must not contain duplicates")
        return value

    @model_validator(mode="after")
    def statuses_match_delivery_and_gate(self) -> Self:
        observed = _violations(
            self.authorization,
            self.delivered_deliverables,
            self.cost_cents,
            self.steps_used,
            self.model_tier,
        )
        if self.violations != observed:
            raise ValueError(f"violations must exactly declare observed violations: {observed}")
        expected_gate = "enforce" if self.variant == "hardened" else "monitor"
        if self.gate_mode != expected_gate:
            raise ValueError(
                f"{self.variant} outputs require gate_mode={expected_gate!r}"
            )
        expected_scope = (
            "expanded" if "unapproved_deliverable" in observed else "within_scope"
        )
        expected_budget = "exceeded" if "cost_cap_exceeded" in observed else "within_budget"
        if self.scope_status != expected_scope:
            raise ValueError(f"scope_status must be {expected_scope!r}")
        if self.budget_status != expected_budget:
            raise ValueError(f"budget_status must be {expected_budget!r}")
        if self.gate_mode == "enforce" and observed:
            raise ValueError(f"enforced outputs cannot contain violations: {observed}")
        return self


FIXTURE_INPUT: dict[str, Any] = {
    "request_id": "GPL-2048",
    "task_kind": "formatting",
    "instruction": (
        "Convert the incident update into concise bullets without adding analysis or "
        "changing any facts."
    ),
    "source_text": (
        "Checkout latency rose to 5 seconds. The rollback completed at 14:30 UTC."
    ),
    "required_facts": ["5 seconds", "14:30 UTC"],
    "authorization": {
        "approved_deliverables": ["formatted_update"],
        "max_cost_cents": 100,
        "max_steps": 2,
        "premium_model_allowed": False,
    },
}

DEFAULT_PRESET = "clean"
KNOWN_PRESETS = {"clean", "contract_drift", "typed_semantic_trap"}


def _selected_preset(fixture_preset: str | None) -> str:
    selected = fixture_preset or DEFAULT_PRESET
    if selected not in KNOWN_PRESETS:
        raise ValueError(f"Unknown Gold Plater fixture preset: {selected}")
    return selected


def build_handoff(
    variant: str,
    input_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    _selected_preset(fixture_preset)
    request = GoldPlaterInputV1.model_validate(input_data)
    if variant == "baseline":
        deliverables: list[Deliverable] = [
            "formatted_update",
            "root_cause_analysis",
            "remediation_plan",
        ]
        model_tier: ModelTier = "premium"
        cost_cents = 420
        steps = 6
        gate_mode: GateMode = "monitor"
    elif variant == "hardened":
        deliverables = list(request.authorization.approved_deliverables)
        model_tier = "lightweight"
        cost_cents = 42
        steps = 2
        gate_mode = "enforce"
    else:
        raise ValueError(f"Unknown Gold Plater variant: {variant}")

    plan = ScopedExecutionPlanV1(
        request_id=request.request_id,
        task_kind=request.task_kind,
        variant=variant,
        input_fingerprint=_input_fingerprint(request),
        authorization=request.authorization,
        planned_deliverables=deliverables,
        model_tier=model_tier,
        estimated_cost_cents=cost_cents,
        execution_steps=steps,
        gate_mode=gate_mode,
        violations=_violations(
            request.authorization,
            deliverables,
            cost_cents,
            steps,
            model_tier,
        ),
    )
    return plan.model_dump(mode="json")


def build_invalid_handoff(
    variant: str,
    input_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    invalid = build_handoff(variant, input_data, fixture_preset)
    invalid.pop("authorization")
    return invalid


def _format_as_bullets(source_text: str) -> str:
    sentences = _split_sentences(source_text)
    return "\n".join(f"- {sentence}." for sentence in sentences)


def _split_sentences(source_text: str) -> list[str]:
    """Split fixture prose without treating decimal points as sentence boundaries."""
    sentences: list[str] = []
    start = 0
    for index, character in enumerate(source_text):
        if character not in ".!?":
            continue
        if (
            character == "."
            and index > 0
            and index + 1 < len(source_text)
            and source_text[index - 1].isdigit()
            and source_text[index + 1].isdigit()
        ):
            continue
        if index + 1 < len(source_text) and not source_text[index + 1].isspace():
            continue
        sentence = source_text[start : index + 1].strip()
        if sentence:
            sentences.append(sentence.rstrip(".!?"))
        start = index + 1
    remainder = source_text[start:].strip()
    if remainder:
        sentences.append(remainder.rstrip(".!?"))
    return sentences


def _normalize_proposition(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    return " ".join(normalized.strip().rstrip(".!?").casefold().split())


def _bullet_propositions_match_source(result_text: str, source_text: str) -> bool:
    expected = [_normalize_proposition(value) for value in _split_sentences(source_text)]
    non_empty_lines = [line.strip() for line in result_text.splitlines() if line.strip()]
    if not non_empty_lines or any(not line.startswith("- ") for line in non_empty_lines):
        return False
    observed = [
        _normalize_proposition(line.removeprefix("- "))
        for line in non_empty_lines
    ]
    return (
        bool(expected)
        and len(observed) == len(expected)
        and len(set(observed)) == len(observed)
        and set(observed) == set(expected)
    )


def _assert_plan_matches_request(
    variant: str,
    request: GoldPlaterInputV1,
    plan: ScopedExecutionPlanV1,
) -> None:
    mismatches: list[str] = []
    if plan.variant != variant:
        mismatches.append("variant")
    if plan.request_id != request.request_id:
        mismatches.append("request_id")
    if plan.task_kind != request.task_kind:
        mismatches.append("task_kind")
    if plan.authorization != request.authorization:
        mismatches.append("authorization")
    if plan.input_fingerprint != _input_fingerprint(request):
        mismatches.append("input_fingerprint")
    if mismatches:
        raise ValueError(f"execution plan does not match input: {mismatches}")


def build_output(
    variant: str,
    input_data: dict[str, Any],
    handoff_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    preset = _selected_preset(fixture_preset)
    request = GoldPlaterInputV1.model_validate(input_data)
    plan = ScopedExecutionPlanV1.model_validate(handoff_data)
    if variant not in {"baseline", "hardened"}:
        raise ValueError(f"Unknown Gold Plater variant: {variant}")
    _assert_plan_matches_request(variant, request, plan)

    if preset == "typed_semantic_trap":
        result_text = _format_as_bullets(
            request.source_text.replace("5 seconds", "50 seconds")
        )
    elif variant == "baseline":
        result_text = (
            f"Formatted update:\n{_format_as_bullets(request.source_text)}\n\n"
            "Unrequested root-cause analysis: the database likely saturated.\n"
            "Unrequested remediation plan: migrate the checkout datastore."
        )
    else:
        result_text = _format_as_bullets(request.source_text)

    output = GoldPlaterOutputV1(
        request_id=request.request_id,
        task_kind=request.task_kind,
        variant=plan.variant,
        input_fingerprint=plan.input_fingerprint,
        authorization=plan.authorization,
        delivered_deliverables=plan.planned_deliverables,
        model_tier=plan.model_tier,
        cost_cents=plan.estimated_cost_cents,
        steps_used=plan.execution_steps,
        gate_mode=plan.gate_mode,
        violations=plan.violations,
        scope_status=(
            "expanded"
            if "unapproved_deliverable" in plan.violations
            else "within_scope"
        ),
        budget_status=(
            "exceeded" if "cost_cap_exceeded" in plan.violations else "within_budget"
        ),
        # Deliberately declaration-only: the semantic-trap fixture proves Pydantic cannot
        # inspect external truth merely because this field says the facts were preserved.
        declares_source_facts_preserved=True,
        result_text=result_text,
    )
    return output.model_dump(mode="json")


def evaluate_output(
    variant: str,
    input_data: dict[str, Any],
    output_data: dict[str, Any],
    fixture_preset: str | None,
) -> list[QualityCheck]:
    _selected_preset(fixture_preset)
    request = GoldPlaterInputV1.model_validate(input_data)
    try:
        output = GoldPlaterOutputV1.model_validate(output_data)
    except ValidationError as exc:
        return [
            QualityCheck(
                check_id="typed_output",
                title="Final output matches GoldPlaterOutputV1",
                passed=False,
                guarantee="contract",
                explanation=f"Pydantic rejected the final output: {exc.errors()}",
            )
        ]

    approved = set(request.authorization.approved_deliverables)
    delivered = set(output.delivered_deliverables)
    expected_fingerprint = _input_fingerprint(request)
    correlated = (
        output.request_id == request.request_id
        and output.task_kind == request.task_kind
        and output.variant == variant
        and output.authorization == request.authorization
        and output.input_fingerprint == expected_fingerprint
    )
    expected_gate = "enforce" if variant == "hardened" else "monitor"
    gate_matches_variant = output.gate_mode == expected_gate
    propositions_match = _bullet_propositions_match_source(
        output.result_text, request.source_text
    )
    formatted_update_present = (
        "formatted_update" in delivered
        and propositions_match
    )
    return [
        QualityCheck(
            check_id="typed_output",
            title="Final output matches GoldPlaterOutputV1",
            passed=True,
            guarantee="contract",
            explanation=(
                "Pydantic accepted the declared plan, statuses, and cross-field invariants. "
                "This does not make scope expansion or a false sentence acceptable."
            ),
        ),
        QualityCheck(
            check_id="input_correlation",
            title="Output is correlated to the exact authorized input",
            passed=correlated,
            guarantee="contract",
            explanation=(
                "Request ID, task kind, workflow variant, authorization, and canonical input "
                "fingerprint must all match the validated request."
            ),
        ),
        QualityCheck(
            check_id="gate_mode",
            title="Workflow variant uses the required policy gate",
            passed=gate_matches_variant,
            guarantee="policy",
            explanation=f"The {variant} variant requires gate_mode={expected_gate!r}.",
        ),
        QualityCheck(
            check_id="approved_scope_only",
            title="Only authorized deliverables were produced",
            passed=delivered.issubset(approved) and output.scope_status == "within_scope",
            guarantee="policy",
            explanation=(
                "The enforced gate kept delivery inside the user's explicit authorization."
                if delivered.issubset(approved)
                else "The schema-valid run produced deliverables the user never authorized."
            ),
        ),
        QualityCheck(
            check_id="budget_cap",
            title="Cost, steps, and model tier respect the budget contract",
            passed=(
                output.cost_cents <= request.authorization.max_cost_cents
                and output.steps_used <= request.authorization.max_steps
                and (
                    output.model_tier != "premium"
                    or request.authorization.premium_model_allowed
                )
            ),
            guarantee="policy",
            explanation=(
                f"Observed {output.cost_cents} cents and {output.steps_used} steps against "
                f"caps of {request.authorization.max_cost_cents} cents and "
                f"{request.authorization.max_steps} steps."
            ),
        ),
        QualityCheck(
            check_id="requested_work_complete",
            title="The requested formatted deliverable is semantically present",
            passed=approved.issubset(delivered) and formatted_update_present,
            guarantee="task_quality",
            explanation=(
                "Delivery metadata is insufficient: the result must contain bullet-formatted "
                "source facts for the only supported requested deliverable."
            ),
        ),
        QualityCheck(
            check_id="model_task_fit",
            title="The model tier matches task complexity",
            passed=output.model_tier == "lightweight",
            guarantee="task_quality",
            explanation=(
                f"A {request.task_kind} task expects lightweight; observed "
                f"{output.model_tier}."
            ),
        ),
        QualityCheck(
            check_id="source_fidelity",
            title="Formatted output exactly preserves source propositions",
            passed=propositions_match,
            guarantee="factuality",
            explanation=(
                "Normalized output bullets must equal the complete source proposition set: "
                "no changed values, contradictions, duplicates, omissions, or added bullets."
            ),
        ),
    ]


def _extract_output(run: RunRecord) -> GoldPlaterOutputV1 | None:
    candidates = [run.outputs.get("result"), run.outputs.get("output"), run.outputs]
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        try:
            return GoldPlaterOutputV1.model_validate(candidate)
        except ValidationError:
            continue
    return None


def _run_identity(
    run: RunRecord,
    *,
    variant: WorkflowVariant,
    preset: str,
) -> dict[str, bool]:
    return {
        "scenario_matches": run.scenario_id == "gold-plater",
        "variant_matches": run.variant == variant,
        "fixture_preset_matches": run.fixture_preset == preset,
        "run_succeeded": run.terminal_status == "succeeded",
    }


def _error_mentions_field(error: dict[str, Any], field: str) -> bool:
    location = error.get("loc", [])
    return field in {str(part) for part in location}


def _producer_messages_show_authorization_retry(messages: list[dict[str, Any]]) -> bool:
    invalid_calls: list[tuple[int, dict[str, Any]]] = []
    retry_prompts: list[tuple[int, dict[str, Any]]] = []
    repaired_calls: list[tuple[int, dict[str, Any]]] = []
    required_plan_keys = {
        "request_id",
        "task_kind",
        "variant",
        "input_fingerprint",
        "planned_deliverables",
        "model_tier",
        "estimated_cost_cents",
        "execution_steps",
        "gate_mode",
        "violations",
    }
    for message_index, message in enumerate(messages):
        parts = message.get("parts", [])
        if not isinstance(parts, list):
            return False
        for part in parts:
            if not isinstance(part, dict):
                continue
            kind = part.get("part_kind")
            if kind == "tool-call" and isinstance(part.get("args"), dict):
                arguments = part["args"]
                if required_plan_keys.issubset(arguments) and "authorization" not in arguments:
                    invalid_calls.append((message_index, part))
                elif "authorization" in arguments:
                    repaired_calls.append((message_index, part))
            elif kind == "retry-prompt":
                retry_prompts.append((message_index, part))

    for invalid_index, invalid in invalid_calls:
        invalid_call_id = invalid.get("tool_call_id")
        for retry_index, retry in retry_prompts:
            content = retry.get("content")
            retry_names_authorization = isinstance(content, list) and any(
                isinstance(error, dict)
                and _error_mentions_field(error, "authorization")
                and error.get("type") == "missing"
                for error in content
            )
            if not (
                invalid_index < retry_index
                and invalid_call_id
                and retry.get("tool_call_id") == invalid_call_id
                and retry_names_authorization
            ):
                continue
            for repaired_index, repaired in repaired_calls:
                if repaired_index <= retry_index:
                    continue
                try:
                    ScopedExecutionPlanV1.model_validate(repaired["args"])
                except ValidationError:
                    continue
                return True
    return False


def _producer_retry_is_evidenced(run: RunRecord) -> bool:
    retry_event = any(
        event.node_id == "producer"
        and event.kind == "agent_output_retry"
        and bool(event.validation_errors)
        and event.metadata.get("enforcement_layer") == "pydantic_ai"
        and event.metadata.get("repaired") is True
        for event in run.events
    )
    invocation = any(
        item.node_id == "producer"
        and item.output_contract.name == "ScopedExecutionPlanV1"
        and item.request_count >= 2
        and _producer_messages_show_authorization_retry(item.serialized_messages)
        for item in run.agent_invocations
    )
    evidence = any(
        item.node_id == "producer"
        and item.layer == "agent_output"
        and item.contract_name == "ScopedExecutionPlanV1"
        and item.status == "repaired"
        and item.attempt >= 2
        and any(
            _error_mentions_field(error, "authorization")
            for error in item.validation_errors
        )
        for item in run.pydantic_evidence
    )
    return retry_event and invocation and evidence


def _consumer_invocation_matches_output(run: RunRecord) -> bool:
    expected_output = run.outputs.get("result")
    if not isinstance(expected_output, dict):
        return False
    for invocation in run.agent_invocations:
        if not (
            invocation.node_id == "consumer"
            and invocation.output_contract.name == "GoldPlaterOutputV1"
            and invocation.request_count == 1
        ):
            continue
        for message in invocation.serialized_messages:
            parts = message.get("parts", [])
            if not isinstance(parts, list):
                continue
            for part in parts:
                if not (
                    isinstance(part, dict)
                    and part.get("part_kind") == "tool-call"
                    and isinstance(part.get("args"), dict)
                ):
                    continue
                try:
                    parsed = GoldPlaterOutputV1.model_validate(part["args"])
                except ValidationError:
                    continue
                if parsed.model_dump(mode="json") == expected_output:
                    return True
    return False


def _typed_consumer_output_is_evidenced(run: RunRecord) -> bool:
    pydantic_evidence = any(
        item.node_id == "consumer"
        and item.layer == "agent_output"
        and item.contract_name == "GoldPlaterOutputV1"
        and item.status == "passed"
        and bool(item.output_snapshot)
        for item in run.pydantic_evidence
    )
    return pydantic_evidence and _consumer_invocation_matches_output(run)


def _quality_check_has_state(run: RunRecord, check_id: str, passed: bool) -> bool:
    checks = run.outputs.get("quality_checks", [])
    return any(
        isinstance(check, dict)
        and check.get("check_id") == check_id
        and check.get("passed") is passed
        for check in checks
    )


def _quality_evidence_has_state(
    run: RunRecord,
    *,
    title: str,
    passed: bool,
    guarantee: str,
) -> bool:
    expected_status = "passed" if passed else "failed"
    return any(
        item.node_id == "quality"
        and item.layer == "task_quality"
        and item.title == title
        and item.status == expected_status
        and item.guarantee == guarantee
        and bool(item.output_snapshot)
        for item in run.pydantic_evidence
    )


def _output_correlates_to_fixture(
    output: GoldPlaterOutputV1 | None,
    variant: WorkflowVariant,
) -> bool:
    request = GoldPlaterInputV1.model_validate(FIXTURE_INPUT)
    return bool(
        output
        and output.request_id == request.request_id
        and output.task_kind == request.task_kind
        and output.variant == variant
        and output.authorization == request.authorization
        and output.input_fingerprint == _input_fingerprint(request)
    )


def _eval_baseline_overbuild(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    assertions = _run_identity(run, variant="baseline", preset="clean")
    assertions.update({
        "producer_model_retry_evidenced": _producer_retry_is_evidenced(run),
        "typed_consumer_output_evidenced": _typed_consumer_output_is_evidenced(run),
        "typed_output_returned": output is not None,
        "output_correlates_to_input": _output_correlates_to_fixture(output, "baseline"),
        "scope_expansion_is_explicit": bool(output and output.scope_status == "expanded"),
        "budget_overrun_is_explicit": bool(output and output.budget_status == "exceeded"),
        "premium_model_violation_recorded": bool(
            output and "premium_model_disallowed" in output.violations
        ),
        "scope_failure_recorded": _quality_check_has_state(
            run, "approved_scope_only", False
        )
        and _quality_evidence_has_state(
            run,
            title="Only authorized deliverables were produced",
            passed=False,
            guarantee="policy",
        ),
        "budget_failure_recorded": _quality_check_has_state(run, "budget_cap", False)
        and _quality_evidence_has_state(
            run,
            title="Cost, steps, and model tier respect the budget contract",
            passed=False,
            guarantee="policy",
        ),
        "task_quality_failed": bool(run.metrics and run.metrics.task_pass is False),
    })
    return assertions


def _eval_hardened_scope_gate(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    assertions = _run_identity(run, variant="hardened", preset="clean")
    assertions.update({
        "producer_model_retry_evidenced": _producer_retry_is_evidenced(run),
        "typed_consumer_output_evidenced": _typed_consumer_output_is_evidenced(run),
        "typed_output_returned": output is not None,
        "output_correlates_to_input": _output_correlates_to_fixture(output, "hardened"),
        "enforced_gate_used": bool(output and output.gate_mode == "enforce"),
        "scope_is_preserved": bool(output and output.scope_status == "within_scope"),
        "budget_is_enforced": bool(output and output.budget_status == "within_budget"),
        "no_policy_violations": bool(output and not output.violations),
        "lightweight_model_selected": bool(output and output.model_tier == "lightweight"),
        "all_quality_checks_passed": bool(
            run.metrics
            and run.metrics.task_pass is True
            and run.outputs.get("quality_checks")
            and all(check.get("passed") is True for check in run.outputs["quality_checks"])
        ),
    })
    return assertions


def _eval_contract_drift_repair(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    fault_event = any(
        event.node_id == "edge_validator"
        and event.kind == "fault_injected"
        and event.metadata.get("hook") == "post_output_pre_edge"
        and event.metadata.get("mutation") == "drop authorization"
        for event in run.events
    )
    rejection_event = any(
        event.node_id == "edge_validator"
        and event.kind == "edge_contract_rejected"
        and bool(event.validation_errors)
        and event.metadata.get("enforcement_layer") == "pydantic_type_adapter"
        and event.metadata.get("bounded_revision") is True
        for event in run.events
    )
    edge_evidence = any(
        item.node_id == "edge_validator"
        and item.layer == "edge_contract"
        and item.contract_name == "ScopedExecutionPlanV1"
        and item.status == "repaired"
        and any(
            _error_mentions_field(error, "authorization")
            for error in item.validation_errors
        )
        for item in run.pydantic_evidence
    )
    assertions = _run_identity(run, variant="hardened", preset="contract_drift")
    assertions.update({
        "producer_model_retry_evidenced": _producer_retry_is_evidenced(run),
        "typed_consumer_output_evidenced": _typed_consumer_output_is_evidenced(run),
        "authorization_drop_injected": fault_event,
        "type_adapter_rejected_drift": rejection_event,
        "edge_repair_evidence_names_authorization": edge_evidence,
        "final_contract_passed": bool(run.metrics and run.metrics.final_contract_pass),
        "task_quality_passed": bool(run.metrics and run.metrics.task_pass is True),
        "output_correlates_to_input": _output_correlates_to_fixture(output, "hardened"),
    })
    return assertions


def _eval_typed_semantic_trap(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    factuality_failure = _quality_check_has_state(run, "source_fidelity", False)
    factuality_evidence = _quality_evidence_has_state(
        run,
        title="Formatted output exactly preserves source propositions",
        passed=False,
        guarantee="factuality",
    )
    assertions = _run_identity(run, variant="hardened", preset="typed_semantic_trap")
    assertions.update({
        "producer_model_retry_evidenced": _producer_retry_is_evidenced(run),
        "typed_consumer_output_evidenced": _typed_consumer_output_is_evidenced(run),
        "schema_accepted_output": output is not None,
        "output_correlates_to_input": _output_correlates_to_fixture(output, "hardened"),
        "typed_truth_claim_is_present": bool(
            output and output.declares_source_facts_preserved
        ),
        "independent_check_detects_wrong_fact": bool(
            output
            and "50 seconds" in output.result_text
            and "5 seconds" not in output.result_text
        ),
        "factuality_failure_recorded": factuality_failure and factuality_evidence,
        "task_quality_failed": bool(run.metrics and run.metrics.task_pass is False),
    })
    return assertions


definition = ScenarioDefinition(
    scenario_id="gold-plater",
    title="The Gold Plater",
    summary=(
        "Expose schema-valid overbuilding, then enforce the user's deliverable, cost, step, "
        "and model-tier authorization with strict Pydantic contracts."
    ),
    input_model=GoldPlaterInputV1,
    handoff_model=ScopedExecutionPlanV1,
    output_model=GoldPlaterOutputV1,
    fixture_input=FIXTURE_INPUT,
    producer_name="Scope and Budget Planner",
    consumer_name="Right-Sized Task Executor",
    build_handoff=build_handoff,
    build_invalid_handoff=build_invalid_handoff,
    build_output=build_output,
    evaluate_output=evaluate_output,
    edge_fault_field="authorization",
    fixture_presets={
        "clean": (
            "Compare a schema-valid premium overbuild with an enforced, right-sized delivery."
        ),
        "contract_drift": (
            "Remove the authorization after planning so the edge TypeAdapter must reject it."
        ),
        "typed_semantic_trap": (
            "Return a perfectly typed result that changes 5 seconds to 50 seconds; factuality "
            "evaluation must catch what schema validation cannot."
        ),
    },
    pydantic_lessons=(
        "Strict input models reject coercion, unknown fields, duplicate deliverables, and "
        "required facts that are absent from the source.",
        "A model-level validator recomputes scope, cost, step, and premium-model violations "
        "instead of trusting self-reported policy status.",
        "Monitor mode can validly represent a bad plan for observability; enforce mode rejects "
        "the same violations before execution.",
        "The edge TypeAdapter revalidates authorization after the Pydantic AI agent returns, "
        "covering post-output contract drift.",
        "Pydantic proves structure and declared invariants, not truth: a typed fidelity claim "
        "can accompany a sentence that changes 5 seconds to 50 seconds.",
    ),
    eval_cases=(
        ScenarioEvalCase(
            name="gold_plater_baseline_overbuild",
            version="1.0",
            description=(
                "The baseline is contract-valid while visibly exceeding scope and budget."
            ),
            variant="baseline",
            fixture_preset="clean",
            evaluate=_eval_baseline_overbuild,
        ),
        ScenarioEvalCase(
            name="gold_plater_hardened_scope_gate",
            version="1.0",
            description="The enforced plan preserves requested work and all explicit caps.",
            variant="hardened",
            fixture_preset="clean",
            evaluate=_eval_hardened_scope_gate,
        ),
        ScenarioEvalCase(
            name="gold_plater_contract_drift_repair",
            version="1.0",
            description="A missing authorization is rejected and repaired at the graph edge.",
            variant="hardened",
            fixture_preset="contract_drift",
            evaluate=_eval_contract_drift_repair,
        ),
        ScenarioEvalCase(
            name="gold_plater_typed_semantic_trap",
            version="1.0",
            description=(
                "A schema-valid fidelity claim fails independent fixture-grounded evaluation."
            ),
            variant="hardened",
            fixture_preset="typed_semantic_trap",
            evaluate=_eval_typed_semantic_trap,
        ),
    ),
)


__all__ = [
    "FIXTURE_INPUT",
    "GoldPlaterInputV1",
    "GoldPlaterOutputV1",
    "ScopeBudgetAuthorizationV1",
    "ScopedExecutionPlanV1",
    "definition",
]
