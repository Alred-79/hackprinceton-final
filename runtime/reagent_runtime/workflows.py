from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

from pydantic import TypeAdapter

from .models import (
    EdgeSpec,
    EnrichmentResultV1,
    NodeSpec,
    ThreatAssessmentV1,
    ThreatBriefV1,
    ThreatIndicatorsV1,
    WorkflowSpec,
    WorkflowValidationResponse,
    stable_hash,
)

CONTRACT_REGISTRY: dict[str, type[Any]] = {
    "ThreatIndicatorsV1": ThreatIndicatorsV1,
    "EnrichmentResultV1": EnrichmentResultV1,
    "ThreatAssessmentV1": ThreatAssessmentV1,
    "ThreatBriefV1": ThreatBriefV1,
}

IMPLEMENTATION_REGISTRY = {
    "threat_input",
    "fixture_enricher",
    "fixture_analyst",
    "fixture_reviewer",
    "fixture_publisher",
    "edge_contract_validator",
    "fixture_factuality",
    "server_approval",
    "threat_output",
    "scenario_input",
    "fixture_scenario_producer",
    "fixture_scenario_consumer",
    "scenario_quality_validator",
    "scenario_output",
}

PREDICATE_REGISTRY = {"approval_decision", "contract_result", "factuality_result"}


def register_scenario_contracts(definitions: dict[str, Any]) -> None:
    for definition in definitions.values():
        for contract in definition.contract_models:
            CONTRACT_REGISTRY[contract.__name__] = contract


def threat_workflow_spec(variant: str = "hardened") -> WorkflowSpec:
    nodes = [
        NodeSpec(
            id="input",
            kind="input",
            implementation_key="threat_input",
            output_contract={"name": "ThreatIndicatorsV1", "version": "1"},
        ),
        NodeSpec(
            id="enricher",
            kind="agent",
            implementation_key="fixture_enricher",
            input_contract={"name": "ThreatIndicatorsV1", "version": "1"},
            output_contract={"name": "EnrichmentResultV1", "version": "1"},
            retry_policy={"max_attempts": 2},
        ),
        NodeSpec(
            id="edge_validator",
            kind="validator",
            implementation_key="edge_contract_validator",
            input_contract={"name": "EnrichmentResultV1", "version": "1"},
            output_contract={"name": "EnrichmentResultV1", "version": "1"},
        ),
        NodeSpec(
            id="analyst",
            kind="agent",
            implementation_key="fixture_analyst",
            input_contract={"name": "EnrichmentResultV1", "version": "1"},
            output_contract={"name": "ThreatAssessmentV1", "version": "1"},
        ),
    ]
    edges = [
        EdgeSpec(source="input", target="enricher"),
        EdgeSpec(source="enricher", target="edge_validator"),
        EdgeSpec(source="edge_validator", target="analyst"),
    ]

    if variant == "hardened":
        nodes.extend(
            [
                NodeSpec(
                    id="factuality",
                    kind="validator",
                    implementation_key="fixture_factuality",
                    input_contract={"name": "ThreatAssessmentV1", "version": "1"},
                    output_contract={"name": "ThreatAssessmentV1", "version": "1"},
                ),
                NodeSpec(
                    id="reviewer",
                    kind="agent",
                    implementation_key="fixture_reviewer",
                    input_contract={"name": "ThreatAssessmentV1", "version": "1"},
                    output_contract={"name": "ThreatBriefV1", "version": "1"},
                ),
                NodeSpec(
                    id="publisher",
                    kind="agent",
                    implementation_key="fixture_publisher",
                    input_contract={"name": "ThreatBriefV1", "version": "1"},
                    output_contract={"name": "ThreatBriefV1", "version": "1"},
                ),
                NodeSpec(
                    id="approval",
                    kind="approval",
                    implementation_key="server_approval",
                    input_contract={"name": "ThreatBriefV1", "version": "1"},
                    output_contract={"name": "ThreatBriefV1", "version": "1"},
                    route_predicate_key="approval_decision",
                ),
                NodeSpec(
                    id="output",
                    kind="output",
                    implementation_key="threat_output",
                    input_contract={"name": "ThreatBriefV1", "version": "1"},
                ),
            ]
        )
        edges.extend(
            [
                EdgeSpec(source="analyst", target="factuality"),
                EdgeSpec(source="factuality", target="reviewer"),
                EdgeSpec(source="reviewer", target="publisher"),
                EdgeSpec(source="publisher", target="approval"),
                EdgeSpec(
                    source="approval",
                    target="output",
                    kind="conditional",
                    fan_out="exclusive",
                ),
            ]
        )
    else:
        nodes.append(
            NodeSpec(
                id="output",
                kind="output",
                implementation_key="threat_output",
                input_contract={"name": "ThreatAssessmentV1", "version": "1"},
            )
        )
        edges.append(EdgeSpec(source="analyst", target="output"))

    return WorkflowSpec(
        id=f"threat-analyst-{variant}",
        version="1.0",
        nodes=nodes,
        edges=edges,
        entry_node_id="input",
        output_node_ids=["output"],
    )


def validate_workflow(spec: WorkflowSpec) -> WorkflowValidationResponse:
    errors: list[str] = []
    node_ids = [node.id for node in spec.nodes]
    node_set = set(node_ids)
    if len(node_ids) != len(node_set):
        errors.append("Node IDs must be unique.")
    if spec.entry_node_id not in node_set:
        errors.append("Entry node does not exist.")
    missing_outputs = set(spec.output_node_ids) - node_set
    if missing_outputs:
        errors.append(f"Output nodes do not exist: {sorted(missing_outputs)}")

    node_map = {node.id: node for node in spec.nodes}
    outgoing: dict[str, list[EdgeSpec]] = defaultdict(list)
    incoming: dict[str, list[EdgeSpec]] = defaultdict(list)
    for edge in spec.edges:
        if edge.source not in node_set or edge.target not in node_set:
            errors.append(f"Edge {edge.source}->{edge.target} references an unknown node.")
            continue
        outgoing[edge.source].append(edge)
        incoming[edge.target].append(edge)
        source_contract = node_map[edge.source].output_contract
        target_contract = node_map[edge.target].input_contract
        if (
            source_contract
            and target_contract
            and (source_contract.name, source_contract.version)
            != (target_contract.name, target_contract.version)
        ):
            errors.append(
                f"Edge {edge.source}->{edge.target} has incompatible contracts: "
                f"{source_contract.name}@{source_contract.version} -> "
                f"{target_contract.name}@{target_contract.version}."
            )
        if edge.kind == "retry" and edge.max_attempts is None:
            errors.append(f"Retry edge {edge.source}->{edge.target} must declare max_attempts.")

    for node in spec.nodes:
        if node.implementation_key not in IMPLEMENTATION_REGISTRY:
            errors.append(
                f"Node {node.id} uses unregistered implementation {node.implementation_key}."
            )
        if node.route_predicate_key and node.route_predicate_key not in PREDICATE_REGISTRY:
            errors.append(f"Node {node.id} uses unregistered predicate {node.route_predicate_key}.")
        for contract in (node.input_contract, node.output_contract):
            if contract and contract.name not in CONTRACT_REGISTRY:
                errors.append(f"Node {node.id} uses unregistered contract {contract.name}.")
        if len(incoming[node.id]) > 1 and node.join_policy is None:
            errors.append(f"Fan-in node {node.id} must declare join_policy.")

    conditional_groups: dict[str, list[EdgeSpec]] = defaultdict(list)
    for edge in spec.edges:
        if edge.kind == "conditional":
            conditional_groups[edge.source].append(edge)
    for source, group in conditional_groups.items():
        supplied = [edge.route_probability for edge in group if edge.route_probability is not None]
        if supplied and (len(supplied) != len(group) or abs(sum(supplied) - 1.0) > 1e-9):
            errors.append(
                f"Conditional probabilities from {source} must all be supplied and sum to 1."
            )

    if spec.entry_node_id in node_set:
        reachable = _walk(spec.entry_node_id, outgoing, forward=True)
        for node_id in sorted(node_set - reachable):
            errors.append(f"Node {node_id} is unreachable from the entry node.")

        reverse_edges: dict[str, list[EdgeSpec]] = defaultdict(list)
        for edge in spec.edges:
            reverse_edges[edge.target].append(
                EdgeSpec(
                    source=edge.target,
                    target=edge.source,
                    kind=edge.kind,
                    max_attempts=edge.max_attempts,
                )
            )
        can_reach_output: set[str] = set()
        for output_id in spec.output_node_ids:
            if output_id in node_set:
                can_reach_output |= _walk(output_id, reverse_edges, forward=True)
        for node_id in sorted(node_set - can_reach_output):
            errors.append(f"Node {node_id} cannot reach an output node.")

    for cycle in _cycles(node_set, outgoing):
        cycle_edges = []
        for index, source in enumerate(cycle):
            target = cycle[(index + 1) % len(cycle)]
            cycle_edges.extend(edge for edge in outgoing[source] if edge.target == target)
        if not any(edge.kind == "retry" and edge.max_attempts for edge in cycle_edges):
            errors.append(f"Unbounded cycle does not compile: {' -> '.join(cycle)}")

    if errors:
        return WorkflowValidationResponse(valid=False, errors=sorted(set(errors)))
    return WorkflowValidationResponse(
        valid=True,
        errors=[],
        workflow_hash=stable_hash(spec.model_dump(mode="json")),
        normalized=spec,
    )


def validate_contract(contract_name: str, value: Any) -> Any:
    contract = CONTRACT_REGISTRY[contract_name]
    return TypeAdapter(contract).validate_python(value)


def _walk(start: str, outgoing: dict[str, list[EdgeSpec]], forward: bool) -> set[str]:
    del forward
    seen: set[str] = set()
    queue = deque([start])
    while queue:
        current = queue.popleft()
        if current in seen:
            continue
        seen.add(current)
        queue.extend(edge.target for edge in outgoing[current])
    return seen


def _cycles(node_ids: set[str], outgoing: dict[str, list[EdgeSpec]]) -> list[list[str]]:
    visiting: set[str] = set()
    visited: set[str] = set()
    stack: list[str] = []
    found: list[list[str]] = []

    def visit(node_id: str) -> None:
        visiting.add(node_id)
        stack.append(node_id)
        for edge in outgoing[node_id]:
            if edge.target not in visited and edge.target not in visiting:
                visit(edge.target)
            elif edge.target in visiting:
                start = stack.index(edge.target)
                found.append(stack[start:].copy())
        stack.pop()
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in node_ids:
        if node_id not in visited:
            visit(node_id)
    return found
