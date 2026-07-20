from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from reagent_runtime.models import CreateRunRequest, RunRecord
from reagent_runtime.scenarios.gold_plater import (
    FIXTURE_INPUT,
    GoldPlaterInputV1,
    GoldPlaterOutputV1,
    ScopedExecutionPlanV1,
    definition,
)
from reagent_runtime.scenarios.runner import RegisteredScenarioRunner
from reagent_runtime.store import RuntimeStore


@pytest.fixture
def executed_runs(tmp_path: Path) -> dict[str, RunRecord]:
    runner = RegisteredScenarioRunner(
        RuntimeStore(tmp_path / "gold-plater.sqlite3"),
        {definition.scenario_id: definition},
        "gold-plater-test",
    )
    records: dict[str, RunRecord] = {}
    for case in definition.eval_cases:
        record = runner.create_run(
            CreateRunRequest(
                scenario_id="gold-plater",
                variant=case.variant,
                input={},
                fault_plan=[],
                fixture_preset=case.fixture_preset,
            )
        )
        assert record.terminal_status == "succeeded", record.failure_reason
        records[case.name] = record
    return records


def test_input_contract_is_strict_fixture_scoped_and_always_feasible() -> None:
    parsed = GoldPlaterInputV1.model_validate(FIXTURE_INPUT)
    assert parsed.authorization.max_cost_cents == 100

    with pytest.raises(ValidationError):
        GoldPlaterInputV1.model_validate(
            {
                **FIXTURE_INPUT,
                "authorization": {
                    **FIXTURE_INPUT["authorization"],
                    "max_cost_cents": "100",
                },
            }
        )
    with pytest.raises(ValidationError, match="greater than or equal to 42"):
        GoldPlaterInputV1.model_validate(
            {
                **FIXTURE_INPUT,
                "authorization": {
                    **FIXTURE_INPUT["authorization"],
                    "max_cost_cents": 41,
                },
            }
        )
    with pytest.raises(ValidationError):
        GoldPlaterInputV1.model_validate(
            {
                **FIXTURE_INPUT,
                "authorization": {
                    **FIXTURE_INPUT["authorization"],
                    "max_steps": 1,
                },
            }
        )
    with pytest.raises(ValidationError):
        GoldPlaterInputV1.model_validate({**FIXTURE_INPUT, "task_kind": "analysis"})
    with pytest.raises(ValidationError):
        GoldPlaterInputV1.model_validate(
            {
                **FIXTURE_INPUT,
                "authorization": {
                    **FIXTURE_INPUT["authorization"],
                    "approved_deliverables": ["root_cause_analysis"],
                },
            }
        )
    with pytest.raises(ValidationError, match="absent from source_text"):
        GoldPlaterInputV1.model_validate(
            {**FIXTURE_INPUT, "required_facts": ["14:30 UTC", "database outage"]}
        )
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        GoldPlaterInputV1.model_validate({**FIXTURE_INPUT, "silent_default": True})


def test_baseline_validly_declares_overbuild_while_hardened_enforces_caps() -> None:
    baseline_data = definition.build_handoff("baseline", FIXTURE_INPUT, "clean")
    baseline = ScopedExecutionPlanV1.model_validate(baseline_data)
    assert baseline.variant == "baseline"
    assert baseline.gate_mode == "monitor"
    assert baseline.violations == [
        "unapproved_deliverable",
        "cost_cap_exceeded",
        "step_cap_exceeded",
        "premium_model_disallowed",
    ]

    hardened_data = definition.build_handoff("hardened", FIXTURE_INPUT, "clean")
    hardened = ScopedExecutionPlanV1.model_validate(hardened_data)
    assert hardened.variant == "hardened"
    assert hardened.gate_mode == "enforce"
    assert hardened.violations == []
    assert hardened.planned_deliverables == ["formatted_update"]

    forbidden_expansion = {
        **hardened_data,
        "planned_deliverables": ["formatted_update", "root_cause_analysis"],
        "violations": ["unapproved_deliverable"],
    }
    with pytest.raises(ValidationError, match="enforced plans cannot proceed"):
        ScopedExecutionPlanV1.model_validate(forbidden_expansion)
    with pytest.raises(ValidationError, match="require gate_mode='enforce'"):
        ScopedExecutionPlanV1.model_validate({**hardened_data, "gate_mode": "monitor"})


def test_handoff_is_correlated_to_exact_input_before_output() -> None:
    handoff = definition.build_handoff("hardened", FIXTURE_INPUT, "clean")

    with pytest.raises(ValueError, match="request_id"):
        definition.build_output(
            "hardened",
            FIXTURE_INPUT,
            {**handoff, "request_id": "GPL-9999"},
            "clean",
        )
    with pytest.raises(ValueError, match="authorization"):
        definition.build_output(
            "hardened",
            FIXTURE_INPUT,
            {
                **handoff,
                "authorization": {**handoff["authorization"], "max_cost_cents": 90},
            },
            "clean",
        )
    with pytest.raises(ValueError, match="input_fingerprint"):
        definition.build_output(
            "hardened",
            FIXTURE_INPUT,
            {**handoff, "input_fingerprint": "0" * 64},
            "clean",
        )
    with pytest.raises(ValueError, match="variant"):
        definition.build_output("baseline", FIXTURE_INPUT, handoff, "clean")


def test_invalid_handoff_is_rejected_at_the_graph_edge() -> None:
    invalid = definition.build_invalid_handoff("hardened", FIXTURE_INPUT, "contract_drift")
    assert definition.edge_fault_field not in invalid
    with pytest.raises(ValidationError, match="authorization"):
        TypeAdapter(definition.handoff_model).validate_python(invalid)


def test_baseline_is_schema_valid_but_fails_scope_budget_and_model_fit() -> None:
    handoff = definition.build_handoff("baseline", FIXTURE_INPUT, "clean")
    output_data = definition.build_output("baseline", FIXTURE_INPUT, handoff, "clean")
    output = GoldPlaterOutputV1.model_validate(output_data)
    checks = {
        check.check_id: check
        for check in definition.evaluate_output(
            "baseline", FIXTURE_INPUT, output_data, "clean"
        )
    }

    assert output.scope_status == "expanded"
    assert output.budget_status == "exceeded"
    assert checks["typed_output"].passed
    assert checks["input_correlation"].passed
    assert not checks["requested_work_complete"].passed
    assert not checks["source_fidelity"].passed
    assert not checks["approved_scope_only"].passed
    assert not checks["budget_cap"].passed
    assert not checks["model_task_fit"].passed


def test_hardened_clean_path_preserves_intent_and_passes_every_check() -> None:
    handoff = definition.build_handoff("hardened", FIXTURE_INPUT, "clean")
    output_data = definition.build_output("hardened", FIXTURE_INPUT, handoff, "clean")
    output = GoldPlaterOutputV1.model_validate(output_data)
    checks = definition.evaluate_output("hardened", FIXTURE_INPUT, output_data, "clean")

    assert output.delivered_deliverables == ["formatted_update"]
    assert output.model_tier == "lightweight"
    assert output.cost_cents <= output.authorization.max_cost_cents
    assert all(check.passed for check in checks)


def test_deliverable_metadata_cannot_fake_semantic_completion() -> None:
    handoff = definition.build_handoff("hardened", FIXTURE_INPUT, "clean")
    output_data = definition.build_output("hardened", FIXTURE_INPUT, handoff, "clean")
    forged = {
        **output_data,
        "result_text": (
            "This is generic prose with no requested bullet formatting and no source facts."
        ),
    }
    GoldPlaterOutputV1.model_validate(forged)
    checks = {
        check.check_id: check
        for check in definition.evaluate_output("hardened", FIXTURE_INPUT, forged, "clean")
    }
    assert not checks["requested_work_complete"].passed
    assert not checks["source_fidelity"].passed


@pytest.mark.parametrize(
    "forged_text",
    [
        (
            "- Checkout latency rose to 5 seconds.\n"
            "- Checkout latency rose to 50 seconds.\n"
            "- The rollback completed at 14:30 UTC."
        ),
        (
            "- Checkout latency rose to 5 seconds.\n"
            "- The rollback completed at 14:30 UTC.\n"
            "- Database saturation caused the incident."
        ),
        (
            "- Checkout latency rose to 5 seconds.\n"
            "- The rollback completed at 14:30 UTC.\n"
            "Database saturation caused the incident."
        ),
    ],
    ids=[
        "contradictory_value",
        "hallucinated_extra_bullet",
        "hallucinated_non_bullet_prose",
    ],
)
def test_exact_proposition_comparison_rejects_contradictions_and_extras(
    forged_text: str,
) -> None:
    handoff = definition.build_handoff("hardened", FIXTURE_INPUT, "clean")
    output_data = definition.build_output("hardened", FIXTURE_INPUT, handoff, "clean")
    forged = {**output_data, "result_text": forged_text}
    GoldPlaterOutputV1.model_validate(forged)
    checks = {
        check.check_id: check
        for check in definition.evaluate_output("hardened", FIXTURE_INPUT, forged, "clean")
    }
    assert not checks["requested_work_complete"].passed
    assert not checks["source_fidelity"].passed


def test_sentence_splitter_preserves_decimal_values() -> None:
    decimal_input = {
        **FIXTURE_INPUT,
        "source_text": (
            "Checkout latency rose to 5.25 seconds. "
            "The rollback completed at 14:30 UTC."
        ),
        "required_facts": ["5.25 seconds", "14:30 UTC"],
    }
    handoff = definition.build_handoff("hardened", decimal_input, "clean")
    output_data = definition.build_output("hardened", decimal_input, handoff, "clean")
    assert "5.25 seconds" in output_data["result_text"]
    assert not any(
        line.strip() == "- Checkout latency rose to 5."
        for line in output_data["result_text"].splitlines()
    )
    assert all(
        check.passed
        for check in definition.evaluate_output(
            "hardened", decimal_input, output_data, "clean"
        )
    )


def test_output_forgery_is_rejected_or_fails_independent_correlation() -> None:
    handoff = definition.build_handoff("hardened", FIXTURE_INPUT, "clean")
    output_data = definition.build_output("hardened", FIXTURE_INPUT, handoff, "clean")

    with pytest.raises(ValidationError):
        GoldPlaterOutputV1.model_validate({**output_data, "task_kind": "analysis"})
    with pytest.raises(ValidationError, match="require gate_mode='enforce'"):
        GoldPlaterOutputV1.model_validate({**output_data, "gate_mode": "monitor"})

    for forged in (
        {**output_data, "request_id": "GPL-9999"},
        {
            **output_data,
            "authorization": {**output_data["authorization"], "max_cost_cents": 90},
        },
        {**output_data, "input_fingerprint": "0" * 64},
        {**output_data, "variant": "baseline", "gate_mode": "monitor"},
    ):
        GoldPlaterOutputV1.model_validate(forged)
        checks = {
            check.check_id: check
            for check in definition.evaluate_output(
                "hardened", FIXTURE_INPUT, forged, "clean"
            )
        }
        assert not checks["input_correlation"].passed


def test_typed_semantic_trap_proves_schema_is_not_truth() -> None:
    handoff = definition.build_handoff("hardened", FIXTURE_INPUT, "typed_semantic_trap")
    output_data = definition.build_output(
        "hardened", FIXTURE_INPUT, handoff, "typed_semantic_trap"
    )
    output = GoldPlaterOutputV1.model_validate(output_data)
    checks = {
        check.check_id: check
        for check in definition.evaluate_output(
            "hardened", FIXTURE_INPUT, output_data, "typed_semantic_trap"
        )
    }

    assert output.declares_source_facts_preserved
    assert "50 seconds" in output.result_text
    assert checks["typed_output"].passed
    assert not checks["requested_work_complete"].passed
    assert not checks["source_fidelity"].passed


def test_all_eval_callbacks_require_real_runtime_evidence(
    executed_runs: dict[str, RunRecord],
) -> None:
    for case in definition.eval_cases:
        assertions = case.evaluate(executed_runs[case.name])
        assert assertions
        assert all(assertions.values()), case.name


def test_eval_callbacks_reject_wrong_context_and_stripped_evidence(
    executed_runs: dict[str, RunRecord],
) -> None:
    cases = {case.name: case for case in definition.eval_cases}

    wrong_preset = executed_runs["gold_plater_hardened_scope_gate"].model_copy(deep=True)
    wrong_preset.fixture_preset = "typed_semantic_trap"
    assert not all(cases["gold_plater_hardened_scope_gate"].evaluate(wrong_preset).values())

    failed = executed_runs["gold_plater_baseline_overbuild"].model_copy(deep=True)
    failed.terminal_status = "failed"
    assert not all(cases["gold_plater_baseline_overbuild"].evaluate(failed).values())

    no_transcript = executed_runs["gold_plater_hardened_scope_gate"].model_copy(deep=True)
    no_transcript.agent_invocations = []
    assert not all(cases["gold_plater_hardened_scope_gate"].evaluate(no_transcript).values())

    hollow_messages = executed_runs["gold_plater_hardened_scope_gate"].model_copy(
        deep=True
    )
    producer_invocation = next(
        item for item in hollow_messages.agent_invocations if item.node_id == "producer"
    )
    producer_invocation.serialized_messages = [
        {"kind": "request", "parts": []},
        {"kind": "response", "parts": []},
        {"kind": "request", "parts": []},
        {"kind": "response", "parts": []},
    ]
    assert not all(
        cases["gold_plater_hardened_scope_gate"].evaluate(hollow_messages).values()
    )

    no_consumer_invocation = executed_runs[
        "gold_plater_hardened_scope_gate"
    ].model_copy(deep=True)
    no_consumer_invocation.agent_invocations = [
        item
        for item in no_consumer_invocation.agent_invocations
        if item.node_id != "consumer"
    ]
    assert not all(
        cases["gold_plater_hardened_scope_gate"]
        .evaluate(no_consumer_invocation)
        .values()
    )

    no_edge_rejection = executed_runs["gold_plater_contract_drift_repair"].model_copy(
        deep=True
    )
    no_edge_rejection.events = [
        event
        for event in no_edge_rejection.events
        if event.kind != "edge_contract_rejected"
    ]
    assert not all(
        cases["gold_plater_contract_drift_repair"].evaluate(no_edge_rejection).values()
    )

    no_factuality_evidence = executed_runs["gold_plater_typed_semantic_trap"].model_copy(
        deep=True
    )
    no_factuality_evidence.pydantic_evidence = [
        item
        for item in no_factuality_evidence.pydantic_evidence
        if item.guarantee != "factuality"
    ]
    assert not all(
        cases["gold_plater_typed_semantic_trap"]
        .evaluate(no_factuality_evidence)
        .values()
    )


def test_definition_exposes_teaching_presets_and_four_evals() -> None:
    assert definition.scenario_id == "gold-plater"
    assert set(definition.fixture_presets) == {
        "clean",
        "contract_drift",
        "typed_semantic_trap",
    }
    assert len(definition.pydantic_lessons) >= 4
    assert {case.name for case in definition.eval_cases} == {
        "gold_plater_baseline_overbuild",
        "gold_plater_hardened_scope_gate",
        "gold_plater_contract_drift_repair",
        "gold_plater_typed_semantic_trap",
    }
