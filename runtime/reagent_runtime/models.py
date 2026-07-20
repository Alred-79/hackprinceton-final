from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from hashlib import sha256
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


def utc_now() -> datetime:
    return datetime.now(UTC)


def stable_hash(value: Any) -> str:
    import json

    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return sha256(payload.encode()).hexdigest()


class ContractRef(BaseModel):
    name: str
    version: str = "1"


class RetryPolicy(BaseModel):
    max_attempts: int = Field(default=2, ge=1, le=5)


class NodeSpec(BaseModel):
    id: str
    kind: Literal["agent", "tool", "router", "validator", "approval", "input", "output"]
    implementation_key: str
    input_contract: ContractRef | None = None
    output_contract: ContractRef | None = None
    join_policy: Literal["all", "any"] | None = None
    route_predicate_key: str | None = None
    retry_policy: RetryPolicy | None = None


class EdgeSpec(BaseModel):
    source: str
    target: str
    kind: Literal["normal", "conditional", "failure", "retry"] = "normal"
    fan_out: Literal["all", "exclusive"] | None = None
    condition_label: str | None = None
    route_probability: float | None = Field(default=None, ge=0, le=1)
    max_attempts: int | None = Field(default=None, ge=1, le=5)


class WorkflowSpec(BaseModel):
    id: str
    version: str
    nodes: list[NodeSpec]
    edges: list[EdgeSpec]
    entry_node_id: str
    output_node_ids: list[str]


class SourceRef(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    uri: str
    content_hash: str
    excerpt: str | None = None


class ModelClaim(BaseModel):
    id: str
    statement: str
    citation_ids: list[str] = Field(default_factory=list)
    declared_parent_claim_ids: list[str] = Field(default_factory=list)
    declared_confidence: float | None = Field(default=None, ge=0, le=1)
    declared_status: Literal["observed", "inferred", "unverified"] | None = None


class ClaimAssessment(BaseModel):
    claim_fingerprint: str
    claim_id: str
    node_id: str
    assessment: Literal["supported", "contradicted", "unsupported", "unknown"]
    matched_fixture_fact_ids: list[str] = Field(default_factory=list)
    matched_parent_fingerprints: list[str] = Field(default_factory=list)
    assessment_method: str = "fixture_semantic_match"
    assessment_version: str = "1.0"


class ConstraintRef(BaseModel):
    id: str
    statement: str


class HandoffEnvelope[PayloadT](BaseModel):
    model_config = ConfigDict(frozen=True)

    run_id: str
    trace_id: str
    hop: int
    sender: str
    receiver: str
    schema_name: str
    schema_version: str
    payload: PayloadT
    claims: list[ModelClaim] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    preserved_constraint_ids: list[str] = Field(default_factory=list)
    parent_envelope_hash: str | None = None
    integrity_hash: str


class ThreatIndicatorsV1(BaseModel):
    indicators: list[str]
    source_ids: list[str]
    required_constraint_ids: list[str] = Field(default_factory=list)


class EnrichmentResultV1(BaseModel):
    indicator: str
    reputation: Literal["malicious", "suspicious", "benign", "unknown"]
    source_ids: list[str]
    claims: list[ModelClaim]


class ThreatAssessmentV1(BaseModel):
    severity: Literal["critical", "high", "medium", "low"]
    summary: str
    source_ids: list[str]
    claims: list[ModelClaim]
    rejected_claim_ids: list[str] = Field(default_factory=list)


class ThreatBriefV1(BaseModel):
    title: str
    body: str
    publish: bool
    source_ids: list[str]
    claims: list[ModelClaim]


class FaultInjection(BaseModel):
    case: Literal[
        "none",
        "contract_drift",
        "tool_misuse",
        "context_overflow",
        "handoff_loss",
        "citation_drift",
        "false_claim",
        "mcp_bloat",
        "hitl_break",
    ] = "none"
    hook: Literal[
        "model_response",
        "post_output_pre_edge",
        "tool_call",
        "context_preparation",
        "approval_resume",
    ] = "model_response"
    seed: int = 7
    mutation: dict[str, Any] = Field(default_factory=dict)
    version: str = "1.0"


class RunEvent(BaseModel):
    event_id: str
    run_id: str
    node_id: str | None
    kind: Literal[
        "node_started",
        "node_finished",
        "model_request",
        "mcp_initialize",
        "mcp_list_tools",
        "tool_call",
        "handoff_validation",
        "factuality_assessment",
        "citation_assessment",
        "agent_output_retry",
        "edge_contract_rejected",
        "fault_injected",
        "approval_requested",
        "approval_resolved",
        "checkpoint_saved",
        "run_finished",
    ]
    started_at: datetime = Field(default_factory=utc_now)
    ended_at: datetime | None = None
    attempt: int = 1
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: Decimal | None = None
    validation_errors: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentInvocationRecord(BaseModel):
    invocation_id: str
    node_id: str
    attempt: int
    model_provider: str
    model_name: str
    output_contract: ContractRef
    request_fingerprint: str
    serialized_messages: list[dict[str, Any]]
    input_tokens: int | None = None
    output_tokens: int | None = None
    request_count: int = 0


class PendingApproval(BaseModel):
    approval_id: str
    run_id: str
    checkpoint_id: str
    tool_call_id: str
    validated_args_hash: str
    config_hash: str
    status: Literal["pending", "approved", "denied", "consumed", "expired"]
    arguments: dict[str, Any] = Field(default_factory=dict)


class RunMetrics(BaseModel):
    duration_ms: float
    request_count: int
    input_tokens: int
    output_tokens: int
    tool_calls: int
    first_attempt_contract_pass: bool
    final_contract_pass: bool
    task_pass: bool | None
    containment: bool | None
    propagation_depth: int
    blast_radius: int | None
    critical_output_escape: bool | None
    unknown_assessment_rate: float
    labels: dict[str, Literal["measurement", "calculated", "structural", "not_measured"]]


class PydanticEvidence(BaseModel):
    evidence_id: str
    node_id: str
    layer: Literal[
        "input_contract",
        "agent_output",
        "edge_contract",
        "tool_arguments",
        "task_quality",
    ]
    contract_name: str | None = None
    status: Literal["passed", "repaired", "rejected", "failed", "not_applicable"]
    title: str
    explanation: str
    attempt: int = 1
    validation_errors: list[dict[str, Any]] = Field(default_factory=list)
    schema_excerpt: dict[str, Any] = Field(default_factory=dict)
    input_snapshot: dict[str, Any] | None = None
    output_snapshot: dict[str, Any] | None = None
    guarantee: Literal["contract", "factuality", "citation", "policy", "task_quality"]
    teaching_note: str


class RunRecord(BaseModel):
    run_id: str
    trace_id: str
    scenario_id: str = "threat-analyst"
    variant: Literal["baseline", "hardened"]
    run_mode: Literal["fixture", "live"]
    terminal_status: Literal["running", "paused", "succeeded", "failed"]
    started_at: datetime = Field(default_factory=utc_now)
    ended_at: datetime | None = None
    failure_reason: str | None = None
    runtime_build_hash: str
    fixture_set_version: str | None = "threat-fixtures-v1"
    workflow_hash: str
    config_hash: str
    input: dict[str, Any]
    fault_plan: list[FaultInjection]
    events: list[RunEvent] = Field(default_factory=list)
    agent_invocations: list[AgentInvocationRecord] = Field(default_factory=list)
    claim_assessments: list[ClaimAssessment] = Field(default_factory=list)
    outputs: dict[str, Any] = Field(default_factory=dict)
    pending_approvals: list[PendingApproval] = Field(default_factory=list)
    metrics: RunMetrics | None = None
    pydantic_evidence: list[PydanticEvidence] = Field(default_factory=list)
    semantic_trace_hash: str | None = None
    operation: Literal["execute", "fixture_replay", "checkpoint_fork", "candidate_rerun"] = (
        "execute"
    )
    compared_to_run_id: str | None = None
    replay_comparison: dict[str, Any] | None = None
    external_requests: int = 0
    fixture_preset: str | None = None


class CreateRunRequest(BaseModel):
    scenario_id: str = Field(default="threat-analyst", min_length=1, max_length=128)
    variant: Literal["baseline", "hardened"] = "hardened"
    run_mode: Literal["fixture", "live"] = "fixture"
    input: dict[str, Any] = Field(default_factory=dict)
    fault_plan: list[FaultInjection] = Field(default_factory=list)
    fixture_preset: str | None = Field(default=None, min_length=1, max_length=128)


class ResumeRunRequest(BaseModel):
    pending_approval_id: str
    decision: Literal["approved", "denied"]
    idempotency_key: str = Field(min_length=8, max_length=128)


class CheckpointForkRequest(BaseModel):
    checkpoint_id: str | None = None
    input_override: dict[str, Any] = Field(default_factory=dict)


class CandidateRerunRequest(BaseModel):
    variant: Literal["baseline", "hardened"] | None = None
    input_override: dict[str, Any] = Field(default_factory=dict)
    fault_plan: list[FaultInjection] | None = None


class EvalRunRequest(BaseModel):
    scenario_id: str = Field(default="threat-analyst", min_length=1, max_length=128)
    cases: list[str] | None = None


class EvalCaseResult(BaseModel):
    name: str
    version: str
    passed: bool
    assertions: dict[str, bool]
    metrics: dict[str, float | int | str | bool | None]
    mutation_plan: dict[str, Any]
    evidence: list[str]


class EvalReport(BaseModel):
    report_id: str
    suite_version: str
    generated_at: datetime = Field(default_factory=utc_now)
    engine: str = "pydantic-evals"
    cases: list[EvalCaseResult]
    passed: int
    failed: int


class ApprovalError(StrEnum):
    UNKNOWN = "unknown_approval"
    CROSS_RUN = "cross_run_approval"
    STALE = "stale_approval"
    CONSUMED = "consumed_approval"
    TAMPERED = "tampered_approval"
    DUPLICATE = "duplicate_resume"


class WorkflowValidationResponse(BaseModel):
    valid: bool
    errors: list[str]
    workflow_hash: str | None = None
    normalized: WorkflowSpec | None = None

    @model_validator(mode="after")
    def consistent(self) -> WorkflowValidationResponse:
        if self.valid and (self.errors or self.normalized is None):
            raise ValueError("valid workflow responses require a normalized workflow and no errors")
        return self
