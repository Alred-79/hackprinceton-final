from __future__ import annotations

import pytest

from reagent_runtime.engine import RuntimeEngine
from reagent_runtime.models import CreateRunRequest
from reagent_runtime.scenarios.registry import SCENARIO_REGISTRY
from reagent_runtime.workflows import register_scenario_contracts, validate_workflow


@pytest.mark.parametrize("scenario_id", sorted(SCENARIO_REGISTRY))
def test_every_registered_scenario_executes_real_typed_pair(
    scenario_id: str,
    tmp_path,
) -> None:
    definition = SCENARIO_REGISTRY[scenario_id]
    preset = next(iter(definition.fixture_presets))
    engine = RuntimeEngine(tmp_path / scenario_id)

    for variant in ("baseline", "hardened"):
        run = engine.create_run(
            CreateRunRequest(
                scenario_id=scenario_id,
                variant=variant,
                input=definition.fixture_input,
                fault_plan=[],
                fixture_preset=preset,
            )
        )
        assert run.terminal_status == "succeeded", run.failure_reason
        assert len(run.agent_invocations) >= 2
        if definition.runtime_probe:
            assert any(
                item.node_id == "mcp_runtime" for item in run.agent_invocations
            )
            assert any(event.kind == "tool_call" for event in run.events)
        assert run.metrics is not None
        assert run.metrics.first_attempt_contract_pass is False
        assert run.metrics.final_contract_pass is True
        assert run.metrics.containment is None
        assert run.metrics.blast_radius is None
        assert run.metrics.critical_output_escape is None
        assert run.metrics.labels["containment"] == "not_measured"
        assert run.metrics.labels["blast_radius"] == "not_measured"
        assert run.metrics.labels["critical_output_escape"] == "not_measured"
        assert run.outputs["result"]
        assert run.outputs["quality_checks"]
        assert {item.layer for item in run.pydantic_evidence} >= {
            "input_contract",
            "agent_output",
            "edge_contract",
            "task_quality",
        }
        assert any(item.status == "repaired" for item in run.pydantic_evidence)


def test_every_registered_workflow_validates() -> None:
    register_scenario_contracts(SCENARIO_REGISTRY)
    for definition in SCENARIO_REGISTRY.values():
        for variant in ("baseline", "hardened"):
            result = validate_workflow(definition.workflow_spec(variant))
            assert result.valid, (definition.scenario_id, variant, result.errors)


def test_generic_fixture_replay_matches_semantic_trace(tmp_path) -> None:
    definition = SCENARIO_REGISTRY["safety-net"]
    engine = RuntimeEngine(tmp_path / "replay")
    run = engine.create_run(
        CreateRunRequest(
            scenario_id=definition.scenario_id,
            variant="hardened",
            input=definition.fixture_input,
            fault_plan=[],
            fixture_preset="corrupt_partial",
        )
    )
    replay = engine.fixture_replay(run.run_id)
    assert replay.replay_comparison is not None
    assert replay.replay_comparison["semantic_trace_match"] is True
    assert replay.external_requests == 0
