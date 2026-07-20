from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from ..models import EdgeSpec, NodeSpec, RunRecord, WorkflowSpec


@dataclass(frozen=True)
class QualityCheck:
    check_id: str
    title: str
    passed: bool
    guarantee: str
    explanation: str


@dataclass(frozen=True)
class ScenarioEvalCase:
    name: str
    version: str
    description: str
    variant: str
    fixture_preset: str | None
    evaluate: Callable[[RunRecord], dict[str, bool]]


@dataclass(frozen=True)
class ScenarioDefinition:
    scenario_id: str
    title: str
    summary: str
    input_model: type[BaseModel]
    handoff_model: type[BaseModel]
    output_model: type[BaseModel]
    fixture_input: dict[str, Any]
    producer_name: str
    consumer_name: str
    build_handoff: Callable[[str, dict[str, Any], str | None], dict[str, Any]]
    build_invalid_handoff: Callable[[str, dict[str, Any], str | None], dict[str, Any]]
    build_output: Callable[
        [str, dict[str, Any], dict[str, Any], str | None], dict[str, Any]
    ]
    evaluate_output: Callable[
        [str, dict[str, Any], dict[str, Any], str | None], list[QualityCheck]
    ]
    edge_fault_field: str
    fixture_presets: dict[str, str]
    pydantic_lessons: tuple[str, ...]
    eval_cases: tuple[ScenarioEvalCase, ...] = field(default_factory=tuple)
    runtime_probe: Callable[
        [str, dict[str, Any], str | None], dict[str, Any]
    ] | None = None
    apply_runtime_observation: Callable[
        [dict[str, Any], dict[str, Any]], dict[str, Any]
    ] | None = None

    @property
    def contract_models(self) -> tuple[type[BaseModel], ...]:
        return self.input_model, self.handoff_model, self.output_model

    def workflow_spec(self, variant: str) -> WorkflowSpec:
        input_contract = self.input_model.__name__
        handoff_contract = self.handoff_model.__name__
        output_contract = self.output_model.__name__
        nodes = [
            NodeSpec(
                id="input",
                kind="input",
                implementation_key="scenario_input",
                output_contract={"name": input_contract, "version": "1"},
            ),
            NodeSpec(
                id="producer",
                kind="agent",
                implementation_key="fixture_scenario_producer",
                input_contract={"name": input_contract, "version": "1"},
                output_contract={"name": handoff_contract, "version": "1"},
                retry_policy={"max_attempts": 2},
            ),
            NodeSpec(
                id="edge_validator",
                kind="validator",
                implementation_key="edge_contract_validator",
                input_contract={"name": handoff_contract, "version": "1"},
                output_contract={"name": handoff_contract, "version": "1"},
            ),
            NodeSpec(
                id="consumer",
                kind="agent",
                implementation_key="fixture_scenario_consumer",
                input_contract={"name": handoff_contract, "version": "1"},
                output_contract={"name": output_contract, "version": "1"},
            ),
            NodeSpec(
                id="quality",
                kind="validator",
                implementation_key="scenario_quality_validator",
                input_contract={"name": output_contract, "version": "1"},
                output_contract={"name": output_contract, "version": "1"},
            ),
            NodeSpec(
                id="output",
                kind="output",
                implementation_key="scenario_output",
                input_contract={"name": output_contract, "version": "1"},
            ),
        ]
        edges = [
            EdgeSpec(source="input", target="producer"),
            EdgeSpec(source="producer", target="edge_validator"),
            EdgeSpec(source="edge_validator", target="consumer"),
            EdgeSpec(source="consumer", target="quality"),
            EdgeSpec(source="quality", target="output"),
        ]
        return WorkflowSpec(
            id=f"{self.scenario_id}-{variant}",
            version="1.0",
            nodes=nodes,
            edges=edges,
            entry_node_id="input",
            output_node_ids=["output"],
        )
