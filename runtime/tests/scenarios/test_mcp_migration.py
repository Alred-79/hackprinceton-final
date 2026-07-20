from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from reagent_runtime.engine import RuntimeEngine
from reagent_runtime.models import CreateRunRequest, RunRecord
from reagent_runtime.scenarios.mcp_migration import (
    ALL_TOOLS,
    DOMAIN_TOOLS,
    MCPMigrationResultV1,
    MCPRouteV1,
    build_handoff,
    build_invalid_handoff,
    build_output,
    definition,
)

PRESETS = tuple(definition.fixture_presets)


def _run(
    engine: RuntimeEngine,
    variant: str,
    preset: str,
) -> RunRecord:
    return engine.create_run(
        CreateRunRequest(
            scenario_id=definition.scenario_id,
            variant=variant,
            input=definition.fixture_input,
            fault_plan=[],
            fixture_preset=preset,
        )
    )


def _assert_runtime_provenance(run: RunRecord) -> None:
    assert run.terminal_status == "succeeded", run.failure_reason
    assert run.metrics and run.metrics.tool_calls > 0
    kinds = {event.kind for event in run.events}
    assert {"mcp_initialize", "mcp_list_tools", "tool_call"} <= kinds
    assert any(
        evidence.layer == "tool_arguments"
        and evidence.status == "passed"
        and evidence.output_snapshot
        and evidence.output_snapshot.get("protocol") == "mcp"
        for evidence in run.pydantic_evidence
    )
    protocol = run.outputs["result"]["protocol"]
    assert protocol["initialized"] is True
    assert protocol["list_tools_observed"] is True
    assert protocol["call_tool_observed"] is True
    assert protocol["tool_args_validated"] is True
    assert protocol["external_requests"] == 0


def test_route_contract_rejects_strict_and_selected_tool_argument_mismatches() -> None:
    invalid = build_invalid_handoff(
        "hardened",
        definition.fixture_input,
        "invalid_tool_args",
    )
    with pytest.raises(ValidationError) as caught:
        MCPRouteV1.model_validate(invalid)
    errors = caught.value.errors()
    assert any(error["type"] == "int_type" for error in errors)
    assert any(error["type"] == "extra_forbidden" for error in errors)

    mismatched = build_handoff(
        "hardened",
        definition.fixture_input,
        "wrong_but_valid",
    )
    mismatched["selected_tool"] = "web_search_social"
    with pytest.raises(ValidationError, match="requires source='social'"):
        MCPRouteV1.model_validate(mismatched)


def test_output_fails_closed_without_runtime_observation() -> None:
    handoff = build_handoff(
        "hardened",
        definition.fixture_input,
        "catalog_bloat",
    )
    unobserved = build_output(
        "hardened",
        definition.fixture_input,
        handoff,
        "catalog_bloat",
    )

    assert "protocol" not in unobserved
    with pytest.raises(ValidationError, match="protocol"):
        MCPMigrationResultV1.model_validate(unobserved)


def test_baseline_is_observed_schema_valid_but_policy_and_task_wrong(
    tmp_path: Path,
) -> None:
    run = _run(RuntimeEngine(tmp_path / "baseline"), "baseline", "wrong_but_valid")
    _assert_runtime_provenance(run)
    result = run.outputs["result"]
    protocol = result["protocol"]
    checks = {
        item["check_id"]: item["passed"]
        for item in run.outputs["quality_checks"]
    }

    assert protocol["selected_tool"] == "web_search_social"
    assert protocol["tool_args"]["source"] == "social"
    assert protocol["catalog_size"] == len(ALL_TOOLS) == 12
    assert protocol["validation_errors"] == []
    assert run.metrics and run.metrics.final_contract_pass
    assert checks["strict_pydantic_contract"] is True
    assert checks["domain_policy"] is False
    assert checks["scenario_task_quality"] is False
    assert result["policy_decision"] == "violated"
    assert result["task_quality"] == "failed"
    assert run.metrics.task_pass is False


@pytest.mark.parametrize("variant", ["baseline", "hardened"])
def test_every_preset_executes_a_distinct_real_mcp_trajectory(
    variant: str,
    tmp_path: Path,
) -> None:
    engine = RuntimeEngine(tmp_path / variant)
    trajectories: set[str] = set()
    for preset in PRESETS:
        run = _run(engine, variant, preset)
        _assert_runtime_provenance(run)
        result = run.outputs["result"]
        protocol = result["protocol"]
        assert protocol["preset"] == preset
        assert protocol["tool_result"]["preset"] == preset
        assert protocol["catalog_schemas"]
        assert protocol["schema_token_measure"] > 0
        assert len(protocol["catalog_names"]) == protocol["catalog_size"]
        trajectories.add(
            json.dumps(
                {
                    "selected": protocol["selected_tool"],
                    "requested": protocol["requested_tool"],
                    "blocked": protocol["blocked_by_scope"],
                    "attempts": protocol["attempted_calls"],
                    "result": protocol["tool_result"],
                    "response": result["response"],
                },
                sort_keys=True,
            )
        )

        if variant == "hardened":
            assert protocol["catalog_names"] == list(DOMAIN_TOOLS["research"])
            assert protocol["catalog_size"] == 4
            assert run.metrics and run.metrics.task_pass is True
        else:
            assert protocol["catalog_names"] == list(ALL_TOOLS)
            assert protocol["catalog_size"] == 12
            assert run.metrics and run.metrics.task_pass is False

    assert len(trajectories) == len(PRESETS)


def test_presets_show_exact_repair_isolation_and_safe_selection(
    tmp_path: Path,
) -> None:
    engine = RuntimeEngine(tmp_path / "preset-evidence")
    invalid = _run(engine, "hardened", "invalid_tool_args")
    cross_domain = _run(engine, "hardened", "cross_domain_injection")
    corrected = _run(engine, "hardened", "wrong_but_valid")

    invalid_protocol = invalid.outputs["result"]["protocol"]
    assert len(invalid_protocol["attempted_calls"]) == 2
    rejected, repaired = invalid_protocol["attempted_calls"]
    assert rejected["arguments"]["max_results"] == "five"
    assert rejected["arguments"]["unregistered_argument"] == "must be rejected"
    assert rejected["executed"] is False
    assert repaired["arguments"]["max_results"] == 5
    assert repaired["executed"] is True
    error_text = " ".join(
        error["message"] for error in invalid_protocol["validation_errors"]
    )
    assert "valid integer" in error_text
    assert "Unexpected keyword argument" in error_text

    cross_protocol = cross_domain.outputs["result"]["protocol"]
    assert cross_protocol["requested_tool"] == "api_email"
    assert cross_protocol["blocked_by_scope"] is True
    assert "api_email" not in cross_protocol["catalog_names"]
    assert cross_protocol["selected_tool"] == "web_search_academic"
    assert cross_protocol["selection_corrected"] is True

    corrected_protocol = corrected.outputs["result"]["protocol"]
    assert corrected_protocol["requested_tool"] == "web_search_social"
    assert corrected_protocol["blocked_by_scope"] is False
    assert corrected_protocol["selection_corrected"] is True
    assert corrected_protocol["selected_tool"] == "web_search_academic"


def test_eval_callbacks_require_events_runtime_evidence_and_exact_preset_facts(
    tmp_path: Path,
) -> None:
    engine = RuntimeEngine(tmp_path / "eval-controls")
    for eval_case in definition.eval_cases:
        assert eval_case.fixture_preset is not None
        run = _run(engine, eval_case.variant, eval_case.fixture_preset)
        assertions = eval_case.evaluate(run)
        assert assertions and all(assertions.values()), (eval_case.name, assertions)

        fabricated = run.model_copy(deep=True)
        fabricated.events = []
        assert fabricated.metrics is not None
        fabricated.metrics.tool_calls = 0
        fabricated.pydantic_evidence = [
            evidence
            for evidence in fabricated.pydantic_evidence
            if evidence.layer != "tool_arguments"
        ]
        assert fabricated.outputs["result"]["protocol"]["initialized"] is True
        negative_assertions = eval_case.evaluate(fabricated)
        assert not all(negative_assertions.values()), (
            eval_case.name,
            negative_assertions,
        )


def test_definition_exposes_guided_pydantic_and_mcp_lessons() -> None:
    assert set(definition.fixture_presets) == {
        "catalog_bloat",
        "invalid_tool_args",
        "cross_domain_injection",
        "wrong_but_valid",
    }
    assert definition.runtime_probe is not None
    assert definition.apply_runtime_observation is not None
    assert len(definition.eval_cases) == 4
    assert any("schema-valid wrong tool" in lesson for lesson in definition.pydantic_lessons)
    assert any(
        "initialize, list-tools, call-tool" in lesson
        for lesson in definition.pydantic_lessons
    )
