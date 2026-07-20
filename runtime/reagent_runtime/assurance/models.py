from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import Field, RootModel, field_validator

from .wire import (
    StableId,
    StrictWireDTO,
    WireDecimal,
    WireSemVer,
    WireSHA256,
    WireTimestamp,
    WireUUID,
)

NonEmpty = Annotated[str, Field(min_length=1)]
ScenarioId = Literal[
    "threat-analyst",
    "bloated-swarm",
    "content-machine",
    "due-diligence-engine",
    "gold-plater",
    "mcp-migration",
    "ops-center",
    "safety-net",
]


class PositionDTO(StrictWireDTO):
    x: float
    y: float


class BoundConfig(StrictWireDTO):
    label: str
    assurance_operation_id: StableId | None = None
    assurance_operation_version: WireSemVer | None = None


class InputConfig(BoundConfig):
    pass


class OutputConfig(BoundConfig):
    pass


class ExecutorAssuranceConfig(StrictWireDTO):
    enabled: bool = False
    contract_id: StableId
    contract_version: WireSemVer
    strict: bool = True
    output_mode: Literal["tool", "native", "prompted"]
    validation_retries: int = Field(ge=0, le=3)


class ExecutorConfig(BoundConfig):
    model: StableId
    system_prompt: str
    tools: list[StableId]
    assurance: ExecutorAssuranceConfig | None = None
    output_schema: str | None = None


class EvaluatorConfig(BoundConfig):
    model: StableId | None = None
    evaluation_prompt: str = ""
    pass_fail_criteria: str = ""


class RouterConfig(BoundConfig):
    model: StableId
    routing_prompt: str
    routes: list[StableId] = Field(min_length=1)


class McpConfig(BoundConfig):
    served_tools: list[StableId]


class LabelOnlyConfig(BoundConfig):
    pass


class RagConfig(BoundConfig):
    k_value: int = Field(ge=1, le=20)
    retrieval_mode: Literal["bm25", "vector", "hybrid"] = "hybrid"


class ApiConfig(BoundConfig):
    endpoint: StableId


class CodeValidatorConfig(BoundConfig):
    validator_id: StableId


class ContextConfig(BoundConfig):
    context_gate_mode: StableId
    handoff_brief: str


class ReviewConfig(BoundConfig):
    review_type: Literal["approval", "edit", "escalation"]


class TypedHandoffGateConfig(StrictWireDTO):
    label: str
    contract_id: StableId
    contract_version: WireSemVer
    validation_method: Literal["validate_python", "validate_json"]
    strict: bool = True
    reject_behavior: Literal["route", "stop", "request_revision"]


class EvidenceCheckConfig(StrictWireDTO):
    label: str
    check_ids: list[StableId] = Field(min_length=1)
    aggregation: Literal["all", "any", "weighted"] = "all"
    check_weights: dict[StableId, WireDecimal] = Field(default_factory=dict)
    passing_score: WireDecimal | None = None
    failure_behavior: Literal["route", "stop"] = "route"

    @field_validator("check_ids")
    @classmethod
    def check_ids_are_unique(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("check_ids must be unique")
        return value


class KafkaConfig(BoundConfig):
    pass


class NodeBase(StrictWireDTO):
    id: StableId
    position: PositionDTO
    locked: bool = False


class InputNode(NodeBase):
    type: Literal["input"]
    config: InputConfig


class OutputNode(NodeBase):
    type: Literal["output"]
    config: OutputConfig


class ExecutorNode(NodeBase):
    type: Literal["executor"]
    config: ExecutorConfig


class EvaluatorNode(NodeBase):
    type: Literal["evaluator"]
    config: EvaluatorConfig


class RouterNode(NodeBase):
    type: Literal["router"]
    config: RouterConfig


class McpNode(NodeBase):
    type: Literal["mcp_server"]
    config: McpConfig


class WebNode(NodeBase):
    type: Literal["web_search"]
    config: LabelOnlyConfig


class FileNode(NodeBase):
    type: Literal["file_rw"]
    config: LabelOnlyConfig


class RagNode(NodeBase):
    type: Literal["tool_rag"]
    config: RagConfig


class ApiNode(NodeBase):
    type: Literal["api_call"]
    config: ApiConfig


class CodeNode(NodeBase):
    type: Literal["code_exec"]
    config: CodeValidatorConfig


class ContextNode(NodeBase):
    type: Literal["context_gate"]
    config: ContextConfig


class FallbackNode(NodeBase):
    type: Literal["fallback_router"]
    config: LabelOnlyConfig


class ReviewNode(NodeBase):
    type: Literal["human_review"]
    config: ReviewConfig


class KafkaNode(NodeBase):
    type: Literal["kafka_stream"]
    config: KafkaConfig


class TypedHandoffGateNode(NodeBase):
    type: Literal["typed_handoff_gate"]
    config: TypedHandoffGateConfig


class EvidenceCheckNode(NodeBase):
    type: Literal["evidence_check"]
    config: EvidenceCheckConfig


SimulatorNodeDTO = Annotated[
    InputNode
    | OutputNode
    | ExecutorNode
    | EvaluatorNode
    | RouterNode
    | McpNode
    | WebNode
    | FileNode
    | RagNode
    | ApiNode
    | CodeNode
    | ContextNode
    | FallbackNode
    | ReviewNode
    | KafkaNode
    | TypedHandoffGateNode
    | EvidenceCheckNode,
    Field(discriminator="type"),
]


class SimulatorEdgeDTO(StrictWireDTO):
    id: StableId
    source: StableId
    target: StableId
    source_handle: StableId | None = None
    target_handle: StableId | None = None
    kind: Literal["normal", "conditional", "failure", "retry"] = "normal"
    fan_out: Literal["all", "exclusive"] | None = None
    route_probability: WireDecimal | None = None
    max_attempts: int | None = Field(default=None, ge=1, le=4)


class SimulatorGraphDTO(StrictWireDTO):
    schema_version: Literal["simulator.graph.v1"]
    nodes: list[SimulatorNodeDTO]
    edges: list[SimulatorEdgeDTO]


class AssuranceExecutionPolicy(StrictWireDTO):
    max_outer_revisions: int = Field(default=0, ge=0, le=3)


class CompileRequest(StrictWireDTO):
    schema_version: Literal["assurance.compile.v1"]
    scenario_id: ScenarioId
    graph: SimulatorGraphDTO
    execution_policy: AssuranceExecutionPolicy
    seed_policy: Literal["fixed"] = "fixed"
    idempotency_key: WireUUID


class ThreatAnalystInput(StrictWireDTO):
    kind: Literal["threat-analyst"]
    indicators: list[NonEmpty] = Field(min_length=1)
    observed_at: WireTimestamp
    tenant_id: NonEmpty


class BloatedSwarmInput(StrictWireDTO):
    kind: Literal["bloated-swarm"]
    query: NonEmpty
    customer_id: NonEmpty
    channel: Literal["web", "email", "chat"]


class ContentMachineInput(StrictWireDTO):
    kind: Literal["content-machine"]
    content_brief: NonEmpty
    target_audience: NonEmpty
    tone: NonEmpty
    format: Literal["blog", "social", "email"]


class DueDiligenceInput(StrictWireDTO):
    kind: Literal["due-diligence-engine"]
    target_company: NonEmpty
    deal_size_usd: WireDecimal
    strategic_rationale: NonEmpty
    concerns: list[NonEmpty] = Field(min_length=1)

    @field_validator("deal_size_usd")
    @classmethod
    def positive_deal_size(cls, value: str) -> str:
        from decimal import Decimal

        if Decimal(value) <= 0:
            raise ValueError("deal_size_usd must be greater than zero")
        return value


class GoldPlaterInput(StrictWireDTO):
    kind: Literal["gold-plater"]
    task: NonEmpty
    constraints: list[NonEmpty] = Field(min_length=1)
    authorization_scope: list[NonEmpty] = Field(min_length=1)


class McpMigrationInput(StrictWireDTO):
    kind: Literal["mcp-migration"]
    request: NonEmpty
    domain_hint: Literal["research", "data", "comms"] | None
    resource_refs: list[NonEmpty] = Field(min_length=1)


class OpsCenterInput(StrictWireDTO):
    kind: Literal["ops-center"]
    alert: NonEmpty
    affected_systems: list[NonEmpty] = Field(min_length=1)
    observed_at: WireTimestamp
    severity_hint: Literal["critical", "routine", "unknown"]


class SafetyNetInput(StrictWireDTO):
    kind: Literal["safety-net"]
    request: NonEmpty
    file_refs: list[NonEmpty] = Field(min_length=1)
    allow_partial: bool


RunInputDTO = Annotated[
    ThreatAnalystInput
    | BloatedSwarmInput
    | ContentMachineInput
    | DueDiligenceInput
    | GoldPlaterInput
    | McpMigrationInput
    | OpsCenterInput
    | SafetyNetInput,
    Field(discriminator="kind"),
]


class RunRequest(StrictWireDTO):
    schema_version: Literal["assurance.run.v1"]
    artifact_id: WireUUID
    candidate_hash: WireSHA256
    input: RunInputDTO
    deterministic_seed: int = Field(ge=0, le=2_147_483_647)
    idempotency_key: WireUUID


class EvalRequest(StrictWireDTO):
    schema_version: Literal["assurance.eval.v1"]
    artifact_id: WireUUID
    candidate_hash: WireSHA256
    suite_id: StableId
    suite_version: WireSemVer
    seed_policy: Literal["fixed"] = "fixed"
    idempotency_key: WireUUID


class PatchPreviewRequest(StrictWireDTO):
    schema_version: Literal["assurance.patch_preview.v1"]
    scenario_id: ScenarioId
    graph: SimulatorGraphDTO
    base_source_graph_hash: WireSHA256


class CompileIssue(StrictWireDTO):
    code: StableId
    message: str
    node_id: StableId | None = None
    edge_id: StableId | None = None
    path: list[str | int] = Field(default_factory=list)


class AnyStrictObject(RootModel[dict[str, Any]]):
    pass
