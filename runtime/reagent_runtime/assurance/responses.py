from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from .models import CompileIssue
from .registry import CheckRecord, ContractRecord
from .wire import (
    StableId,
    StrictWireDTO,
    WireDecimal,
    WireSemVer,
    WireSHA256,
    WireTimestamp,
    WireUUID,
)


class RegistryDigests(StrictWireDTO):
    capability_registry_digest: WireSHA256
    lowerer_registry_digest: WireSHA256
    contract_registry_digest: WireSHA256
    check_registry_digest: WireSHA256


class EvalSuiteCapability(StrictWireDTO):
    suite_id: StableId
    version: WireSemVer
    case_ids: list[StableId]


class ProducedContractBinding(StrictWireDTO):
    contract_id: StableId
    contract_version: WireSemVer
    supported_output_modes: list[Literal["tool", "native", "prompted"]]


class PortCapabilityResponse(StrictWireDTO):
    id: StableId
    direction: Literal["input", "output"]
    payload_contract_id: StableId
    payload_contract_version: WireSemVer
    cardinality: Literal["one", "many"]


class StateBindingResponse(StrictWireDTO):
    source: Literal["request.input", "incoming.payload", "incoming.payloads"]
    source_port: StableId | None
    target_state_key: StableId
    merge: Literal["replace", "ordered_list"]


class NodeCapabilityResponse(StrictWireDTO):
    scenario_id: str
    node_type: StableId
    capability_template_id: StableId
    operation_id: StableId
    operation_version: WireSemVer
    config_schema_id: StableId
    config_schema_version: WireSemVer
    input_ports: list[PortCapabilityResponse]
    output_ports: list[PortCapabilityResponse]
    input_bindings: list[StateBindingResponse]
    state_reads: list[StableId]
    state_writes: list[StableId]
    state_reducers: dict[StableId, Literal["replace", "ordered_list"]]
    lowerer_id: StableId
    lowerer_version: WireSemVer
    reentry_supported: bool
    default_config: dict[str, Any]
    supported_edge_kinds: list[Literal["normal", "conditional", "failure", "retry"]]
    allowed_executor_contracts: list[ProducedContractBinding]
    operation_role: Literal["input", "terminal", "handoff_producer", "transform", "router"]
    config_constraints: dict[str, Any]
    produced_payload_contracts: list[ProducedContractBinding]


class CapabilitiesResponse(StrictWireDTO):
    schema_version: Literal["assurance.capabilities.v1"]
    enabled: Literal[True]
    supported: bool
    scenario_id: str
    adapter_version: WireSemVer | None
    compiler_version: WireSemVer
    run_input_schema: dict[str, Any]
    node_capabilities: list[NodeCapabilityResponse]
    contracts: list[ContractRecord]
    checks: list[CheckRecord]
    patches: list[dict[str, Any]]
    eval_suites: list[EvalSuiteCapability]
    registry_digests: RegistryDigests | dict[Literal["unsupported"], str]
    help_text: dict[str, str]


class PlanStepDTO(StrictWireDTO):
    step_id: StableId
    canvas_node_id: StableId
    node_type: StableId
    config: dict[str, Any]
    operation_id: StableId
    operation_version: WireSemVer
    lowerer_id: StableId
    lowerer_version: WireSemVer
    implementation_fingerprint: WireSHA256
    produced_payload_contracts: list[ProducedContractBinding]
    state_writes: list[StableId]
    state_reducers: dict[StableId, Literal["replace", "ordered_list"]]
    reentry_supported: bool
    internal: bool


class PlanTransitionDTO(StrictWireDTO):
    transition_id: StableId
    canvas_edge_id: StableId
    source_step_id: StableId
    target_step_id: StableId
    source_handle: StableId
    target_handle: StableId
    kind: Literal["normal", "conditional", "failure", "retry"]
    fan_out: Literal["all", "exclusive"] | None
    route_probability: WireDecimal | None
    max_attempts: int | None
    cleared_state_keys: list[StableId] | None = None
    cleared_canvas_node_ids: list[StableId] | None = None
    replacement_state_key: StableId | None = None
    must_revisit_step_id: StableId | None = None


class ExecutablePlanDTO(StrictWireDTO):
    schema_version: Literal["assurance.plan.v1"]
    steps: list[PlanStepDTO]
    transitions: list[PlanTransitionDTO]
    entry_step_ids: list[StableId]
    terminal_step_ids: list[StableId]


class CompileResponse(StrictWireDTO):
    schema_version: Literal["assurance.compile_result.v1"]
    artifact_id: WireUUID
    scenario_id: str
    status: Literal["compiled"]
    source_graph_hash: WireSHA256
    candidate_hash: WireSHA256
    normalized_semantic_graph: dict[str, Any]
    compiled_plan: ExecutablePlanDTO
    node_to_plan_steps: dict[StableId, list[StableId]]
    edge_to_plan_transitions: dict[StableId, list[StableId]]
    resolved_assurance: dict[StableId, dict[str, Any]]
    registry_digests: RegistryDigests
    issues: list[CompileIssue]
    warnings: list[CompileIssue]
    created_at: WireTimestamp


class ValidationErrorDetail(StrictWireDTO):
    path: list[str | int]
    type: str
    message: str
    input: Literal["[redacted]"]


class RunStartedPayload(StrictWireDTO):
    artifact_id: WireUUID


class NodeStartedPayload(StrictWireDTO):
    incoming_canvas_edge_id: StableId | None


class NodeCompletedPayload(StrictWireDTO):
    selected_handle: StableId | None = None
    terminal: Literal[True] | None = None

    @model_validator(mode="after")
    def exactly_one_completion(self) -> NodeCompletedPayload:
        if (self.selected_handle is None) == (self.terminal is None):
            raise ValueError("node completion must select a handle or mark a terminal")
        return self


class NodeFailedPayload(StrictWireDTO):
    code: StableId
    errors: list[ValidationErrorDetail]


class ExecutorRejectedPayload(StrictWireDTO):
    contract_id: StableId
    errors: list[ValidationErrorDetail]


class ExecutorRetryPayload(StrictWireDTO):
    validation_retry: int = Field(ge=1)


class ExecutorValidatedPayload(StrictWireDTO):
    contract_id: StableId
    contract_version: WireSemVer
    output_mode: Literal["tool", "native", "prompted"]
    strict: bool
    request_count: int = Field(ge=1)
    retry_count: int = Field(ge=0)
    engine: Literal["pydantic_ai"]


class FixtureMutationPayload(StrictWireDTO):
    mutation_id: Literal["post_agent_handoff_drift"]
    target_contract_id: StableId
    removed_path: list[str | int]


class HandoffValidatedPayload(StrictWireDTO):
    contract_id: StableId
    contract_version: WireSemVer
    method: Literal["validate_python", "validate_json"]


class HandoffRejectedPayload(HandoffValidatedPayload):
    errors: list[ValidationErrorDetail]


class RetrievedKnowledgeChunkPayload(StrictWireDTO):
    chunk_id: StableId
    source_id: StableId
    rank: int = Field(ge=1)
    score: WireDecimal
    relevant: bool
    title: str
    excerpt: str


class RetrievalMetricsPayload(StrictWireDTO):
    metric_family: Literal["ragas_aligned_deterministic"]
    context_precision: WireDecimal
    context_recall: WireDecimal
    context_relevance: WireDecimal
    faithfulness: None = None
    faithfulness_status: Literal["not_measured_requires_generation"]


class KnowledgeRetrievalPayload(StrictWireDTO):
    operation_id: StableId
    corpus_id: StableId
    retrieval_mode: Literal["bm25", "vector", "hybrid"]
    top_k: int = Field(ge=1, le=20)
    query: str
    retrieved: list[RetrievedKnowledgeChunkPayload]
    metrics: RetrievalMetricsPayload


class EvidenceStartedPayload(StrictWireDTO):
    check_ids: list[StableId]


class EvidenceResultPayload(StrictWireDTO):
    check_id: StableId
    version: WireSemVer
    score: WireDecimal
    decision: bool
    weight: WireDecimal | None
    engine: Literal["deterministic"]
    method: StableId
    implementation_fingerprint: WireSHA256
    evidence_refs: list[str]


class EdgeTraversedPayload(StrictWireDTO):
    source_handle: StableId
    target_handle: StableId
    kind: Literal["normal", "conditional", "failure", "retry"]


class OuterRevisionPayload(StrictWireDTO):
    cleared_state_keys: list[StableId]
    replacement_state_key: StableId
    must_revisit_step_id: StableId
    revision_feedback: list[ValidationErrorDetail]


class RunFinishedPayload(StrictWireDTO):
    terminal_kind: Literal[
        "clean",
        "recovered",
        "contract_violation",
        "evidence_failed",
        "revision_exhausted",
        "run_error",
    ]
    code: StableId | None


class EventBase(StrictWireDTO):
    event_id: WireUUID
    run_id: WireUUID
    sequence: int = Field(ge=1)
    attempt_number: int = Field(ge=1)
    timestamp: WireTimestamp
    correlation_id: WireUUID
    causation_id: WireUUID | None
    candidate_hash: WireSHA256
    canvas_node_id: StableId | None
    canvas_edge_id: StableId | None
    plan_step_id: StableId | None


class RunStartedEvent(EventBase):
    event_type: Literal["run_started"]
    payload: RunStartedPayload


class NodeStartedEvent(EventBase):
    event_type: Literal["node_started"]
    payload: NodeStartedPayload


class NodeCompletedEvent(EventBase):
    event_type: Literal["node_completed"]
    payload: NodeCompletedPayload


class NodeFailedEvent(EventBase):
    event_type: Literal["node_failed"]
    payload: NodeFailedPayload


class ExecutorRejectedEvent(EventBase):
    event_type: Literal["executor_output_rejected"]
    payload: ExecutorRejectedPayload


class ExecutorRetryEvent(EventBase):
    event_type: Literal["executor_retry_started"]
    payload: ExecutorRetryPayload


class ExecutorValidatedEvent(EventBase):
    event_type: Literal["executor_output_validated"]
    payload: ExecutorValidatedPayload


class FixtureMutationEvent(EventBase):
    event_type: Literal["fixture_mutation_applied"]
    payload: FixtureMutationPayload


class HandoffValidatedEvent(EventBase):
    event_type: Literal["handoff_validated"]
    payload: HandoffValidatedPayload


class HandoffRejectedEvent(EventBase):
    event_type: Literal["handoff_rejected"]
    payload: HandoffRejectedPayload


class KnowledgeRetrievalEvent(EventBase):
    event_type: Literal["knowledge_retrieval_completed"]
    payload: KnowledgeRetrievalPayload


class EvidenceStartedEvent(EventBase):
    event_type: Literal["evidence_check_started"]
    payload: EvidenceStartedPayload


class EvidenceResultEvent(EventBase):
    event_type: Literal["evidence_check_result"]
    payload: EvidenceResultPayload


class EdgeTraversedEvent(EventBase):
    event_type: Literal["edge_traversed"]
    payload: EdgeTraversedPayload


class OuterRevisionEvent(EventBase):
    event_type: Literal["outer_revision_started"]
    payload: OuterRevisionPayload


class RunFinishedEvent(EventBase):
    event_type: Literal["run_finished"]
    payload: RunFinishedPayload


AssuranceEvent = Annotated[
    RunStartedEvent
    | NodeStartedEvent
    | NodeCompletedEvent
    | NodeFailedEvent
    | ExecutorRejectedEvent
    | ExecutorRetryEvent
    | ExecutorValidatedEvent
    | FixtureMutationEvent
    | HandoffValidatedEvent
    | HandoffRejectedEvent
    | KnowledgeRetrievalEvent
    | EvidenceStartedEvent
    | EvidenceResultEvent
    | EdgeTraversedEvent
    | OuterRevisionEvent
    | RunFinishedEvent,
    Field(discriminator="event_type"),
]


class TerminalBase(StrictWireDTO):
    output: Any
    code: StableId | None
    proof_event_ids: list[WireUUID]
    recovered_from_event_ids: list[WireUUID]


class CleanTerminal(TerminalBase):
    kind: Literal["clean"]


class RecoveredTerminal(TerminalBase):
    kind: Literal["recovered"]


class ContractViolationTerminal(TerminalBase):
    kind: Literal["contract_violation"]


class EvidenceFailedTerminal(TerminalBase):
    kind: Literal["evidence_failed"]


class RevisionExhaustedTerminal(TerminalBase):
    kind: Literal["revision_exhausted"]


class RunErrorTerminal(TerminalBase):
    kind: Literal["run_error"]


TerminalResult = Annotated[
    CleanTerminal
    | RecoveredTerminal
    | ContractViolationTerminal
    | EvidenceFailedTerminal
    | RevisionExhaustedTerminal
    | RunErrorTerminal,
    Field(discriminator="kind"),
]


class OuterRevisionSummary(StrictWireDTO):
    used: int = Field(ge=0)
    budget: int = Field(ge=0, le=3)
    by_gate: dict[StableId, int]
    traversed_edge_ids: list[StableId]


class ContainmentEvidence(StrictWireDTO):
    measurement_status: Literal["measured", "not_measured"]
    injected_risk_ids: list[StableId]
    contained_risk_ids: list[StableId]
    decision: bool | None

    @model_validator(mode="after")
    def measured_requires_tracked_risks(self) -> ContainmentEvidence:
        if self.measurement_status == "not_measured" and self.decision is not None:
            raise ValueError("unmeasured containment cannot claim a decision")
        if self.measurement_status == "measured" and not self.injected_risk_ids:
            raise ValueError("measured containment requires tracked injected risk IDs")
        return self


class RunResponse(StrictWireDTO):
    schema_version: Literal["assurance.run_result.v1"]
    run_id: WireUUID
    artifact_id: WireUUID
    candidate_hash: WireSHA256
    status: Literal["completed"]
    terminal_result: TerminalResult
    events: list[AssuranceEvent]
    internal_executor_calls: dict[StableId, int]
    internal_executor_retries: dict[StableId, int]
    outer_revisions: OuterRevisionSummary
    containment_evidence: ContainmentEvidence
    created_at: WireTimestamp
    finished_at: WireTimestamp

    @model_validator(mode="after")
    def validate_event_chain(self) -> RunResponse:
        if not self.events:
            raise ValueError("run response requires an event chain")
        if [event.sequence for event in self.events] != list(range(1, len(self.events) + 1)):
            raise ValueError("event sequences must be contiguous and start at one")
        if any(event.run_id != self.run_id for event in self.events):
            raise ValueError("every event run_id must match the run response")
        if any(event.correlation_id != self.run_id for event in self.events):
            raise ValueError("every event correlation_id must match the run response")
        if self.events[0].causation_id is not None:
            raise ValueError("the first event cannot have a causation ID")
        if any(
            event.causation_id != self.events[index - 1].event_id
            for index, event in enumerate(self.events[1:], start=1)
        ):
            raise ValueError("each event must be caused by the preceding event")
        if any(event.candidate_hash != self.candidate_hash for event in self.events):
            raise ValueError("every event candidate hash must match the run response")
        finished = [event for event in self.events if event.event_type == "run_finished"]
        if len(finished) != 1 or self.events[-1].event_type != "run_finished":
            raise ValueError("run_finished must occur exactly once and be the final event")
        final = finished[0]
        if final.payload.terminal_kind != self.terminal_result.kind:
            raise ValueError("run_finished terminal kind must match terminal_result")
        if final.payload.code != self.terminal_result.code:
            raise ValueError("run_finished code must match terminal_result")
        return self


class EvalAggregate(StrictWireDTO):
    passed: int = Field(ge=0)
    failed: int = Field(ge=0)
    total: int = Field(ge=0)


class EvalCaseResponse(StrictWireDTO):
    case_id: StableId
    case_version: WireSemVer
    evaluator_id: StableId
    evaluator_version: WireSemVer
    run_id: WireUUID
    passed: bool
    result: dict[str, Any]


class EvalResponse(StrictWireDTO):
    schema_version: Literal["assurance.eval_result.v1"]
    eval_id: WireUUID
    artifact_id: WireUUID
    candidate_hash: WireSHA256
    suite_id: StableId
    suite_version: WireSemVer
    status: Literal["completed"]
    engine: Literal["pydantic-evals"]
    aggregate: EvalAggregate
    cases: list[EvalCaseResponse]
    cache_key: WireSHA256
    created_at: WireTimestamp
    finished_at: WireTimestamp
