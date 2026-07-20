from __future__ import annotations

from typing import Annotated, Any, ClassVar, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..models import RunRecord, stable_hash
from .base import QualityCheck, ScenarioDefinition, ScenarioEvalCase

SupportCategory = Literal[
    "refund",
    "shipping",
    "billing",
    "password",
    "product",
    "complaint",
    "general",
]
HandlerPool = Literal[
    "refund_agent",
    "shipping_agent",
    "billing_agent",
    "password_agent",
    "product_agent",
    "complaint_agent",
    "general_agent",
    "routine_support",
    "case_resolution",
]
ModelProfile = Literal["efficient", "premium"]
ShipmentStatus = Literal["label_created", "in_transit", "delivered", "delayed"]


class SupportQueryV1(BaseModel):
    """Trusted fixture input for one customer-support routing decision."""

    model_config = ConfigDict(extra="forbid", strict=True)

    ticket_id: str = Field(pattern=r"^SUP-[0-9]{4}$")
    customer_id: str = Field(pattern=r"^CUS-[0-9]{4}$")
    query: str = Field(min_length=12, max_length=500)
    category: SupportCategory
    priority: Literal["normal", "urgent"] = "normal"
    order_id: str | None = Field(default=None, pattern=r"^ORD-[0-9]{4}$")
    observed_shipping_status: ShipmentStatus | None = None

    @model_validator(mode="after")
    def require_category_context(self) -> Self:
        if self.category in {"refund", "shipping"} and self.order_id is None:
            raise ValueError(f"{self.category} queries require an order_id")
        if self.category == "shipping" and self.observed_shipping_status is None:
            raise ValueError("shipping fixtures require an observed carrier status")
        if self.category != "shipping" and self.observed_shipping_status is not None:
            raise ValueError("observed_shipping_status is only valid for shipping queries")
        return self


class SupportRouteV1(BaseModel):
    """Typed router-to-handler handoff for either workflow variant."""

    model_config = ConfigDict(extra="forbid", strict=True)

    _SPECIALIST_BY_CATEGORY: ClassVar[dict[str, str]] = {
        "refund": "refund_agent",
        "shipping": "shipping_agent",
        "billing": "billing_agent",
        "password": "password_agent",
        "product": "product_agent",
        "complaint": "complaint_agent",
        "general": "general_agent",
    }
    _ROUTINE_CATEGORIES: ClassVar[set[str]] = {
        "shipping",
        "password",
        "product",
        "general",
    }
    _CASE_CATEGORIES: ClassVar[set[str]] = {"refund", "billing", "complaint"}
    _REQUIRED_ACTION: ClassVar[dict[str, str]] = {
        "refund": "issue_refund",
        "shipping": "track_shipment",
        "billing": "escalate_case",
        "password": "reset_password",
        "product": "respond",
        "complaint": "escalate_case",
        "general": "respond",
    }

    ticket_id: str = Field(pattern=r"^SUP-[0-9]{4}$")
    category: SupportCategory
    order_id: str = Field(pattern=r"^ORD-[0-9]{4}$")
    variant: Literal["baseline", "hardened"]
    input_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    handler_pool: HandlerPool
    model_profile: ModelProfile
    allowed_actions: list[
        Literal[
            "issue_refund",
            "track_shipment",
            "reset_password",
            "escalate_case",
            "respond",
        ]
    ] = Field(min_length=1, max_length=3)
    estimated_context_tokens: int = Field(ge=64, le=20_000)

    @model_validator(mode="after")
    def enforce_route_and_tool_scope(self) -> Self:
        if len(self.allowed_actions) != len(set(self.allowed_actions)):
            raise ValueError("allowed_actions must not contain duplicates")

        specialist = self._SPECIALIST_BY_CATEGORY[self.category]
        if self.handler_pool.endswith("_agent") and self.handler_pool != specialist:
            raise ValueError(
                f"{self.category} must use {specialist}, not {self.handler_pool}"
            )
        if (
            self.handler_pool == "routine_support"
            and self.category not in self._ROUTINE_CATEGORIES
        ):
            raise ValueError(f"{self.category} cannot use the routine_support pool")
        if (
            self.handler_pool == "case_resolution"
            and self.category not in self._CASE_CATEGORIES
        ):
            raise ValueError(f"{self.category} cannot use the case_resolution pool")

        expected_profile = "efficient" if self.handler_pool == "routine_support" else "premium"
        if self.model_profile != expected_profile:
            raise ValueError(
                f"{self.handler_pool} requires the {expected_profile} model profile"
            )
        required_action = self._REQUIRED_ACTION[self.category]
        if required_action not in self.allowed_actions:
            raise ValueError(f"{self.category} routes must allow {required_action}")
        return self


class TrackingActionV1(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["track_shipment"]
    order_id: str = Field(pattern=r"^ORD-[0-9]{4}$")
    shipment_status: ShipmentStatus


class RefundActionV1(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["issue_refund"]
    order_id: str = Field(pattern=r"^ORD-[0-9]{4}$")
    amount_cents: int = Field(gt=0, le=100_000)
    idempotency_key: str = Field(pattern=r"^refund:SUP-[0-9]{4}$")


class EscalationActionV1(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["escalate_case"]
    queue: Literal["billing_review", "customer_care"]
    reason: str = Field(min_length=12, max_length=240)


class ResponseActionV1(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["respond"]
    topic: str = Field(min_length=3, max_length=80)


SupportActionV1 = Annotated[
    TrackingActionV1 | RefundActionV1 | EscalationActionV1 | ResponseActionV1,
    Field(discriminator="kind"),
]


class ToolPolicyDecisionV1(BaseModel):
    """A typed pre-execution selection decision, never an execution receipt."""

    model_config = ConfigDict(extra="forbid", strict=True)

    boundary: Literal["pre_execution_selection"]
    requested_action: Literal["issue_refund", "track_shipment"]
    selected_action: Literal["issue_refund", "track_shipment"]
    decision: Literal["allowed", "blocked", "unsafe_selection"]
    reason_code: Literal["scope_match", "not_in_allowed_actions", "scope_check_absent"]
    tool_execution_count: Literal[0]

    @model_validator(mode="after")
    def enforce_decision_semantics(self) -> Self:
        expected = {
            "allowed": ("track_shipment", "track_shipment", "scope_match"),
            "blocked": ("issue_refund", "track_shipment", "not_in_allowed_actions"),
            "unsafe_selection": ("issue_refund", "issue_refund", "scope_check_absent"),
        }[self.decision]
        observed = (self.requested_action, self.selected_action, self.reason_code)
        if observed != expected:
            raise ValueError(f"{self.decision} policy decision must encode {expected}")
        return self


class SupportResolutionV1(BaseModel):
    """Handler output; structural validity intentionally does not prove fixture truth."""

    model_config = ConfigDict(extra="forbid", strict=True)

    _CANONICAL_REPLIES: ClassVar[dict[str, str]] = {
        "carrier_in_transit": (
            "Carrier fixture confirms the shipment is in transit with normal delivery."
        ),
        "carrier_delayed": "Carrier status is delayed; contact support again tomorrow.",
        "unsafe_refund_selected": (
            "Baseline selected issue_refund outside shipping scope; execution was not performed."
        ),
        "refund_selection_blocked": (
            "Policy blocked issue_refund before execution and selected track_shipment."
        ),
    }

    ticket_id: str = Field(pattern=r"^SUP-[0-9]{4}$")
    category: SupportCategory
    order_id: str = Field(pattern=r"^ORD-[0-9]{4}$")
    variant: Literal["baseline", "hardened"]
    input_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    handler_pool: HandlerPool
    model_profile: ModelProfile
    status: Literal["resolved", "escalated"]
    reply_code: Literal[
        "carrier_in_transit",
        "carrier_delayed",
        "unsafe_refund_selected",
        "refund_selection_blocked",
    ]
    reply: str = Field(min_length=16, max_length=600)
    action: SupportActionV1
    tool_policy: ToolPolicyDecisionV1
    estimated_output_tokens: int = Field(ge=16, le=4_000)

    @model_validator(mode="after")
    def enforce_action_shape(self) -> Self:
        allowed_types: dict[str, tuple[type[BaseModel], ...]] = {
            "refund": (RefundActionV1, EscalationActionV1),
            # RefundActionV1 is structurally valid for the product-wide action union.
            # Whether this shipping handler was authorized to use it is a separate
            # policy guarantee evaluated from the typed route's tool scope.
            "shipping": (TrackingActionV1, RefundActionV1),
            "billing": (EscalationActionV1,),
            "password": (ResponseActionV1,),
            "product": (ResponseActionV1,),
            "complaint": (EscalationActionV1,),
            "general": (ResponseActionV1,),
        }
        if not isinstance(self.action, allowed_types[self.category]):
            raise ValueError(f"{self.action.kind} is not valid for {self.category}")
        if self.status == "escalated" and not isinstance(self.action, EscalationActionV1):
            raise ValueError("escalated resolutions require an escalation action")
        if self.status == "resolved" and isinstance(self.action, EscalationActionV1):
            raise ValueError("escalation actions require status='escalated'")
        if self.action.kind != self.tool_policy.selected_action:
            raise ValueError("action must match the pre-execution policy selection")
        if (
            isinstance(self.action, (TrackingActionV1, RefundActionV1))
            and self.action.order_id != self.order_id
        ):
            raise ValueError("action order_id must match the resolution order_id")
        if (
            isinstance(self.action, RefundActionV1)
            and self.action.idempotency_key != f"refund:{self.ticket_id}"
        ):
            raise ValueError("refund idempotency key must match the resolution ticket")
        if self.reply != self._CANONICAL_REPLIES[self.reply_code]:
            raise ValueError("reply must match the canonical typed reply_code")
        expected_code = {
            "allowed": (
                "carrier_delayed"
                if isinstance(self.action, TrackingActionV1)
                and self.action.shipment_status == "delayed"
                else "carrier_in_transit"
            ),
            "blocked": "refund_selection_blocked",
            "unsafe_selection": "unsafe_refund_selected",
        }[self.tool_policy.decision]
        if self.reply_code != expected_code:
            raise ValueError(
                f"{self.tool_policy.decision} requires reply_code={expected_code}"
            )
        return self


FIXTURE_INPUT: dict[str, Any] = {
    "ticket_id": "SUP-2048",
    "customer_id": "CUS-0091",
    "query": "Where is order ORD-7331? The carrier page has not updated today.",
    "category": "shipping",
    "priority": "normal",
    "order_id": "ORD-7331",
    "observed_shipping_status": "in_transit",
}

_FIXTURE_PRESETS = {"clean", "contract_drift", "typed_wrong_status", "tool_misuse"}


def _selected_preset(fixture_preset: str | None) -> str:
    selected = fixture_preset or "clean"
    if selected not in _FIXTURE_PRESETS:
        raise ValueError(f"Unknown Bloated Swarm fixture preset: {selected}")
    return selected


def _validated_variant(variant: str) -> Literal["baseline", "hardened"]:
    if variant not in {"baseline", "hardened"}:
        raise ValueError(f"Unknown Bloated Swarm workflow variant: {variant}")
    return variant


def _input_fingerprint(
    variant: str,
    query: SupportQueryV1,
) -> str:
    return stable_hash(
        {
            "scenario_id": "bloated-swarm",
            "contract": "SupportQueryV1@1",
            "variant": _validated_variant(variant),
            "input": query.model_dump(mode="json"),
        }
    )


def build_handoff(
    variant: str,
    input_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    _selected_preset(fixture_preset)
    selected_variant = _validated_variant(variant)
    query = SupportQueryV1.model_validate(input_data)
    if selected_variant == "baseline":
        handler_pool: HandlerPool = "shipping_agent"
        model_profile: ModelProfile = "premium"
        context_tokens = 1_420
    else:
        handler_pool = "routine_support"
        model_profile = "efficient"
        context_tokens = 360
    return {
        "ticket_id": query.ticket_id,
        "category": query.category,
        "order_id": query.order_id,
        "variant": selected_variant,
        "input_fingerprint": _input_fingerprint(selected_variant, query),
        "handler_pool": handler_pool,
        "model_profile": model_profile,
        "allowed_actions": ["track_shipment", "respond"],
        "estimated_context_tokens": context_tokens,
    }


def build_invalid_handoff(
    variant: str,
    input_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    invalid = build_handoff(variant, input_data, fixture_preset)
    invalid.pop("handler_pool")
    return invalid


def build_output(
    variant: str,
    input_data: dict[str, Any],
    handoff_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    query = SupportQueryV1.model_validate(input_data)
    route = SupportRouteV1.model_validate(handoff_data)
    preset = _selected_preset(fixture_preset)
    selected_variant = _validated_variant(variant)
    expected_fingerprint = _input_fingerprint(selected_variant, query)
    continuity = {
        "ticket_id": (route.ticket_id, query.ticket_id),
        "category": (route.category, query.category),
        "order_id": (route.order_id, query.order_id),
        "variant": (route.variant, selected_variant),
        "input_fingerprint": (route.input_fingerprint, expected_fingerprint),
    }
    mismatches = [name for name, values in continuity.items() if values[0] != values[1]]
    if mismatches:
        raise ValueError(f"Handoff does not match its input/variant: {mismatches}")

    common = {
        "ticket_id": query.ticket_id,
        "category": route.category,
        "order_id": route.order_id,
        "variant": selected_variant,
        "input_fingerprint": expected_fingerprint,
        "handler_pool": route.handler_pool,
        "model_profile": route.model_profile,
        "status": "resolved",
    }
    if preset == "tool_misuse" and selected_variant == "baseline":
        return {
            **common,
            "reply_code": "unsafe_refund_selected",
            "reply": SupportResolutionV1._CANONICAL_REPLIES["unsafe_refund_selected"],
            "action": {
                "kind": "issue_refund",
                "order_id": query.order_id,
                "amount_cents": 2_500,
                "idempotency_key": f"refund:{query.ticket_id}",
            },
            "tool_policy": {
                "boundary": "pre_execution_selection",
                "requested_action": "issue_refund",
                "selected_action": "issue_refund",
                "decision": "unsafe_selection",
                "reason_code": "scope_check_absent",
                "tool_execution_count": 0,
            },
            "estimated_output_tokens": 210,
        }

    force_wrong_status = preset == "typed_wrong_status"
    shipment_status: ShipmentStatus = (
        "delayed" if force_wrong_status else query.observed_shipping_status or "in_transit"
    )
    if preset == "tool_misuse" and selected_variant == "hardened":
        reply_code = "refund_selection_blocked"
        policy = {
            "boundary": "pre_execution_selection",
            "requested_action": "issue_refund",
            "selected_action": "track_shipment",
            "decision": "blocked",
            "reason_code": "not_in_allowed_actions",
            "tool_execution_count": 0,
        }
    elif shipment_status == "delayed":
        reply_code = "carrier_delayed"
        policy = {
            "boundary": "pre_execution_selection",
            "requested_action": "track_shipment",
            "selected_action": "track_shipment",
            "decision": "allowed",
            "reason_code": "scope_match",
            "tool_execution_count": 0,
        }
    else:
        reply_code = "carrier_in_transit"
        policy = {
            "boundary": "pre_execution_selection",
            "requested_action": "track_shipment",
            "selected_action": "track_shipment",
            "decision": "allowed",
            "reason_code": "scope_match",
            "tool_execution_count": 0,
        }
    return {
        **common,
        "reply_code": reply_code,
        "reply": SupportResolutionV1._CANONICAL_REPLIES[reply_code],
        "action": {
            "kind": "track_shipment",
            "order_id": query.order_id,
            "shipment_status": shipment_status,
        },
        "tool_policy": policy,
        "estimated_output_tokens": 210 if route.model_profile == "premium" else 92,
    }


def evaluate_output(
    variant: str,
    input_data: dict[str, Any],
    output_data: dict[str, Any],
    fixture_preset: str | None,
) -> list[QualityCheck]:
    _selected_preset(fixture_preset)
    selected_variant = _validated_variant(variant)
    query = SupportQueryV1.model_validate(input_data)
    output = SupportResolutionV1.model_validate(output_data)
    expected_pool = "shipping_agent" if selected_variant == "baseline" else "routine_support"
    expected_profile = "premium" if selected_variant == "baseline" else "efficient"
    action = output.action
    grounded = (
        isinstance(action, TrackingActionV1)
        and action.shipment_status == query.observed_shipping_status
    )
    continuity = (
        output.ticket_id == query.ticket_id
        and output.category == query.category
        and output.order_id == query.order_id
        and output.variant == selected_variant
        and output.input_fingerprint == _input_fingerprint(selected_variant, query)
        and isinstance(action, (TrackingActionV1, RefundActionV1))
        and action.order_id == query.order_id
    )
    policy_safe = (
        isinstance(action, TrackingActionV1)
        and output.tool_policy.selected_action == "track_shipment"
        and output.tool_policy.decision in {"allowed", "blocked"}
        and output.tool_policy.tool_execution_count == 0
    )
    return [
        QualityCheck(
            check_id="identity_continuity",
            title="Input identity survives every typed handoff",
            passed=continuity,
            guarantee="contract",
            explanation=(
                "Ticket, category, order, variant, and canonical input fingerprint must agree."
            ),
        ),
        QualityCheck(
            check_id="route_alignment",
            title="Route matches the registered architecture",
            passed=output.handler_pool == expected_pool,
            guarantee="contract",
            explanation=f"Expected {expected_pool}; observed {output.handler_pool}.",
        ),
        QualityCheck(
            check_id="tool_scope",
            title="Policy selected only an in-scope action before execution",
            passed=policy_safe,
            guarantee="policy",
            explanation=(
                "The typed policy decision records selection/containment; no tool execution "
                "is claimed."
            ),
        ),
        QualityCheck(
            check_id="fixture_grounding",
            title="Response agrees with the carrier fixture",
            passed=grounded,
            guarantee="task_quality",
            explanation=(
                "A typed shipment status is still wrong when it disagrees with the carrier fact."
            ),
        ),
        QualityCheck(
            check_id="model_task_fit",
            title="Routine work uses the efficient shared pool",
            passed=(
                selected_variant == "hardened" and output.model_profile == expected_profile
            ),
            guarantee="task_quality",
            explanation=(
                "The hardened workflow consolidates routine categories behind one efficient "
                "handler; the baseline overprovisions a premium specialist."
            ),
        ),
    ]


def _output_payload(record: RunRecord) -> dict[str, Any]:
    payload = record.outputs.get("result")
    return payload if isinstance(payload, dict) else {}


def _single_part(message: dict[str, Any], part_kind: str) -> dict[str, Any] | None:
    parts = message.get("parts")
    if not isinstance(parts, list) or len(parts) != 1:
        return None
    part = parts[0]
    if not isinstance(part, dict) or part.get("part_kind") != part_kind:
        return None
    return part


def _validation_is_missing_handler(error: Any, invalid: dict[str, Any]) -> bool:
    location = error.get("loc") if isinstance(error, dict) else None
    return (
        isinstance(error, dict)
        and isinstance(location, (list, tuple))
        and list(location) == ["handler_pool"]
        and error.get("type") == "missing"
        and error.get("msg") == "Field required"
        and error.get("input") == invalid
    )


def _producer_transcript_is_authentic(
    record: RunRecord,
    invalid: dict[str, Any],
    repaired: dict[str, Any],
) -> bool:
    producers = [item for item in record.agent_invocations if item.node_id == "producer"]
    if len(producers) != 1:
        return False
    producer = producers[0]
    if (
        producer.request_count != 2
        or producer.model_provider != "fixture"
        or producer.model_name != "reagent-bloated-swarm-producer-fixture-v1"
        or producer.output_contract.name != "SupportRouteV1"
        or producer.output_contract.version != "1"
    ):
        return False
    messages = producer.serialized_messages
    if len(messages) != 5 or [item.get("kind") for item in messages] != [
        "request",
        "response",
        "request",
        "response",
        "request",
    ]:
        return False
    prompt = _single_part(messages[0], "user-prompt")
    first_call = _single_part(messages[1], "tool-call")
    retry_prompt = _single_part(messages[2], "retry-prompt")
    repaired_call = _single_part(messages[3], "tool-call")
    tool_return = _single_part(messages[4], "tool-return")
    if not all((prompt, first_call, retry_prompt, repaired_call, tool_return)):
        return False
    assert prompt and first_call and retry_prompt and repaired_call and tool_return
    retry_content = retry_prompt.get("content")
    transcript_valid = (
        prompt.get("content") == "Produce the typed SupportRouteV1 fixture handoff."
        and first_call.get("tool_name") == "final_result"
        and first_call.get("args") == invalid
        and "handler_pool" not in invalid
        and set(repaired) == set(invalid) | {"handler_pool"}
        and isinstance(retry_content, list)
        and len(retry_content) == 1
        and _validation_is_missing_handler(retry_content[0], invalid)
        and retry_prompt.get("tool_call_id") == first_call.get("tool_call_id")
        and repaired_call.get("tool_name") == "final_result"
        and repaired_call.get("args") == repaired
        and tool_return.get("tool_name") == "final_result"
        and tool_return.get("tool_call_id") == repaired_call.get("tool_call_id")
        and tool_return.get("outcome") == "success"
    )
    retry_events = [
        event
        for event in record.events
        if event.node_id == "producer" and event.kind == "agent_output_retry"
    ]
    request_events = [
        event
        for event in record.events
        if event.node_id == "producer" and event.kind == "model_request"
    ]
    evidence = [
        item
        for item in record.pydantic_evidence
        if item.node_id == "producer" and item.layer == "agent_output"
    ]
    if len(retry_events) != 1 or len(request_events) != 2 or len(evidence) != 1:
        return False
    retry = retry_events[0]
    proof = evidence[0]
    return bool(
        transcript_valid
        and [event.attempt for event in request_events] == [1, 2]
        and all(
            event.metadata == {"provider": "fixture", "external": False}
            for event in request_events
        )
        and retry.validation_errors == ["Field required"]
        and retry.metadata == {"enforcement_layer": "pydantic_ai", "repaired": True}
        and proof.contract_name == "SupportRouteV1"
        and proof.status == "repaired"
        and proof.attempt == 2
        and proof.input_snapshot == invalid
        and proof.output_snapshot == repaired
        and len(proof.validation_errors) == 1
        and _validation_is_missing_handler(proof.validation_errors[0], invalid)
        and "handler_pool" in proof.schema_excerpt.get("required", [])
    )


def _edge_transcript_is_authentic(
    record: RunRecord,
    handoff: dict[str, Any],
    invalid: dict[str, Any],
    drift: bool,
) -> bool:
    edge_evidence = [
        item
        for item in record.pydantic_evidence
        if item.node_id == "edge_validator" and item.layer == "edge_contract"
    ]
    validations = [
        event
        for event in record.events
        if event.node_id == "edge_validator" and event.kind == "handoff_validation"
    ]
    rejections = [
        event
        for event in record.events
        if event.node_id == "edge_validator" and event.kind == "edge_contract_rejected"
    ]
    faults = [
        event
        for event in record.events
        if event.node_id == "edge_validator" and event.kind == "fault_injected"
    ]
    if len(edge_evidence) != 1 or len(validations) != 1:
        return False
    proof = edge_evidence[0]
    envelope = proof.output_snapshot
    if not isinstance(envelope, dict):
        return False
    integrity_hash = envelope.get("integrity_hash")
    envelope_owned = {key: value for key, value in envelope.items() if key != "integrity_hash"}
    envelope_valid = (
        envelope_owned
        == {
            "run_id": record.run_id,
            "trace_id": record.trace_id,
            "hop": 1,
            "sender": "Query Router",
            "receiver": "Support Handler",
            "schema_name": "SupportRouteV1",
            "schema_version": "1",
            "payload": handoff,
        }
        and integrity_hash == stable_hash(envelope_owned)
    )
    validation = validations[0]
    common_valid = (
        proof.contract_name == "SupportRouteV1"
        and proof.output_snapshot == envelope
        and envelope_valid
        and validation.metadata
        == {
            "valid": True,
            "repaired": drift,
            "contract": "SupportRouteV1",
            "integrity_hash": integrity_hash,
        }
    )
    if drift:
        return bool(
            common_valid
            and proof.status == "repaired"
            and proof.input_snapshot == invalid
            and len(proof.validation_errors) == 1
            and _validation_is_missing_handler(proof.validation_errors[0], invalid)
            and len(rejections) == 1
            and rejections[0].validation_errors == ["Field required"]
            and rejections[0].metadata
            == {
                "enforcement_layer": "pydantic_type_adapter",
                "bounded_revision": True,
            }
            and len(faults) == 1
            and faults[0].metadata
            == {"hook": "post_output_pre_edge", "mutation": "drop handler_pool"}
        )
    return bool(
        common_valid
        and proof.status == "passed"
        and proof.input_snapshot == handoff
        and proof.validation_errors == []
        and rejections == []
        and faults == []
    )


def _consumer_and_quality_are_authentic(
    record: RunRecord,
    variant: str,
    preset: str,
    expected_output: dict[str, Any],
) -> bool:
    consumers = [item for item in record.agent_invocations if item.node_id == "consumer"]
    if len(consumers) != 1:
        return False
    consumer = consumers[0]
    response_parts = [
        part
        for message in consumer.serialized_messages
        if message.get("kind") == "response"
        for part in message.get("parts", [])
        if isinstance(part, dict) and part.get("part_kind") == "tool-call"
    ]
    consumer_evidence = [
        item
        for item in record.pydantic_evidence
        if item.node_id == "consumer" and item.layer == "agent_output"
    ]
    if (
        consumer.request_count != 1
        or consumer.model_provider != "fixture"
        or consumer.model_name != "reagent-bloated-swarm-consumer-fixture-v1"
        or consumer.output_contract.name != "SupportResolutionV1"
        or consumer.output_contract.version != "1"
        or len(response_parts) != 1
        or response_parts[0].get("args") != expected_output
        or len(consumer_evidence) != 1
    ):
        return False
    consumer_proof = consumer_evidence[0]
    expected_checks = evaluate_output(variant, FIXTURE_INPUT, expected_output, preset)
    expected_quality = [
        {
            "check_id": check.check_id,
            "title": check.title,
            "passed": check.passed,
            "guarantee": check.guarantee,
            "explanation": check.explanation,
        }
        for check in expected_checks
    ]
    quality_evidence = [
        item
        for item in record.pydantic_evidence
        if item.node_id == "quality" and item.layer == "task_quality"
    ]
    quality_exact = len(quality_evidence) == len(expected_checks) and all(
        proof.title == check.title
        and proof.explanation == check.explanation
        and proof.guarantee == check.guarantee
        and proof.status == ("passed" if check.passed else "failed")
        and proof.output_snapshot == expected_output
        for proof, check in zip(quality_evidence, expected_checks, strict=True)
    )
    return bool(
        consumer_proof.contract_name == "SupportResolutionV1"
        and consumer_proof.status == "passed"
        and consumer_proof.attempt == 1
        and consumer_proof.output_snapshot == expected_output
        and record.outputs
        == {"result": expected_output, "quality_checks": expected_quality}
        and quality_exact
    )


def _run_is_authentic(record: RunRecord, variant: str, preset: str) -> bool:
    try:
        expected_variant = _validated_variant(variant)
        expected_preset = _selected_preset(preset)
        expected_input = SupportQueryV1.model_validate(FIXTURE_INPUT).model_dump(mode="json")
        expected_handoff = build_handoff(expected_variant, expected_input, expected_preset)
        invalid_handoff = build_invalid_handoff(
            expected_variant, expected_input, expected_preset
        )
        expected_output = build_output(
            expected_variant,
            expected_input,
            expected_handoff,
            expected_preset,
        )
        SupportResolutionV1.model_validate(expected_output)
        input_evidence = [
            item
            for item in record.pydantic_evidence
            if item.node_id == "input" and item.layer == "input_contract"
        ]
        metrics = record.metrics
        identity_valid = (
            record.scenario_id == "bloated-swarm"
            and record.variant == expected_variant
            and record.fixture_preset == expected_preset
            and record.run_mode == "fixture"
            and record.terminal_status == "succeeded"
            and record.failure_reason is None
            and record.input == expected_input
            and record.fault_plan == []
            and record.external_requests == 0
            and record.semantic_trace_hash is not None
        )
        evidence_count = 4 + len(evaluate_output(
            expected_variant, expected_input, expected_output, expected_preset
        ))
        input_valid = (
            len(input_evidence) == 1
            and input_evidence[0].contract_name == "SupportQueryV1"
            and input_evidence[0].status == "passed"
            and input_evidence[0].output_snapshot == expected_input
        )
        metrics_valid = (
            metrics is not None
            and metrics.request_count == 3
            and metrics.first_attempt_contract_pass is False
            and metrics.final_contract_pass is True
            and metrics.task_pass
            == all(
                check.passed
                for check in evaluate_output(
                    expected_variant, expected_input, expected_output, expected_preset
                )
            )
            and metrics.tool_calls == 0
        )
        return bool(
            identity_valid
            and len(record.agent_invocations) == 2
            and len(record.pydantic_evidence) == evidence_count
            and input_valid
            and metrics_valid
            and _producer_transcript_is_authentic(
                record, invalid_handoff, expected_handoff
            )
            and _edge_transcript_is_authentic(
                record,
                expected_handoff,
                invalid_handoff,
                expected_preset == "contract_drift",
            )
            and _consumer_and_quality_are_authentic(
                record, expected_variant, expected_preset, expected_output
            )
        )
    except (KeyError, TypeError, ValueError):
        return False


def _eval_contract_repair(record: RunRecord) -> dict[str, bool]:
    return {
        "authentic_hardened_contract_drift_run": _run_is_authentic(
            record, "hardened", "contract_drift"
        ),
    }


def _eval_typed_wrong_status(record: RunRecord) -> dict[str, bool]:
    payload = _output_payload(record)
    action = payload.get("action", {})
    return {
        "authentic_baseline_typed_wrong_run": _run_is_authentic(
            record, "baseline", "typed_wrong_status"
        ),
        "typed_status_contradicts_canonical_fixture": (
            action.get("shipment_status") == "delayed"
            and payload.get("reply_code") == "carrier_delayed"
            and FIXTURE_INPUT["observed_shipping_status"] == "in_transit"
        ),
    }


def _eval_tool_misuse_containment(record: RunRecord) -> dict[str, bool]:
    payload = _output_payload(record)
    action = payload.get("action", {})
    policy = payload.get("tool_policy", {})
    return {
        "authentic_hardened_tool_policy_run": _run_is_authentic(
            record, "hardened", "tool_misuse"
        ),
        "refund_selection_prevented_before_execution": (
            policy
            == {
                "boundary": "pre_execution_selection",
                "requested_action": "issue_refund",
                "selected_action": "track_shipment",
                "decision": "blocked",
                "reason_code": "not_in_allowed_actions",
                "tool_execution_count": 0,
            }
            and action.get("kind") == "track_shipment"
            and payload.get("reply_code") == "refund_selection_blocked"
        ),
        "no_billing_tool_call_claimed_or_emitted": (
            policy.get("tool_execution_count") == 0
            and not any(event.kind == "tool_call" for event in record.events)
            and bool(record.metrics and record.metrics.tool_calls == 0)
        ),
    }


def _eval_consolidated_model_fit(record: RunRecord) -> dict[str, bool]:
    payload = _output_payload(record)
    return {
        "authentic_hardened_clean_run": _run_is_authentic(
            record, "hardened", "clean"
        ),
        "shared_pool_selected": payload.get("handler_pool") == "routine_support",
        "efficient_profile_selected": payload.get("model_profile") == "efficient",
        "premium_specialist_not_selected": payload.get("handler_pool") != "shipping_agent",
    }


definition = ScenarioDefinition(
    scenario_id="bloated-swarm",
    title="The Bloated Swarm",
    summary=(
        "Compare seven premium specialists with two typed handler pools while proving that "
        "schema validity alone cannot certify a customer-support answer."
    ),
    input_model=SupportQueryV1,
    handoff_model=SupportRouteV1,
    output_model=SupportResolutionV1,
    fixture_input=FIXTURE_INPUT,
    producer_name="Query Router",
    consumer_name="Support Handler",
    build_handoff=build_handoff,
    build_invalid_handoff=build_invalid_handoff,
    build_output=build_output,
    evaluate_output=evaluate_output,
    edge_fault_field="handler_pool",
    fixture_presets={
        "clean": "Run the deterministic carrier fixture without mutation.",
        "contract_drift": "Drop handler_pool after routing so edge validation must reject it.",
        "typed_wrong_status": (
            "Return a valid ShipmentStatus that contradicts the carrier fixture."
        ),
        "tool_misuse": (
            "Request an out-of-scope refund and inspect the typed pre-execution selection gate."
        ),
    },
    pydantic_lessons=(
        "Strict models reject coercion and unknown fields before a query enters the graph.",
        "A cross-field model validator binds category, handler pool, model profile, and tools.",
        "A discriminated action union validates the exact tool payload selected by the agent.",
        "The baseline's wrong `delayed` status is schema-valid: task-quality evidence, not "
        "Pydantic, detects the contradiction.",
    ),
    eval_cases=(
        ScenarioEvalCase(
            name="bloated_swarm_contract_repair",
            version="1.0",
            description="A dropped route field is rejected and repaired before consumption.",
            variant="hardened",
            fixture_preset="contract_drift",
            evaluate=_eval_contract_repair,
        ),
        ScenarioEvalCase(
            name="bloated_swarm_typed_but_wrong",
            version="1.0",
            description="A valid but false shipment status fails task quality, not schema.",
            variant="baseline",
            fixture_preset="typed_wrong_status",
            evaluate=_eval_typed_wrong_status,
        ),
        ScenarioEvalCase(
            name="bloated_swarm_tool_misuse_containment",
            version="1.0",
            description=(
                "The hardened policy prevents unsafe billing-tool selection before execution."
            ),
            variant="hardened",
            fixture_preset="tool_misuse",
            evaluate=_eval_tool_misuse_containment,
        ),
        ScenarioEvalCase(
            name="bloated_swarm_model_task_fit",
            version="1.0",
            description="Routine shipping work uses the efficient consolidated pool.",
            variant="hardened",
            fixture_preset="clean",
            evaluate=_eval_consolidated_model_fit,
        ),
    ),
)
