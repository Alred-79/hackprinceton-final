from __future__ import annotations

from .base import ScenarioDefinition
from .bloated_swarm import definition as bloated_swarm
from .content_machine import definition as content_machine
from .due_diligence_engine import definition as due_diligence_engine
from .gold_plater import definition as gold_plater
from .mcp_migration import definition as mcp_migration
from .ops_center import definition as ops_center
from .safety_net import definition as safety_net

SCENARIO_DEFINITIONS: tuple[ScenarioDefinition, ...] = (
    bloated_swarm,
    content_machine,
    due_diligence_engine,
    gold_plater,
    mcp_migration,
    ops_center,
    safety_net,
)

SCENARIO_REGISTRY: dict[str, ScenarioDefinition] = {
    definition.scenario_id: definition for definition in SCENARIO_DEFINITIONS
}

DEFAULT_FIXTURE_PRESETS: dict[str, str] = {
    "bloated-swarm": "tool_misuse",
    "content-machine": "semantic_citation_trap",
    "due-diligence-engine": "semantic_evidence_trap",
    "gold-plater": "clean",
    "mcp-migration": "catalog_bloat",
    "ops-center": "schema_valid_policy_trap",
    "safety-net": "corrupt_partial",
}

__all__ = [
    "DEFAULT_FIXTURE_PRESETS",
    "SCENARIO_DEFINITIONS",
    "SCENARIO_REGISTRY",
]
