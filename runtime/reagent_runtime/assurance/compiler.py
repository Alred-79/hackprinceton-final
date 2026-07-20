from __future__ import annotations

from collections import defaultdict, deque
from copy import deepcopy
from decimal import Decimal
from typing import Any

from .models import CompileIssue, CompileRequest
from .registry import (
    ADAPTER_VERSION,
    CHECKS_BY_SCENARIO,
    COMPILER_VERSION,
    FIXTURE_MODEL_ID,
    ROUTES,
    NodeCapability,
    assurance_node_capabilities_for,
    capability_for,
    contract_type,
    lowerer_for,
    registry_digests,
)
from .wire import canonical_hash, canonical_json


class CompileValidationError(ValueError):
    def __init__(self, issues: list[CompileIssue]) -> None:
        self.issues = issues
        super().__init__("The submitted canvas graph is not executable in assurance mode.")


def _issue(
    code: str,
    message: str,
    *,
    node_id: str | None = None,
    edge_id: str | None = None,
    path: list[str | int] | None = None,
) -> CompileIssue:
    return CompileIssue(
        code=code,
        message=message,
        node_id=node_id,
        edge_id=edge_id,
        path=path or [],
    )


def _resolved_capability(node: Any, scenario_id: str) -> NodeCapability | None:
    if node.type in {"typed_handoff_gate", "evidence_check"}:
        return next(
            (
                item
                for item in assurance_node_capabilities_for(scenario_id)
                if item.node_type == node.type
            ),
            None,
        )
    config = node.config
    return capability_for(
        scenario_id,
        node.type,
        getattr(config, "assurance_operation_id", None),
        getattr(config, "assurance_operation_version", None),
    )


def _ports_for(node: Any, scenario_id: str) -> tuple[list[str], list[str]]:
    capability = _resolved_capability(node, scenario_id)
    if not capability:
        return [], []
    return (
        [port.id for port in capability.input_ports],
        [port.id for port in capability.output_ports],
    )


def _validate_capability(request: CompileRequest, node: Any) -> list[CompileIssue]:
    scenario_id = request.scenario_id
    if node.type == "evaluator":
        return [
            _issue(
                "LEGACY_EVALUATOR_NOT_EXECUTABLE",
                "Legacy evaluator nodes are design-only; use an Evidence Check.",
                node_id=node.id,
            )
        ]
    if node.type == "kafka_stream":
        return [
            _issue(
                "UNSUPPORTED_NODE_TYPE",
                "Kafka Stream has no v1 assurance capability for this scenario.",
                node_id=node.id,
            )
        ]
    if node.type == "typed_handoff_gate":
        if (
            contract_type(scenario_id, node.config.contract_id, node.config.contract_version)
            is None
        ):
            return [
                _issue(
                    "UNKNOWN_CONTRACT",
                    "The typed handoff contract is not registered for this scenario.",
                    node_id=node.id,
                )
            ]
        if (
            node.config.reject_behavior == "request_revision"
            and request.execution_policy.max_outer_revisions == 0
        ):
            return [
                _issue(
                    "OUTER_REVISION_BUDGET_REQUIRED",
                    "request_revision requires max_outer_revisions greater than zero.",
                    node_id=node.id,
                )
            ]
        return []
    if node.type == "evidence_check":
        issues: list[CompileIssue] = []
        known = set(CHECKS_BY_SCENARIO[scenario_id])
        unknown = set(node.config.check_ids) - known
        if unknown:
            issues.append(
                _issue(
                    "UNKNOWN_CHECK",
                    f"Checks are not registered for this scenario: {sorted(unknown)}",
                    node_id=node.id,
                )
            )
        if node.config.aggregation == "weighted":
            if set(node.config.check_weights) != set(node.config.check_ids):
                issues.append(
                    _issue(
                        "INVALID_CHECK_WEIGHTS",
                        "Weighted aggregation requires exactly one weight for every "
                        "selected check.",
                        node_id=node.id,
                    )
                )
            if any(Decimal(weight) <= 0 for weight in node.config.check_weights.values()):
                issues.append(
                    _issue(
                        "INVALID_CHECK_WEIGHTS",
                        "Every check weight must be positive.",
                        node_id=node.id,
                    )
                )
            if node.config.passing_score is None or not Decimal("0") <= Decimal(
                node.config.passing_score
            ) <= Decimal("1"):
                issues.append(
                    _issue(
                        "INVALID_PASSING_SCORE",
                        "Weighted aggregation requires passing_score in [0, 1].",
                        node_id=node.id,
                    )
                )
        elif node.config.check_weights or node.config.passing_score is not None:
            issues.append(
                _issue(
                    "UNEXPECTED_AGGREGATION_FIELDS",
                    "Weights and passing_score are valid only for weighted aggregation.",
                    node_id=node.id,
                )
            )
        return issues

    config = node.config
    operation_id = getattr(config, "assurance_operation_id", None)
    operation_version = getattr(config, "assurance_operation_version", None)
    if not operation_id or not operation_version:
        return [
            _issue(
                "UNBOUND_OPERATION",
                "Select an explicit registered runtime operation for this node.",
                node_id=node.id,
            )
        ]
    capability = capability_for(scenario_id, node.type, operation_id, operation_version)
    if not capability:
        return [
            _issue(
                "UNSUPPORTED_OPERATION",
                "The operation ID/version is not registered for this node type and scenario.",
                node_id=node.id,
            )
        ]
    issues = []
    lowerer = lowerer_for(capability.lowerer_id, capability.lowerer_version)
    if (
        lowerer is None
        or lowerer.scenario_id != scenario_id
        or lowerer.node_type != node.type
        or lowerer.operation_id != operation_id
        or lowerer.operation_version != operation_version
    ):
        issues.append(
            _issue(
                "LOWERER_REGISTRY_MISMATCH",
                "The exact capability lowerer implementation is missing or incompatible.",
                node_id=node.id,
            )
        )
    constraints = capability.config_constraints
    if node.type in {"executor", "router"} and config.model != FIXTURE_MODEL_ID:
        issues.append(
            _issue(
                "UNREGISTERED_MODEL",
                f"Assurance v1 supports only registered model '{FIXTURE_MODEL_ID}'.",
                node_id=node.id,
            )
        )
    if node.type == "executor" and config.tools != constraints.get("tools", []):
        issues.append(
            _issue(
                "EXECUTOR_TOOLS_NOT_ALLOWED",
                "Executor tools must exactly match the selected operation capability.",
                node_id=node.id,
            )
        )
    if node.type == "router" and tuple(config.routes) != ROUTES[(scenario_id, operation_id)]:
        issues.append(
            _issue(
                "ROUTE_CONFIG_MISMATCH",
                "Router routes must exactly match the selected operation capability.",
                node_id=node.id,
            )
        )
    if node.type == "mcp_server" and config.served_tools != constraints.get("served_tools", []):
        issues.append(
            _issue(
                "MCP_TOOLS_NOT_ALLOWED",
                "MCP served_tools contains an unregistered tool for this operation.",
                node_id=node.id,
            )
        )
    if node.type == "api_call" and config.endpoint not in constraints.get("endpoints", []):
        issues.append(
            _issue(
                "ENDPOINT_NOT_ALLOWED",
                "API endpoint is not registered for the selected operation.",
                node_id=node.id,
            )
        )
    if node.type == "code_exec" and config.validator_id not in constraints.get("validator_ids", []):
        issues.append(
            _issue(
                "VALIDATOR_NOT_ALLOWED",
                "Validator is not registered for the selected operation.",
                node_id=node.id,
            )
        )
    if node.type == "context_gate" and config.context_gate_mode not in constraints.get(
        "context_gate_modes", []
    ):
        issues.append(
            _issue(
                "CONTEXT_MODE_NOT_ALLOWED",
                "Context mode is not registered for the selected operation.",
                node_id=node.id,
            )
        )
    if node.type == "human_review" and config.review_type not in constraints.get(
        "review_types", []
    ):
        issues.append(
            _issue(
                "REVIEW_TYPE_NOT_ALLOWED",
                "Review type is not registered for the selected operation.",
                node_id=node.id,
            )
        )
    if node.type == "executor" and config.assurance and config.assurance.enabled:
        resolved = contract_type(
            scenario_id, config.assurance.contract_id, config.assurance.contract_version
        )
        if resolved is None:
            issues.append(
                _issue(
                    "UNKNOWN_CONTRACT",
                    "The Executor output contract is not registered for this scenario.",
                    node_id=node.id,
                )
            )
        binding = next(
            (
                item
                for item in capability.allowed_executor_contracts
                if item.contract_id == config.assurance.contract_id
                and item.contract_version == config.assurance.contract_version
            ),
            None,
        )
        if binding is None or config.assurance.output_mode not in set(
            binding.supported_output_modes if binding else ()
        ):
            issues.append(
                _issue(
                    "EXECUTOR_CONTRACT_NOT_ALLOWED",
                    "The selected operation does not advertise this exact Executor "
                    "contract/version/output mode.",
                    node_id=node.id,
                )
            )
    return issues


def validate_and_normalize(request: CompileRequest) -> tuple[dict[str, Any], list[CompileIssue]]:
    graph = request.graph
    issues: list[CompileIssue] = []
    warnings: list[CompileIssue] = []
    node_ids = [node.id for node in graph.nodes]
    edge_ids = [edge.id for edge in graph.edges]
    if len(node_ids) != len(set(node_ids)):
        issues.append(_issue("DUPLICATE_NODE_ID", "Canvas node IDs must be unique."))
    if len(edge_ids) != len(set(edge_ids)):
        issues.append(_issue("DUPLICATE_EDGE_ID", "Canvas edge IDs must be unique."))
    nodes = {node.id: node for node in graph.nodes}
    for node in graph.nodes:
        issues.extend(_validate_capability(request, node))
        if node.type == "executor" and node.config.output_schema:
            warnings.append(
                _issue(
                    "LEGACY_OUTPUT_SCHEMA_IGNORED",
                    "Deprecated output_schema was ignored; the registered Pydantic contract "
                    "is the only executable source of truth.",
                    node_id=node.id,
                )
            )

    normalized_edges: list[dict[str, Any]] = []
    outgoing: dict[str, list[Any]] = defaultdict(list)
    incoming: dict[str, list[Any]] = defaultdict(list)
    for edge in graph.edges:
        if edge.source not in nodes or edge.target not in nodes:
            issues.append(
                _issue(
                    "DANGLING_EDGE",
                    "Edge source and target must name submitted canvas nodes.",
                    edge_id=edge.id,
                )
            )
            continue
        if edge.kind == "retry" and edge.max_attempts is not None:
            issues.append(
                _issue(
                    "LEGACY_RETRY_BOUND_FORBIDDEN",
                    "Retry edges cannot carry max_attempts; use the graph-level outer "
                    "revision budget.",
                    edge_id=edge.id,
                )
            )
        source_capability = _resolved_capability(nodes[edge.source], request.scenario_id)
        if source_capability and edge.kind not in source_capability.supported_edge_kinds:
            issues.append(
                _issue(
                    "UNSUPPORTED_EDGE_KIND",
                    f"Source capability '{source_capability.capability_template_id}' does not "
                    f"support '{edge.kind}' edges.",
                    edge_id=edge.id,
                )
            )
        source_inputs, source_outputs = _ports_for(nodes[edge.source], request.scenario_id)
        target_inputs, target_outputs = _ports_for(nodes[edge.target], request.scenario_id)
        del source_inputs, target_outputs
        source_handle = edge.source_handle
        target_handle = edge.target_handle
        if source_handle is None:
            if len(source_outputs) == 1:
                source_handle = source_outputs[0]
                warnings.append(
                    _issue(
                        "INFERRED_EDGE_HANDLE",
                        f"Inferred source handle '{source_handle}'.",
                        edge_id=edge.id,
                    )
                )
            else:
                issues.append(
                    _issue(
                        "AMBIGUOUS_EDGE_HANDLE",
                        "A source with multiple output ports requires an explicit source_handle.",
                        edge_id=edge.id,
                    )
                )
        elif source_handle not in source_outputs:
            issues.append(
                _issue(
                    "ILLEGAL_SOURCE_HANDLE",
                    f"'{source_handle}' is not an output port of the resolved source capability.",
                    edge_id=edge.id,
                )
            )
        if target_handle is None:
            if len(target_inputs) == 1:
                target_handle = target_inputs[0]
                warnings.append(
                    _issue(
                        "INFERRED_EDGE_HANDLE",
                        f"Inferred target handle '{target_handle}'.",
                        edge_id=edge.id,
                    )
                )
            else:
                issues.append(
                    _issue(
                        "AMBIGUOUS_EDGE_HANDLE",
                        "A target with multiple or no input ports requires an explicit "
                        "legal target_handle.",
                        edge_id=edge.id,
                    )
                )
        elif target_handle not in target_inputs:
            issues.append(
                _issue(
                    "ILLEGAL_TARGET_HANDLE",
                    f"'{target_handle}' is not an input port of the resolved target capability.",
                    edge_id=edge.id,
                )
            )
        if edge.kind == "retry":
            source = nodes[edge.source]
            target = nodes[edge.target]
            target_capability = (
                capability_for(
                    request.scenario_id,
                    target.type,
                    target.config.assurance_operation_id,
                    target.config.assurance_operation_version,
                )
                if target.type == "executor"
                else None
            )
            if (
                source.type != "typed_handoff_gate"
                or source.config.reject_behavior != "request_revision"
                or source_handle != "rejected"
            ):
                issues.append(
                    _issue(
                        "INVALID_RETRY_SOURCE",
                        "A retry edge must originate at the rejected port of a requesting "
                        "Typed Handoff Gate.",
                        edge_id=edge.id,
                    )
                )
            if target_capability is None or not target_capability.reentry_supported:
                issues.append(
                    _issue(
                        "INVALID_RETRY_TARGET",
                        "A retry edge must target a registered re-entry-capable Executor.",
                        edge_id=edge.id,
                    )
                )
        normalized = edge.model_dump(mode="json")
        normalized["source_handle"] = source_handle
        normalized["target_handle"] = target_handle
        normalized_edges.append(normalized)
        outgoing[edge.source].append((edge, source_handle))
        incoming[edge.target].append((edge, target_handle))

    # A cardinality-one input cannot be used as an implicit join. Cardinality-many
    # joins are supported only when every required arrival is a guaranteed forward
    # delivery; conditional/failure/retry/exclusive paths cannot define a deterministic
    # all-input barrier in v1.
    guaranteed_adj: dict[str, list[str]] = defaultdict(list)
    for edge in normalized_edges:
        source_node = nodes[edge["source"]]
        if source_node.type == "input":
            guaranteed_handles = {"out"}
        elif source_node.type == "executor" and not (
            source_node.config.assurance and source_node.config.assurance.enabled
        ):
            guaranteed_handles = {"success"}
        elif source_node.type in {"router", "typed_handoff_gate", "evidence_check"}:
            guaranteed_handles = set()
        else:
            source_capability = _resolved_capability(source_node, request.scenario_id)
            guaranteed_handles = (
                {source_capability.output_ports[0].id}
                if source_capability and source_capability.output_ports
                else set()
            )
        if (
            edge["kind"] == "normal"
            and edge["fan_out"] != "exclusive"
            and edge["source_handle"] in guaranteed_handles
        ):
            guaranteed_adj[edge["source"]].append(edge["target"])
    guaranteed_reachable: set[str] = set(
        node.id for node in graph.nodes if node.type == "input"
    )
    guaranteed_queue = deque(guaranteed_reachable)
    while guaranteed_queue:
        source = guaranteed_queue.popleft()
        for target in guaranteed_adj[source]:
            if target not in guaranteed_reachable:
                guaranteed_reachable.add(target)
                guaranteed_queue.append(target)

    for node in graph.nodes:
        capability = _resolved_capability(node, request.scenario_id)
        if capability is None:
            continue
        for port in capability.input_ports:
            arrivals = [
                edge
                for edge, target_handle in incoming[node.id]
                if target_handle == port.id and edge.kind != "retry"
            ]
            if port.cardinality == "one" and len(arrivals) > 1:
                issues.append(
                    _issue(
                        "INPUT_CARDINALITY_EXCEEDED",
                        f"Input port '{port.id}' accepts one payload, not an implicit join.",
                        node_id=node.id,
                    )
                )
            if port.cardinality == "many" and len(arrivals) > 1:
                unsupported = [
                    edge
                    for edge in arrivals
                    if edge.kind != "normal"
                    or edge.fan_out == "exclusive"
                    or edge.source not in guaranteed_reachable
                ]
                if unsupported:
                    issues.append(
                        _issue(
                            "UNSUPPORTED_JOIN",
                            "A many-input join requires guaranteed normal/all deliveries; "
                            "conditional, failure, retry, exclusive, or non-guaranteed "
                            "arrivals are not supported.",
                            node_id=node.id,
                        )
                    )

    for node in graph.nodes:
        routes = outgoing[node.id]
        by_handle: dict[str | None, list[Any]] = defaultdict(list)
        for edge, handle in routes:
            by_handle[handle].append(edge)
        if node.type == "typed_handoff_gate":
            if len(by_handle["pass"]) != 1:
                issues.append(
                    _issue(
                        "HANDOFF_PASS_ROUTE_REQUIRED",
                        "Typed Handoff Gate requires exactly one pass edge.",
                        node_id=node.id,
                    )
                )
            rejected = by_handle["rejected"]
            if node.config.reject_behavior == "stop" and rejected:
                issues.append(
                    _issue(
                        "HANDOFF_REJECT_ROUTE_FORBIDDEN",
                        "stop behavior cannot have a rejected edge.",
                        node_id=node.id,
                    )
                )
            if node.config.reject_behavior == "route" and len(rejected) != 1:
                issues.append(
                    _issue(
                        "HANDOFF_REJECT_ROUTE_REQUIRED",
                        "route behavior requires exactly one rejected edge.",
                        node_id=node.id,
                    )
                )
            if node.config.reject_behavior == "request_revision" and (
                len(rejected) != 1 or rejected[0].kind != "retry"
            ):
                issues.append(
                    _issue(
                        "HANDOFF_RETRY_ROUTE_REQUIRED",
                        "request_revision requires exactly one rejected retry edge.",
                        node_id=node.id,
                    )
                )
        elif node.type == "evidence_check":
            if len(by_handle["pass"]) != 1:
                issues.append(
                    _issue(
                        "EVIDENCE_PASS_ROUTE_REQUIRED",
                        "Evidence Check requires exactly one pass edge.",
                        node_id=node.id,
                    )
                )
            failed = by_handle["failed"]
            if node.config.failure_behavior == "stop" and failed:
                issues.append(
                    _issue(
                        "EVIDENCE_FAILURE_ROUTE_FORBIDDEN",
                        "stop behavior cannot have a failed edge.",
                        node_id=node.id,
                    )
                )
            if node.config.failure_behavior == "route" and len(failed) != 1:
                issues.append(
                    _issue(
                        "EVIDENCE_FAILURE_ROUTE_REQUIRED",
                        "route behavior requires exactly one failed edge.",
                        node_id=node.id,
                    )
                )
        elif node.type == "executor" and node.config.assurance and node.config.assurance.enabled:
            if len(by_handle["success"]) != 1:
                issues.append(
                    _issue(
                        "EXECUTOR_SUCCESS_ROUTE_REQUIRED",
                        "An assured Executor requires exactly one success edge.",
                        node_id=node.id,
                    )
                )
            if len(by_handle["failure"]) > 1:
                issues.append(
                    _issue(
                        "EXECUTOR_FAILURE_ROUTE_AMBIGUOUS",
                        "An assured Executor permits at most one failure edge.",
                        node_id=node.id,
                    )
                )

    input_nodes = [node.id for node in graph.nodes if node.type == "input"]
    output_nodes = [node.id for node in graph.nodes if node.type == "output"]
    if not input_nodes:
        issues.append(_issue("ENTRY_REQUIRED", "The graph requires at least one Input node."))
    if not output_nodes:
        issues.append(_issue("TERMINAL_REQUIRED", "The graph requires at least one Output node."))
    reachable: set[str] = set(input_nodes)
    queue = deque(input_nodes)
    adjacency: dict[str, list[str]] = defaultdict(list)
    for edge in graph.edges:
        if edge.source in nodes and edge.target in nodes:
            adjacency[edge.source].append(edge.target)
    while queue:
        source = queue.popleft()
        for target in adjacency[source]:
            if target not in reachable:
                reachable.add(target)
                queue.append(target)
    for node in graph.nodes:
        if node.id not in reachable:
            issues.append(
                _issue(
                    "UNREACHABLE_NODE",
                    "Node is unreachable from every Input node.",
                    node_id=node.id,
                )
            )
    if not any(output in reachable for output in output_nodes):
        issues.append(
            _issue("UNREACHABLE_TERMINAL", "No Output node is reachable from an Input node.")
        )

    no_retry_adj: dict[str, list[str]] = defaultdict(list)
    for edge in graph.edges:
        if edge.kind != "retry" and edge.source in nodes and edge.target in nodes:
            no_retry_adj[edge.source].append(edge.target)
    for edge in graph.edges:
        if edge.kind != "retry" or edge.source not in nodes or edge.target not in nodes:
            continue
        pending = deque([edge.target])
        seen: set[str] = set()
        while pending:
            current = pending.popleft()
            if current in seen:
                continue
            seen.add(current)
            pending.extend(no_retry_adj[current])
        if edge.source not in seen:
            issues.append(
                _issue(
                    "RETRY_TARGET_NOT_UPSTREAM",
                    "The retry target must reach the requesting gate on the forward branch.",
                    edge_id=edge.id,
                )
            )
    visiting: set[str] = set()
    visited: set[str] = set()

    def cycle(node_id: str) -> bool:
        if node_id in visiting:
            return True
        if node_id in visited:
            return False
        visiting.add(node_id)
        for target in no_retry_adj[node_id]:
            if cycle(target):
                return True
        visiting.remove(node_id)
        visited.add(node_id)
        return False

    if any(cycle(node_id) for node_id in nodes if node_id not in visited):
        issues.append(
            _issue(
                "UNBOUNDED_CYCLE",
                "Cycles are permitted only through explicit bounded outer-revision retry edges.",
            )
        )

    if issues:
        raise CompileValidationError(issues)

    semantic_nodes = []
    for node in sorted(graph.nodes, key=lambda item: item.id):
        config = node.config.model_dump(mode="json")
        if node.type == "executor":
            # Accept one compatibility window without allowing hidden legacy metadata
            # to alter executable identity or the lowered plan.
            config["output_schema"] = None
        semantic_nodes.append({"id": node.id, "type": node.type, "config": config})
    semantic_edges = sorted(normalized_edges, key=lambda item: item["id"])
    normalized_graph = {
        "schema_version": graph.schema_version,
        "nodes": semantic_nodes,
        "edges": semantic_edges,
    }
    return deepcopy(normalized_graph), warnings


def compile_graph(
    request: CompileRequest,
    *,
    runtime_implementation_fingerprint: str | None = None,
) -> dict[str, Any]:
    normalized_graph, warnings = validate_and_normalize(request)
    source_graph_hash = canonical_hash(normalized_graph)
    digests = registry_digests(request.scenario_id)
    if runtime_implementation_fingerprint is not None:
        digests["lowerer_registry_digest"] = canonical_hash(
            {
                "registered_lowerers": digests["lowerer_registry_digest"],
                "runtime_implementation": runtime_implementation_fingerprint,
            }
        )
    incoming_edge_ids: dict[tuple[str, str], list[str]] = defaultdict(list)
    for edge in normalized_graph["edges"]:
        if edge["kind"] != "retry":
            incoming_edge_ids[(edge["target"], edge["target_handle"])].append(edge["id"])
    steps = []
    for node in normalized_graph["nodes"]:
        if node["type"] == "typed_handoff_gate":
            output_handles = ("pass", "rejected")
            reentry_supported = False
            operation_id = "typed_handoff_gate"
            operation_version = "1.0.0"
            lowerer_id = f"lower.{request.scenario_id}.typed_handoff_gate"
            lowerer_version = "1.0.0"
            produced_contracts: list[dict[str, Any]] = []
            capability = next(
                item
                for item in assurance_node_capabilities_for(request.scenario_id)
                if item.node_type == node["type"]
            )
        elif node["type"] == "evidence_check":
            output_handles = ("pass", "failed")
            reentry_supported = False
            operation_id = "evidence_check"
            operation_version = "1.0.0"
            lowerer_id = f"lower.{request.scenario_id}.evidence_check"
            lowerer_version = "1.0.0"
            produced_contracts = []
            capability = next(
                item
                for item in assurance_node_capabilities_for(request.scenario_id)
                if item.node_type == node["type"]
            )
        else:
            capability = capability_for(
                request.scenario_id,
                node["type"],
                node["config"].get("assurance_operation_id"),
                node["config"].get("assurance_operation_version"),
            )
            output_handles = (
                tuple(port.id for port in capability.output_ports) if capability else ()
            )
            reentry_supported = bool(capability and capability.reentry_supported)
            assert capability is not None
            operation_id = capability.operation_id
            operation_version = capability.operation_version
            lowerer_id = capability.lowerer_id
            lowerer_version = capability.lowerer_version
            produced_contracts = [
                item.model_dump(mode="json") for item in capability.produced_payload_contracts
            ]
        lowerer = lowerer_for(lowerer_id, lowerer_version)
        if lowerer is None:
            raise RuntimeError("validated lowerer disappeared during immutable plan lowering")
        state_writes = (
            [f"node.{node['id']}.terminal"]
            if node["type"] == "output"
            else [f"node.{node['id']}.{handle}" for handle in output_handles]
        )
        compiled_config = deepcopy(node["config"])
        compiled_bindings = []
        for item in capability.input_bindings:
            binding = item.model_dump(mode="json")
            if binding["target_state_key"] != "request.input":
                binding["target_state_key"] = (
                    f"node.{node['id']}.{binding['target_state_key']}"
                )
            compiled_bindings.append(binding)
        compiled_config["_compiled_input_bindings"] = compiled_bindings
        compiled_config["_compiled_required_input_edges"] = {
            port.id: sorted(incoming_edge_ids[(node["id"], port.id)])
            for port in capability.input_ports
        }
        steps.append(
            {
                "step_id": f"step:{node['id']}",
                "canvas_node_id": node["id"],
                "node_type": node["type"],
                "config": compiled_config,
                "operation_id": operation_id,
                "operation_version": operation_version,
                "lowerer_id": lowerer_id,
                "lowerer_version": lowerer_version,
                "implementation_fingerprint": lowerer.implementation_fingerprint,
                "produced_payload_contracts": produced_contracts,
                "state_writes": state_writes,
                "state_reducers": {key: "replace" for key in state_writes},
                "reentry_supported": reentry_supported,
                "internal": False,
            }
        )
    state_writes_by_node = {step["canvas_node_id"]: step["state_writes"] for step in steps}
    forward: dict[str, list[str]] = defaultdict(list)
    for edge in normalized_graph["edges"]:
        if edge["kind"] != "retry":
            forward[edge["source"]].append(edge["target"])
    transitions = []
    for edge in normalized_graph["edges"]:
        transition = {
            "transition_id": f"transition:{edge['id']}",
            "canvas_edge_id": edge["id"],
            "source_step_id": f"step:{edge['source']}",
            "target_step_id": f"step:{edge['target']}",
            **{
                key: edge[key]
                for key in (
                    "source_handle",
                    "target_handle",
                    "kind",
                    "fan_out",
                    "route_probability",
                    "max_attempts",
                )
            },
        }
        if edge["kind"] == "retry":
            downstream: set[str] = set()
            pending = deque([edge["target"]])
            while pending:
                node_id = pending.popleft()
                if node_id in downstream:
                    continue
                downstream.add(node_id)
                pending.extend(forward[node_id])
            transition["cleared_state_keys"] = sorted(
                key for node_id in downstream for key in state_writes_by_node[node_id]
            )
            transition["cleared_canvas_node_ids"] = sorted(downstream)
            transition["replacement_state_key"] = f"node.{edge['target']}.success"
            transition["must_revisit_step_id"] = f"step:{edge['source']}"
        transitions.append(transition)
    plan = {
        "schema_version": "assurance.plan.v1",
        "steps": steps,
        "transitions": transitions,
        "entry_step_ids": [step["step_id"] for step in steps if step["node_type"] == "input"],
        "terminal_step_ids": [step["step_id"] for step in steps if step["node_type"] == "output"],
    }
    identity = {
        "schema_version": "assurance.candidate.v1",
        "scenario_id": request.scenario_id,
        "normalized_semantic_graph": normalized_graph,
        "execution_policy": request.execution_policy.model_dump(mode="json"),
        "adapter_version": ADAPTER_VERSION,
        "compiler_version": COMPILER_VERSION,
        **digests,
    }
    candidate_hash = canonical_hash(identity)
    resolved_assurance = {
        node["id"]: node["config"].get("assurance")
        for node in normalized_graph["nodes"]
        if node["type"] == "executor" and node["config"].get("assurance")
    }
    return {
        "source_graph_hash": source_graph_hash,
        "candidate_hash": candidate_hash,
        "normalized_semantic_graph": normalized_graph,
        "compiled_plan": plan,
        "node_to_plan_steps": {
            node["id"]: [f"step:{node['id']}"] for node in normalized_graph["nodes"]
        },
        "edge_to_plan_transitions": {
            edge["id"]: [f"transition:{edge['id']}"] for edge in normalized_graph["edges"]
        },
        "resolved_assurance": resolved_assurance,
        "registry_digests": digests,
        "warnings": [warning.model_dump(mode="json") for warning in warnings],
        "semantic_bytes": canonical_json(normalized_graph),
    }
