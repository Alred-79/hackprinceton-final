from __future__ import annotations

import hashlib
import inspect
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import CodeType, MappingProxyType
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .models import ScenarioId
from .wire import StableId, StrictWireDTO, WireSemVer, canonical_hash

SCENARIOS: tuple[str, ...] = (
    "threat-analyst",
    "bloated-swarm",
    "content-machine",
    "due-diligence-engine",
    "gold-plater",
    "mcp-migration",
    "ops-center",
    "safety-net",
)
ADAPTER_VERSION = "1.0.0"
COMPILER_VERSION = "1.0.0"
FIXTURE_MODEL_ID = "reagent-fixture-v1"


class StrictContractModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")


class ThreatReport(StrictContractModel):
    title: str
    summary: str
    claims: list[str]
    source_ids: list[str]


class ThreatReportV2(StrictContractModel):
    threat_id: str = Field(description="Stable identifier for the analyzed threat.")
    severity: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
    title: str
    summary: str
    indicators: list[str]
    source_ids: list[str]
    claims: list[str]
    affected_assets: list[str]
    attack_vector: str
    recommended_actions: list[str]
    confidence: Literal["high", "medium", "low"]
    data_gaps: list[str]


class DelegatedTaskResult(StrictContractModel):
    answer: str
    tools_used: list[str]
    authorized: bool


class PublishableContent(StrictContractModel):
    content: str
    citations: list[str]
    brand_compliant: bool


class DiligenceReport(StrictContractModel):
    summary: str
    findings: list[str]
    evidence_refs: list[str]


class DiligenceFinancialsV2(StrictContractModel):
    revenue: str
    growth_rate: str
    margins: str
    key_metrics: list[str]


class DiligenceRiskV2(StrictContractModel):
    category: str
    description: str
    severity: Literal["critical", "high", "medium", "low"]
    evidence_refs: list[str]


class DiligenceReportV2(StrictContractModel):
    company_overview: str
    financials: DiligenceFinancialsV2
    risks: list[DiligenceRiskV2]
    team_assessment: str
    recommendation: Literal["strong_buy", "buy", "hold", "pass"]
    confidence_level: Literal["high", "medium", "low"]
    caveats: list[str]
    findings: list[str]
    evidence_refs: list[str]


class ImplementationResult(StrictContractModel):
    summary: str
    completed_scope: list[str]
    unauthorized_work: list[str]


class MigrationReport(StrictContractModel):
    summary: str
    tools_used: list[str]
    catalog_size: int = Field(ge=0)


class IncidentAction(StrictContractModel):
    summary: str
    action: str
    requires_approval: bool
    approved: bool


class IncidentActionV2(StrictContractModel):
    severity: Literal["P1-Critical", "P2-High", "P3-Medium", "P4-Low"]
    title: str
    summary: str
    affected_systems: list[str]
    root_cause: str
    impact: str
    mitigation_steps: list[str]
    status: Literal["investigating", "identified", "mitigated", "resolved"]
    action: str
    requires_approval: bool
    approved: bool


class SafetyDecision(StrictContractModel):
    decision: Literal["allow", "reject", "escalate"]
    reason: str
    fields_present: list[str]


class IocHandoff(StrictContractModel):
    indicators: list[str]
    source_ids: list[str]


class AgentHandoff(StrictContractModel):
    task: str
    allowed_tools: list[str]


class ContentHandoff(StrictContractModel):
    content: str
    citations: list[str]


class FindingHandoff(StrictContractModel):
    finding: str
    evidence_refs: list[str]


class ScopeHandoff(StrictContractModel):
    requested_scope: list[str]
    completed_scope: list[str]


class ToolResult(StrictContractModel):
    tool_name: str
    result: str
    schema_version: str


class IncidentHandoff(StrictContractModel):
    incident: str
    proposed_action: str


class SafetyHandoff(StrictContractModel):
    fields: dict[str, str]
    complete: bool


class ContractRecord(StrictWireDTO):
    contract_id: StableId
    version: WireSemVer
    kind: Literal["output", "handoff", "envelope"]
    json_schema_digest: str
    json_schema: dict[str, Any]
    supported_output_modes: list[Literal["tool", "native", "prompted"]]


class CheckRecord(StrictWireDTO):
    check_id: StableId
    version: WireSemVer
    title: str
    engine: Literal["deterministic"] = "deterministic"
    method: str
    threshold: str = "1"
    implementation_fingerprint: str


class PortCapability(StrictWireDTO):
    id: StableId
    direction: Literal["input", "output"]
    payload_contract_id: StableId
    payload_contract_version: WireSemVer
    cardinality: Literal["one", "many"]


class StateBinding(StrictWireDTO):
    source: Literal["request.input", "incoming.payload", "incoming.payloads"]
    source_port: StableId | None
    target_state_key: StableId
    merge: Literal["replace", "ordered_list"]


class ExecutorContractBinding(StrictWireDTO):
    contract_id: StableId
    contract_version: WireSemVer
    supported_output_modes: tuple[Literal["tool", "native", "prompted"], ...]


class NodeCapability(StrictWireDTO):
    scenario_id: ScenarioId
    node_type: StableId
    capability_template_id: StableId
    operation_id: StableId
    operation_version: WireSemVer
    config_schema_id: StableId
    config_schema_version: WireSemVer
    input_ports: tuple[PortCapability, ...]
    output_ports: tuple[PortCapability, ...]
    input_bindings: tuple[StateBinding, ...]
    state_reads: tuple[StableId, ...]
    state_writes: tuple[StableId, ...]
    state_reducers: dict[StableId, Literal["replace", "ordered_list"]]
    lowerer_id: StableId
    lowerer_version: WireSemVer
    reentry_supported: bool
    default_config: dict[str, Any]
    supported_edge_kinds: tuple[Literal["normal", "conditional", "failure", "retry"], ...]
    allowed_executor_contracts: tuple[ExecutorContractBinding, ...] = ()
    operation_role: Literal["input", "terminal", "handoff_producer", "transform", "router"]
    config_constraints: dict[str, Any]
    produced_payload_contracts: tuple[ExecutorContractBinding, ...] = ()


def _port(
    identifier: str,
    direction: Literal["input", "output"],
    contract: str = "payload",
    cardinality: Literal["one", "many"] = "one",
) -> PortCapability:
    return PortCapability(
        id=identifier,
        direction=direction,
        payload_contract_id=contract,
        payload_contract_version="1.0.0",
        cardinality=cardinality,
    )


TEMPLATE_META: dict[str, dict[str, Any]] = {
    "input": {
        "template": "cap.input@1",
        "inputs": (),
        "outputs": (_port("out", "output", "run_input"),),
        "schema": "cfg.input@1",
        "lowerer": "lower.input@1",
    },
    "output": {
        "template": "cap.output@1",
        "inputs": (_port("in", "input"),),
        "outputs": (),
        "schema": "cfg.output@1",
        "lowerer": "lower.output@1",
    },
    "executor": {
        "template": "cap.executor@1",
        "inputs": (_port("in", "input", cardinality="many"),),
        "outputs": (_port("success", "output"), _port("failure", "output", "executor_failure")),
        "schema": "cfg.executor@1",
        "lowerer": "lower.executor@1",
    },
    "mcp_server": {
        "template": "cap.mcp@1",
        "inputs": (_port("in", "input"),),
        "outputs": (_port("success", "output"), _port("failure", "output", "tool_failure")),
        "schema": "cfg.mcp@1",
        "lowerer": "lower.mcp@1",
    },
    "web_search": {
        "template": "cap.web@1",
        "inputs": (_port("in", "input"),),
        "outputs": (_port("success", "output"), _port("failure", "output", "tool_failure")),
        "schema": "cfg.web@1",
        "lowerer": "lower.web@1",
    },
    "file_rw": {
        "template": "cap.file_read@1",
        "inputs": (_port("in", "input"),),
        "outputs": (_port("success", "output"), _port("failure", "output", "tool_failure")),
        "schema": "cfg.file_read@1",
        "lowerer": "lower.file_read@1",
    },
    "tool_rag": {
        "template": "cap.rag@1",
        "inputs": (_port("in", "input"),),
        "outputs": (_port("success", "output"), _port("failure", "output", "tool_failure")),
        "schema": "cfg.rag@1",
        "lowerer": "lower.rag@1",
    },
    "api_call": {
        "template": "cap.api@1",
        "inputs": (_port("in", "input"),),
        "outputs": (_port("success", "output"), _port("failure", "output", "tool_failure")),
        "schema": "cfg.api@1",
        "lowerer": "lower.api@1",
    },
    "code_exec": {
        "template": "cap.code_validator@1",
        "inputs": (_port("in", "input"),),
        "outputs": (_port("success", "output"), _port("failure", "output", "tool_failure")),
        "schema": "cfg.code_validator@1",
        "lowerer": "lower.code_validator@1",
    },
    "context_gate": {
        "template": "cap.context@1",
        "inputs": (_port("in", "input", cardinality="many"),),
        "outputs": (_port("out", "output"),),
        "schema": "cfg.context@1",
        "lowerer": "lower.context@1",
    },
    "fallback_router": {
        "template": "cap.fallback@1",
        "inputs": (_port("in", "input"),),
        "outputs": (_port("success", "output"), _port("error", "output", "tool_failure")),
        "schema": "cfg.fallback@1",
        "lowerer": "lower.fallback@1",
    },
    "human_review": {
        "template": "cap.review@1",
        "inputs": (_port("in", "input"),),
        "outputs": (_port("approved", "output"), _port("rejected", "output", "review_rejection")),
        "schema": "cfg.review@1",
        "lowerer": "lower.review@1",
    },
}


CATALOG: dict[str, dict[str, tuple[str, ...]]] = {
    "threat-analyst": {
        "input": ("ingest_indicators",),
        "mcp_server": ("query_osint", "read_feed", "query_intel", "sandbox_ioc", "dispatch_alert"),
        "tool_rag": ("retrieve_intel_knowledge",),
        "executor": ("enrich_ioc", "correlate_ioc", "analyze_threat", "write_brief"),
        "output": ("emit_threat_brief",),
    },
    "bloated-swarm": {
        "input": ("ingest_support_query",),
        "router": ("classify_support_domain",),
        "executor": ("answer_support_query",),
        "context_gate": ("compact_support_handoff",),
        "output": ("emit_support_response",),
    },
    "content-machine": {
        "input": ("ingest_content_brief",),
        "router": ("classify_content_format",),
        "executor": ("generate_content", "revise_content"),
        "context_gate": ("compact_revision_context",),
        "api_call": ("publish_content",),
        "output": ("emit_content",),
    },
    "due-diligence-engine": {
        "input": ("ingest_deal_brief",),
        "executor": ("plan_research", "note_evidence_gap", "write_memo", "revise_memo"),
        "web_search": ("research_market",),
        "file_rw": ("read_legal_docs",),
        "tool_rag": ("research_company",),
        "fallback_router": ("route_legal_read",),
        "context_gate": ("filter_research", "compact_memo_revision"),
        "human_review": ("approve_memo",),
        "output": ("emit_memo",),
    },
    "gold-plater": {
        "input": ("ingest_task",),
        "executor": ("classify_task", "format_result", "analyze_task"),
        "output": ("emit_implementation_result",),
    },
    "mcp-migration": {
        "input": ("ingest_data_request",),
        "router": ("classify_tool_domain",),
        "mcp_server": ("research_tools", "data_tools", "comms_tools"),
        "executor": ("process_research", "process_data", "process_comms"),
        "output": ("emit_migration_result",),
    },
    "ops-center": {
        "input": ("ingest_incident",),
        "web_search": ("check_status_pages",),
        "file_rw": ("read_system_logs",),
        "tool_rag": ("lookup_runbook",),
        "fallback_router": ("route_log_read",),
        "context_gate": ("filter_diagnostics",),
        "router": ("classify_severity",),
        "executor": ("write_critical_report", "write_routine_report", "ack_missing_logs"),
        "human_review": ("approve_critical_action",),
        "output": ("emit_incident_report",),
    },
    "safety-net": {
        "input": ("ingest_document_request",),
        "file_rw": ("read_document",),
        "fallback_router": ("route_document_read",),
        "executor": ("process_document", "write_fallback"),
        "context_gate": ("structure_document_handoff",),
        "code_exec": ("validate_document",),
        "output": ("emit_document_result",),
    },
}

ROUTES: dict[tuple[str, str], tuple[str, ...]] = {
    ("bloated-swarm", "classify_support_domain"): (
        "refund",
        "shipping",
        "billing",
        "password",
        "product",
        "complaint",
        "general",
    ),
    ("content-machine", "classify_content_format"): ("blog", "social", "email"),
    ("mcp-migration", "classify_tool_domain"): ("research", "data", "comms"),
    ("ops-center", "classify_severity"): ("critical", "routine"),
}

CONTRACT_IDS_BY_SCENARIO: dict[str, tuple[str, str]] = {
    "threat-analyst": ("threat_report", "ioc_handoff"),
    "bloated-swarm": ("delegated_task_result", "agent_handoff"),
    "content-machine": ("publishable_content", "content_handoff"),
    "due-diligence-engine": ("diligence_report", "finding_handoff"),
    "gold-plater": ("implementation_result", "scope_handoff"),
    "mcp-migration": ("migration_report", "tool_result"),
    "ops-center": ("incident_action", "incident_handoff"),
    "safety-net": ("safety_decision", "safety_handoff"),
}

# Contract versions are independent from operation versions. The richer terminal
# contracts retain their v1 predecessors for replay compatibility while new graphs
# bind only to the latest registered version.
LATEST_CONTRACT_VERSION_BY_ID: dict[str, str] = {
    contract_id: "1.0.0"
    for contract_ids in CONTRACT_IDS_BY_SCENARIO.values()
    for contract_id in contract_ids
}
LATEST_CONTRACT_VERSION_BY_ID.update(
    {
        "threat_report": "2.0.0",
        "diligence_report": "2.0.0",
        "incident_action": "2.0.0",
    }
)

EXECUTOR_CONTRACT_BY_OPERATION: dict[tuple[str, str], str] = {
    ("threat-analyst", "enrich_ioc"): "ioc_handoff",
    ("threat-analyst", "correlate_ioc"): "ioc_handoff",
    ("threat-analyst", "analyze_threat"): "ioc_handoff",
    ("threat-analyst", "write_brief"): "threat_report",
    ("bloated-swarm", "answer_support_query"): "delegated_task_result",
    ("content-machine", "generate_content"): "content_handoff",
    ("content-machine", "revise_content"): "publishable_content",
    ("due-diligence-engine", "plan_research"): "finding_handoff",
    ("due-diligence-engine", "note_evidence_gap"): "finding_handoff",
    ("due-diligence-engine", "write_memo"): "diligence_report",
    ("due-diligence-engine", "revise_memo"): "diligence_report",
    ("gold-plater", "classify_task"): "scope_handoff",
    ("gold-plater", "analyze_task"): "scope_handoff",
    ("gold-plater", "format_result"): "implementation_result",
    ("mcp-migration", "process_research"): "tool_result",
    ("mcp-migration", "process_data"): "tool_result",
    ("mcp-migration", "process_comms"): "migration_report",
    ("ops-center", "write_critical_report"): "incident_action",
    ("ops-center", "write_routine_report"): "incident_action",
    ("ops-center", "ack_missing_logs"): "incident_handoff",
    ("safety-net", "process_document"): "safety_handoff",
    ("safety-net", "write_fallback"): "safety_decision",
}

CONTEXT_CONTRACT_BY_OPERATION: dict[tuple[str, str], str] = {
    ("bloated-swarm", "compact_support_handoff"): "agent_handoff",
    ("content-machine", "compact_revision_context"): "content_handoff",
    ("due-diligence-engine", "filter_research"): "finding_handoff",
    ("due-diligence-engine", "compact_memo_revision"): "finding_handoff",
    ("ops-center", "filter_diagnostics"): "incident_handoff",
    ("safety-net", "structure_document_handoff"): "safety_handoff",
}


def _contract_binding(contract_id: str) -> ExecutorContractBinding:
    return ExecutorContractBinding(
        contract_id=contract_id,
        contract_version=LATEST_CONTRACT_VERSION_BY_ID[contract_id],
        supported_output_modes=("tool", "native", "prompted"),
    )


def _config_constraints(scenario_id: str, node_type: str, operation_id: str) -> dict[str, Any]:
    constraints: dict[str, Any] = {"operation_version": "1.0.0"}
    if node_type in {"executor", "router"}:
        constraints["models"] = [FIXTURE_MODEL_ID]
    if node_type == "executor":
        constraints["tools"] = []
    elif node_type == "router":
        constraints["routes"] = list(ROUTES[(scenario_id, operation_id)])
    elif node_type == "mcp_server":
        constraints["served_tools"] = [operation_id]
    elif node_type == "api_call":
        constraints["endpoints"] = ["registered-publisher-v1"]
    elif node_type == "code_exec":
        constraints["validator_ids"] = ["document-validator-v1"]
    elif node_type == "context_gate":
        constraints["context_gate_modes"] = ["compact", "structured_sendoff"]
    elif node_type == "human_review":
        constraints["review_types"] = ["approval", "edit", "escalation"]
    elif node_type == "tool_rag":
        constraints["k_value"] = {"minimum": 1, "maximum": 20}
        constraints["retrieval_modes"] = ["bm25", "vector", "hybrid"]
    return constraints


def _operation_role(node_type: str, produced: tuple[ExecutorContractBinding, ...]) -> str:
    if node_type == "input":
        return "input"
    if node_type == "output":
        return "terminal"
    if produced:
        return (
            "handoff_producer"
            if node_type != "executor"
            or produced[0].contract_id.endswith("handoff")
            or produced[0].contract_id == "tool_result"
            else "terminal"
        )
    if node_type == "router":
        return "router"
    return "transform"


def _default_config(node_type: str, operation_id: str, scenario_id: str) -> dict[str, Any]:
    base: dict[str, Any] = {
        "label": operation_id.replace("_", " ").title(),
        "assurance_operation_id": operation_id,
        "assurance_operation_version": "1.0.0",
    }
    if node_type == "executor":
        base.update(
            model=FIXTURE_MODEL_ID, system_prompt="", tools=[], assurance=None, output_schema=None
        )
    elif node_type == "router":
        base.update(
            model=FIXTURE_MODEL_ID,
            routing_prompt="",
            routes=list(ROUTES[(scenario_id, operation_id)]),
        )
    elif node_type == "mcp_server":
        base["served_tools"] = [operation_id]
    elif node_type == "tool_rag":
        base["k_value"] = 5
        base["retrieval_mode"] = "hybrid"
    elif node_type == "api_call":
        base["endpoint"] = "registered-publisher-v1"
    elif node_type == "code_exec":
        base["validator_id"] = "document-validator-v1"
    elif node_type == "context_gate":
        base.update(context_gate_mode="compact", handoff_brief="")
    elif node_type == "human_review":
        base["review_type"] = "approval"
    return base


def _router_meta(scenario_id: str, operation_id: str) -> dict[str, Any]:
    outputs = tuple(_port(route, "output") for route in ROUTES[(scenario_id, operation_id)]) + (
        _port("failure", "output", "route_failure"),
    )
    return {
        "template": "cap.router@1",
        "inputs": (_port("in", "input"),),
        "outputs": outputs,
        "schema": "cfg.router@1",
        "lowerer": "lower.router@1",
    }


def build_capabilities() -> dict[tuple[str, str, str, str], NodeCapability]:
    records: dict[tuple[str, str, str, str], NodeCapability] = {}
    for scenario_id, by_type in CATALOG.items():
        for node_type, operation_ids in by_type.items():
            for operation_id in operation_ids:
                meta = (
                    _router_meta(scenario_id, operation_id)
                    if node_type == "router"
                    else TEMPLATE_META[node_type]
                )
                reads = (
                    ("incoming.payloads",)
                    if node_type in {"executor", "context_gate"}
                    else (("request.input",) if node_type == "input" else ("incoming.payload",))
                )
                writes = (
                    ("node.success", "node.failure")
                    if len(meta["outputs"]) > 1
                    else (("node.terminal",) if node_type == "output" else ("node.success",))
                )
                produced_contract_id = (
                    EXECUTOR_CONTRACT_BY_OPERATION.get((scenario_id, operation_id))
                    if node_type == "executor"
                    else CONTEXT_CONTRACT_BY_OPERATION.get((scenario_id, operation_id))
                )
                produced_contracts = (
                    (_contract_binding(produced_contract_id),) if produced_contract_id else ()
                )
                if node_type == "input":
                    input_bindings = (
                        StateBinding(
                            source="request.input",
                            source_port=None,
                            target_state_key="request.input",
                            merge="replace",
                        ),
                    )
                elif meta["inputs"]:
                    input_port = meta["inputs"][0]
                    many = input_port.cardinality == "many"
                    input_bindings = (
                        StateBinding(
                            source="incoming.payloads" if many else "incoming.payload",
                            source_port=input_port.id,
                            target_state_key=(
                                "incoming.payloads" if many else "incoming.payload"
                            ),
                            merge="ordered_list" if many else "replace",
                        ),
                    )
                else:
                    input_bindings = ()
                records[(scenario_id, node_type, operation_id, "1.0.0")] = NodeCapability(
                    scenario_id=scenario_id,
                    node_type=node_type,
                    capability_template_id=meta["template"],
                    operation_id=operation_id,
                    operation_version="1.0.0",
                    config_schema_id=meta["schema"],
                    config_schema_version="1.0.0",
                    input_ports=meta["inputs"],
                    output_ports=meta["outputs"],
                    input_bindings=input_bindings,
                    state_reads=reads,
                    state_writes=writes,
                    state_reducers={key: "replace" for key in writes},
                    lowerer_id=f"lower.{scenario_id}.{operation_id}",
                    lowerer_version="1.0.0",
                    reentry_supported=node_type == "executor",
                    default_config=_default_config(node_type, operation_id, scenario_id),
                    supported_edge_kinds=("normal", "conditional", "failure", "retry")
                    if node_type == "executor"
                    else ("normal", "conditional", "failure"),
                    allowed_executor_contracts=produced_contracts
                    if node_type == "executor"
                    else (),
                    operation_role=_operation_role(node_type, produced_contracts),
                    config_constraints=_config_constraints(scenario_id, node_type, operation_id),
                    produced_payload_contracts=produced_contracts,
                )
    return records


CAPABILITIES: Mapping[tuple[str, str, str, str], NodeCapability] = MappingProxyType(
    build_capabilities()
)

CONTRACT_TYPES: dict[
    tuple[str, str], tuple[str, type[StrictContractModel], Literal["output", "handoff"]]
] = {
    ("threat_report", "1.0.0"): ("threat-analyst", ThreatReport, "output"),
    ("threat_report", "2.0.0"): ("threat-analyst", ThreatReportV2, "output"),
    ("ioc_handoff", "1.0.0"): ("threat-analyst", IocHandoff, "handoff"),
    ("delegated_task_result", "1.0.0"): (
        "bloated-swarm",
        DelegatedTaskResult,
        "output",
    ),
    ("agent_handoff", "1.0.0"): ("bloated-swarm", AgentHandoff, "handoff"),
    ("publishable_content", "1.0.0"): (
        "content-machine",
        PublishableContent,
        "output",
    ),
    ("content_handoff", "1.0.0"): ("content-machine", ContentHandoff, "handoff"),
    ("diligence_report", "1.0.0"): (
        "due-diligence-engine",
        DiligenceReport,
        "output",
    ),
    ("diligence_report", "2.0.0"): (
        "due-diligence-engine",
        DiligenceReportV2,
        "output",
    ),
    ("finding_handoff", "1.0.0"): (
        "due-diligence-engine",
        FindingHandoff,
        "handoff",
    ),
    ("implementation_result", "1.0.0"): (
        "gold-plater",
        ImplementationResult,
        "output",
    ),
    ("scope_handoff", "1.0.0"): ("gold-plater", ScopeHandoff, "handoff"),
    ("migration_report", "1.0.0"): ("mcp-migration", MigrationReport, "output"),
    ("tool_result", "1.0.0"): ("mcp-migration", ToolResult, "handoff"),
    ("incident_action", "1.0.0"): ("ops-center", IncidentAction, "output"),
    ("incident_action", "2.0.0"): ("ops-center", IncidentActionV2, "output"),
    ("incident_handoff", "1.0.0"): ("ops-center", IncidentHandoff, "handoff"),
    ("safety_decision", "1.0.0"): ("safety-net", SafetyDecision, "output"),
    ("safety_handoff", "1.0.0"): ("safety-net", SafetyHandoff, "handoff"),
}

SCENARIO_CONTRACTS: dict[str, tuple[tuple[str, str], ...]] = {
    scenario: tuple(
        contract_key
        for contract_key, (owner, _, _) in CONTRACT_TYPES.items()
        if owner == scenario
    )
    for scenario in SCENARIOS
}

CHECKS_BY_SCENARIO: dict[str, tuple[str, str]] = {
    "threat-analyst": ("ioc_source_traceability", "citation_grounding"),
    "bloated-swarm": ("tool_authorization", "handoff_integrity"),
    "content-machine": ("citation_grounding", "brand_policy"),
    "due-diligence-engine": ("claim_evidence_link", "source_coverage"),
    "gold-plater": ("authorization_scope", "requirement_coverage"),
    "mcp-migration": ("tool_schema_match", "catalog_budget"),
    "ops-center": ("policy_compliance", "approval_required"),
    "safety-net": ("required_fields_present", "escalation_policy"),
}


def contracts_for(scenario_id: str) -> list[ContractRecord]:
    result: list[ContractRecord] = []
    for contract_id, version in SCENARIO_CONTRACTS[scenario_id]:
        _, model, kind = CONTRACT_TYPES[(contract_id, version)]
        schema = model.model_json_schema()
        result.append(
            ContractRecord(
                contract_id=contract_id,
                version=version,
                kind=kind,
                json_schema_digest=canonical_hash(schema),
                json_schema=schema,
                supported_output_modes=["tool", "native", "prompted"],
            )
        )
    return result


def checks_for(scenario_id: str) -> list[CheckRecord]:
    return [
        CheckRecord(
            check_id=check_id,
            version="1.0.0",
            title=check_id.replace("_", " ").title(),
            method=f"assurance.check.{check_id}.v1",
            implementation_fingerprint=CHECK_REGISTRY[
                (scenario_id, check_id, "1.0.0")
            ].implementation_fingerprint,
        )
        for check_id in CHECKS_BY_SCENARIO[scenario_id]
    ]


def capabilities_for(scenario_id: str) -> list[NodeCapability]:
    return sorted(
        [record for key, record in CAPABILITIES.items() if key[0] == scenario_id],
        key=lambda item: (item.node_type, item.operation_id),
    )


def assurance_node_capabilities_for(scenario_id: str) -> list[NodeCapability]:
    records: list[NodeCapability] = []
    for node_type, outputs in (
        (
            "typed_handoff_gate",
            (
                _port("pass", "output"),
                _port("rejected", "output", "contract_failure"),
            ),
        ),
        (
            "evidence_check",
            (
                _port("pass", "output"),
                _port("failed", "output", "evidence_failure"),
            ),
        ),
    ):
        records.append(
            NodeCapability(
                scenario_id=scenario_id,
                node_type=node_type,
                capability_template_id=f"cap.{node_type}@1",
                operation_id=node_type,
                operation_version="1.0.0",
                config_schema_id=f"cfg.{node_type}@1",
                config_schema_version="1.0.0",
                input_ports=(_port("in", "input"),),
                output_ports=outputs,
                input_bindings=(
                    StateBinding(
                        source="incoming.payload",
                        source_port="in",
                        target_state_key="incoming.payload",
                        merge="replace",
                    ),
                ),
                state_reads=("incoming.payload",),
                state_writes=tuple(f"node.{port.id}" for port in outputs),
                state_reducers={f"node.{port.id}": "replace" for port in outputs},
                lowerer_id=f"lower.{scenario_id}.{node_type}",
                lowerer_version="1.0.0",
                reentry_supported=False,
                default_config={},
                supported_edge_kinds=("normal", "failure", "retry")
                if node_type == "typed_handoff_gate"
                else ("normal", "failure"),
                operation_role="transform",
                config_constraints={"operation_version": "1.0.0"},
            )
        )
    return records


def advertised_capabilities_for(scenario_id: str) -> list[NodeCapability]:
    return capabilities_for(scenario_id) + assurance_node_capabilities_for(scenario_id)


def registry_digests(
    scenario_id: str,
    *,
    lowerer_registry: Mapping[tuple[str, str], LowererImplementation] | None = None,
    check_registry: Mapping[tuple[str, str, str], CheckImplementation] | None = None,
) -> dict[str, str]:
    active_lowerers = lowerer_registry or LOWERER_REGISTRY
    active_checks = check_registry or CHECK_REGISTRY
    capabilities = [
        item.model_dump(mode="json") for item in advertised_capabilities_for(scenario_id)
    ]
    lowerers = [
        {
            "id": implementation.lowerer_id,
            "version": implementation.lowerer_version,
            "operation_id": implementation.operation_id,
            "implementation_fingerprint": implementation.implementation_fingerprint,
        }
        for implementation in sorted(
            (item for item in active_lowerers.values() if item.scenario_id == scenario_id),
            key=lambda item: (item.lowerer_id, item.lowerer_version),
        )
    ]
    return {
        "capability_registry_digest": canonical_hash(capabilities),
        "lowerer_registry_digest": canonical_hash(lowerers),
        "contract_registry_digest": canonical_hash(
            [item.model_dump(mode="json") for item in contracts_for(scenario_id)]
        ),
        "check_registry_digest": canonical_hash(
            [
                {
                    **item.model_dump(mode="json"),
                    "implementation_fingerprint": active_checks[
                        (scenario_id, item.check_id, item.version)
                    ].implementation_fingerprint,
                }
                for item in checks_for(scenario_id)
            ]
        ),
    }


def capability_for(
    scenario_id: str, node_type: str, operation_id: str | None, version: str | None
) -> NodeCapability | None:
    if operation_id is None or version is None:
        return None
    return CAPABILITIES.get((scenario_id, node_type, operation_id, version))


def contract_type(
    scenario_id: str, contract_id: str, version: str
) -> type[StrictContractModel] | None:
    record = CONTRACT_TYPES.get((contract_id, version))
    if not record or record[0] != scenario_id:
        return None
    return record[1]


def output_contract_id(scenario_id: str) -> str:
    return next(
        contract_id
        for (contract_id, version), (owner, _, kind) in CONTRACT_TYPES.items()
        if owner == scenario_id
        and kind == "output"
        and version == LATEST_CONTRACT_VERSION_BY_ID[contract_id]
    )


def contract_sample(
    scenario_id: str,
    contract_id: str,
    payload: Mapping[str, Any],
    version: str | None = None,
) -> dict[str, Any]:
    resolved_version = version or LATEST_CONTRACT_VERSION_BY_ID[contract_id]
    if contract_type(scenario_id, contract_id, resolved_version) is None:
        raise KeyError(f"Unknown contract {contract_id}@{resolved_version} for {scenario_id}.")
    operation_id = str(payload.get("_assurance_operation_id", "fixture"))
    text = _semantic_leaf_text(payload) or f"{operation_id}: deterministic fixture output"
    samples: dict[str, dict[str, Any]] = {
        "threat_report": {
            "title": f"Threat report — {operation_id}",
            "summary": text,
            "claims": ["indicator observed"],
            "source_ids": ["src-fixture"],
        },
        "ioc_handoff": {
            "indicators": [f"{operation_id}:fixture-indicator"],
            "source_ids": ["src-fixture"],
        },
        "delegated_task_result": {
            "answer": text,
            "tools_used": ["approved-tool"],
            "authorized": True,
        },
        "agent_handoff": {"task": text, "allowed_tools": ["approved-tool"]},
        "publishable_content": {
            "content": text,
            "citations": ["src-fixture"],
            "brand_compliant": True,
        },
        "content_handoff": {"content": text, "citations": ["src-fixture"]},
        "diligence_report": {
            "summary": text,
            "findings": ["supported finding"],
            "evidence_refs": ["src-fixture"],
        },
        "finding_handoff": {
            "finding": f"{operation_id}:supported finding",
            "evidence_refs": ["src-fixture"],
        },
        "implementation_result": {
            "summary": text,
            "completed_scope": ["requested task"],
            "unauthorized_work": [],
        },
        "scope_handoff": {
            "requested_scope": [f"{operation_id}:requested"],
            "completed_scope": [f"{operation_id}:requested"],
        },
        "migration_report": {"summary": text, "tools_used": ["registered-tool"], "catalog_size": 3},
        "tool_result": {
            "tool_name": f"{operation_id}:registered-tool",
            "result": text,
            "schema_version": "1.0.0",
        },
        "incident_action": {
            "summary": text,
            "action": "observe",
            "requires_approval": False,
            "approved": False,
        },
        "incident_handoff": {"incident": text, "proposed_action": "observe"},
        "safety_decision": {
            "decision": "allow",
            "reason": f"{operation_id}: fixture fields are complete",
            "fields_present": ["request"],
        },
        "safety_handoff": {"fields": {"request": text}, "complete": True},
    }
    if (contract_id, resolved_version) == ("threat_report", "2.0.0"):
        return {
            "threat_id": "THREAT-FIXTURE-001",
            "severity": "HIGH",
            "title": f"Threat report — {operation_id}",
            "summary": text,
            "indicators": [f"{operation_id}:fixture-indicator"],
            "source_ids": ["src-fixture"],
            "claims": ["indicator observed"],
            "affected_assets": ["fixture-asset"],
            "attack_vector": "validated fixture vector",
            "recommended_actions": ["isolate fixture asset"],
            "confidence": "high",
            "data_gaps": [],
        }
    if (contract_id, resolved_version) == ("diligence_report", "2.0.0"):
        return {
            "company_overview": text,
            "financials": {
                "revenue": "$10M fixture revenue",
                "growth_rate": "20% fixture growth",
                "margins": "30% fixture margin",
                "key_metrics": ["fixture metric"],
            },
            "risks": [
                {
                    "category": "execution",
                    "description": "supported fixture risk",
                    "severity": "medium",
                    "evidence_refs": ["src-fixture"],
                }
            ],
            "team_assessment": "fixture team assessment",
            "recommendation": "hold",
            "confidence_level": "medium",
            "caveats": [],
            "findings": ["supported finding"],
            "evidence_refs": ["src-fixture"],
        }
    if (contract_id, resolved_version) == ("incident_action", "2.0.0"):
        return {
            "severity": "P2-High",
            "title": f"Incident action — {operation_id}",
            "summary": text,
            "affected_systems": ["fixture-service"],
            "root_cause": "validated fixture cause",
            "impact": "contained fixture impact",
            "mitigation_steps": ["observe fixture service"],
            "status": "identified",
            "action": "observe",
            "requires_approval": False,
            "approved": False,
        }
    return samples[contract_id]


def _stable_code_identity(code: CodeType) -> dict[str, Any]:
    constants = [
        _stable_code_identity(item) if isinstance(item, CodeType) else repr(item)
        for item in code.co_consts
    ]
    return {
        "bytecode": code.co_code.hex(),
        "constants": constants,
        "names": list(code.co_names),
        "varnames": list(code.co_varnames),
        "freevars": list(code.co_freevars),
        "cellvars": list(code.co_cellvars),
        "argcount": code.co_argcount,
        "posonlyargcount": code.co_posonlyargcount,
        "kwonlyargcount": code.co_kwonlyargcount,
    }


def _callable_fingerprint(
    function: Callable[..., Any],
    identity: Mapping[str, Any],
    *,
    _seen: set[int] | None = None,
) -> str:
    seen = _seen or set()
    if id(function) in seen:
        return canonical_hash(
            {
                "cycle": f"{getattr(function, '__module__', '')}."
                f"{getattr(function, '__qualname__', repr(function))}"
            }
        )
    seen.add(id(function))
    digest = hashlib.sha256()
    digest.update(canonical_hash(_stable_code_identity(function.__code__)).encode())
    digest.update(repr(function.__defaults__).encode())
    digest.update(repr(function.__kwdefaults__).encode())
    digest.update(repr(sorted(identity.items())).encode())
    digest.update(
        f"{getattr(function, '__module__', '')}."
        f"{getattr(function, '__qualname__', '')}".encode()
    )
    closure = function.__closure__ or ()
    digest.update(repr(tuple(cell.cell_contents for cell in closure)).encode())
    for name in sorted(set(function.__code__.co_names)):
        dependency = function.__globals__.get(name)
        if inspect.isfunction(dependency):
            digest.update(name.encode())
            digest.update(
                _callable_fingerprint(
                    dependency,
                    {"dependency": name},
                    _seen=set(seen),
                ).encode()
            )
    return digest.hexdigest()


def callable_fingerprint(function: Callable[..., Any], identity: Mapping[str, Any]) -> str:
    """Fingerprint a callable and the Python helper functions it resolves at runtime."""

    return _callable_fingerprint(function, identity)


def direct_callable_fingerprint(function: Callable[..., Any], identity: Mapping[str, Any]) -> str:
    """Fingerprint one explicitly registered implementation without global traversal."""

    digest = hashlib.sha256()
    digest.update(canonical_hash(_stable_code_identity(function.__code__)).encode())
    digest.update(repr(function.__defaults__).encode())
    digest.update(repr(function.__kwdefaults__).encode())
    digest.update(repr(sorted(identity.items())).encode())
    digest.update(f"{function.__module__}.{function.__qualname__}".encode())
    return digest.hexdigest()


@dataclass(frozen=True)
class LowererImplementation:
    scenario_id: str
    node_type: str
    operation_id: str
    operation_version: str
    lowerer_id: str
    lowerer_version: str
    execute: Callable[[Any, Mapping[str, Any], Mapping[str, Any]], dict[str, Any]]

    @property
    def implementation_fingerprint(self) -> str:
        return _callable_fingerprint(
            self.execute,
            {
                "scenario_id": self.scenario_id,
                "node_type": self.node_type,
                "operation_id": self.operation_id,
                "operation_version": self.operation_version,
                "lowerer_id": self.lowerer_id,
                "lowerer_version": self.lowerer_version,
            },
        )


def _make_lowerer(capability: NodeCapability) -> LowererImplementation:
    produced_contract = (
        capability.produced_payload_contracts[0].contract_id
        if capability.produced_payload_contracts
        else None
    )

    def execute(
        payload: Any,
        run_input: Mapping[str, Any],
        config: Mapping[str, Any],
        *,
        scenario_id: str = capability.scenario_id,
        node_type: str = capability.node_type,
        operation_id: str = capability.operation_id,
        produced_contract_id: str | None = produced_contract,
    ) -> dict[str, Any]:
        operation_payload = {
            **(payload if isinstance(payload, dict) else {"incoming_payloads": payload}),
            "_assurance_operation_id": operation_id,
            "_assurance_scenario_id": scenario_id,
        }
        if node_type == "input":
            return {"selected_handle": "out", "payload": dict(run_input)}
        if node_type == "output":
            return {"selected_handle": None, "payload": payload, "terminal": True}
        if node_type == "router":
            routes = list(config["routes"])
            haystack = str(dict(run_input)).lower()
            selected = next((route for route in routes if route in haystack), routes[0])
            return {"selected_handle": selected, "payload": operation_payload}
        if node_type == "executor":
            if any(
                marker in str(run_input).lower()
                for marker in ("gate-invalid-first", "handoff-drift")
            ) and not operation_payload.get("_assurance_revision_feedback"):
                return {
                    "selected_handle": "success",
                    "payload": {
                        "operation_id": operation_id,
                        "invalid_handoff": True,
                    },
                }
            if produced_contract_id:
                return {
                    "selected_handle": "success",
                    "payload": contract_sample(
                        scenario_id, produced_contract_id, operation_payload
                    ),
                }
        if node_type == "context_gate" and produced_contract_id:
            return {
                "selected_handle": "out",
                "payload": contract_sample(scenario_id, produced_contract_id, operation_payload),
            }
        handles = {
            "mcp_server": "success",
            "web_search": "success",
            "file_rw": "success",
            "tool_rag": "success",
            "api_call": "success",
            "code_exec": "success",
            "fallback_router": "success",
            "human_review": "approved",
        }
        return {
            "selected_handle": handles.get(node_type, "out"),
            "payload": {
                "operation_id": operation_id,
                "scenario_id": scenario_id,
                "input": payload,
            },
        }

    return LowererImplementation(
        scenario_id=capability.scenario_id,
        node_type=capability.node_type,
        operation_id=capability.operation_id,
        operation_version=capability.operation_version,
        lowerer_id=capability.lowerer_id,
        lowerer_version=capability.lowerer_version,
        execute=execute,
    )


_lowerer_registry: dict[tuple[str, str], LowererImplementation] = {
    (capability.lowerer_id, capability.lowerer_version): _make_lowerer(capability)
    for capability in CAPABILITIES.values()
}


def _make_assurance_node_lowerer(
    scenario_id: str, node_type: Literal["typed_handoff_gate", "evidence_check"]
) -> LowererImplementation:
    def execute(
        payload: Any,
        run_input: Mapping[str, Any],
        config: Mapping[str, Any],
        *,
        mechanism: str = node_type,
    ) -> dict[str, Any]:
        del run_input, config
        return {"selected_handle": None, "payload": payload, "mechanism": mechanism}

    return LowererImplementation(
        scenario_id=scenario_id,
        node_type=node_type,
        operation_id=node_type,
        operation_version="1.0.0",
        lowerer_id=f"lower.{scenario_id}.{node_type}",
        lowerer_version="1.0.0",
        execute=execute,
    )


for _scenario_id in SCENARIOS:
    for _node_type in ("typed_handoff_gate", "evidence_check"):
        _implementation = _make_assurance_node_lowerer(_scenario_id, _node_type)
        _lowerer_registry[(_implementation.lowerer_id, _implementation.lowerer_version)] = (
            _implementation
        )

LOWERER_REGISTRY: Mapping[tuple[str, str], LowererImplementation] = MappingProxyType(
    _lowerer_registry
)


def lowerer_for(lowerer_id: str, lowerer_version: str) -> LowererImplementation | None:
    return LOWERER_REGISTRY.get((lowerer_id, lowerer_version))


@dataclass(frozen=True)
class CheckImplementation:
    scenario_id: str
    check_id: str
    version: str
    markers: tuple[str, ...]
    evaluate: Callable[[Any, Mapping[str, Any]], tuple[str, bool]]

    @property
    def implementation_fingerprint(self) -> str:
        return _callable_fingerprint(
            self.evaluate,
            {
                "scenario_id": self.scenario_id,
                "check_id": self.check_id,
                "version": self.version,
                "markers": self.markers,
            },
        )


CHECK_MARKERS: dict[str, tuple[str, ...]] = {
    "ioc_source_traceability": ("untraced", "missing source"),
    "citation_grounding": ("invented", "false", "unsupported citation"),
    "tool_authorization": ("unauthorized",),
    "handoff_integrity": ("lost handoff", "corrupt"),
    "brand_policy": ("brand breach", "off-brand"),
    "claim_evidence_link": ("unsupported", "no evidence"),
    "source_coverage": ("missing source",),
    "authorization_scope": ("unauthorized", "extra work"),
    "requirement_coverage": ("missing requirement",),
    "tool_schema_match": ("schema drift",),
    "catalog_budget": ("bloat", "too many tools"),
    "policy_compliance": ("policy breach",),
    "approval_required": ("unapproved",),
    "required_fields_present": ("partial", "corrupt", "missing field"),
    "escalation_policy": ("must escalate",),
}


def _semantic_leaf_text(value: Any) -> str:
    """Flatten values, not mapping keys, so schema field names cannot trigger checks."""

    if isinstance(value, Mapping):
        return " ".join(_semantic_leaf_text(item) for item in value.values())
    if isinstance(value, (list, tuple, set)):
        return " ".join(_semantic_leaf_text(item) for item in value)
    return str(value)


def _make_check(scenario_id: str, check_id: str, markers: tuple[str, ...]) -> CheckImplementation:
    def evaluate(
        payload: Any,
        run_input: Mapping[str, Any],
        *,
        failure_markers: tuple[str, ...] = markers,
    ) -> tuple[str, bool]:
        haystack = f"{_semantic_leaf_text(payload)} {_semantic_leaf_text(run_input)}".lower()
        failed = any(marker in haystack for marker in failure_markers)
        return ("0" if failed else "1", not failed)

    return CheckImplementation(
        scenario_id=scenario_id,
        check_id=check_id,
        version="1.0.0",
        markers=markers,
        evaluate=evaluate,
    )


CHECK_REGISTRY: Mapping[tuple[str, str, str], CheckImplementation] = MappingProxyType(
    {
        (scenario_id, check_id, "1.0.0"): _make_check(
            scenario_id, check_id, CHECK_MARKERS[check_id]
        )
        for scenario_id, check_ids in CHECKS_BY_SCENARIO.items()
        for check_id in check_ids
    }
)


def check_decision(
    scenario_id: str,
    check_id: str,
    version: str,
    payload: Any,
    run_input: Mapping[str, Any],
) -> tuple[str, bool, str, str]:
    implementation = CHECK_REGISTRY[(scenario_id, check_id, version)]
    score, decision = implementation.evaluate(payload, run_input)
    return (
        score,
        decision,
        f"assurance.check.{check_id}.v1",
        implementation.implementation_fingerprint,
    )
