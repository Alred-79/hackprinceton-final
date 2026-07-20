from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from reagent_runtime.models import CreateRunRequest, RunRecord
from reagent_runtime.scenarios.bloated_swarm import (
    FIXTURE_INPUT,
    SupportQueryV1,
    SupportResolutionV1,
    SupportRouteV1,
    build_handoff,
    build_invalid_handoff,
    build_output,
    definition,
    evaluate_output,
)
from reagent_runtime.scenarios.runner import RegisteredScenarioRunner
from reagent_runtime.store import RuntimeStore


def _run_scenario(
    tmp_path: Path,
    variant: str,
    preset: str,
) -> RunRecord:
    store = RuntimeStore(tmp_path / f"{variant}-{preset}.sqlite3")
    runner = RegisteredScenarioRunner(
        store,
        {definition.scenario_id: definition},
        runtime_build_hash="bloated-swarm-test-build",
    )
    return runner.create_run(
        CreateRunRequest(
            scenario_id=definition.scenario_id,
            variant=variant,
            run_mode="fixture",
            input=FIXTURE_INPUT,
            fault_plan=[],
            fixture_preset=preset,
        )
    )


def test_fixture_input_is_strict_and_requires_shipping_context() -> None:
    parsed = SupportQueryV1.model_validate(FIXTURE_INPUT)
    assert parsed.order_id == "ORD-7331"

    with pytest.raises(ValidationError, match="observed carrier status"):
        missing_status = {
            key: value
            for key, value in FIXTURE_INPUT.items()
            if key != "observed_shipping_status"
        }
        SupportQueryV1.model_validate(
            missing_status
        )

    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        SupportQueryV1.model_validate({**FIXTURE_INPUT, "untrusted": "value"})


def test_route_contract_enforces_pool_profile_and_tool_scope() -> None:
    hardened = build_handoff("hardened", FIXTURE_INPUT, "clean")
    parsed = SupportRouteV1.model_validate(hardened)
    assert parsed.handler_pool == "routine_support"
    assert parsed.model_profile == "efficient"

    with pytest.raises(ValidationError, match="cannot use the case_resolution pool"):
        SupportRouteV1.model_validate({**hardened, "handler_pool": "case_resolution"})

    with pytest.raises(ValidationError, match="requires the efficient model profile"):
        SupportRouteV1.model_validate({**hardened, "model_profile": "premium"})

    with pytest.raises(ValidationError, match="must allow track_shipment"):
        SupportRouteV1.model_validate({**hardened, "allowed_actions": ["respond"]})


def test_invalid_handoff_is_rejected_at_the_edge() -> None:
    invalid = build_invalid_handoff("hardened", FIXTURE_INPUT, "contract_drift")
    assert definition.edge_fault_field not in invalid
    with pytest.raises(ValidationError, match="handler_pool"):
        SupportRouteV1.model_validate(invalid)


def test_resolution_contract_types_actions_without_claiming_authorization() -> None:
    handoff = build_handoff("hardened", FIXTURE_INPUT, "clean")
    output = build_output("hardened", FIXTURE_INPUT, handoff, "clean")
    parsed = SupportResolutionV1.model_validate(output)
    assert parsed.action.kind == "track_shipment"

    unsafe_handoff = build_handoff("baseline", FIXTURE_INPUT, "tool_misuse")
    schema_valid_but_unauthorized = build_output(
        "baseline", FIXTURE_INPUT, unsafe_handoff, "tool_misuse"
    )
    parsed_unsafe = SupportResolutionV1.model_validate(schema_valid_but_unauthorized)
    assert parsed_unsafe.action.kind == "issue_refund"
    assert parsed_unsafe.tool_policy.decision == "unsafe_selection"
    assert parsed_unsafe.tool_policy.tool_execution_count == 0

    malformed_refund = {
        **schema_valid_but_unauthorized,
        "action": {**schema_valid_but_unauthorized["action"], "amount_cents": "500"},
    }
    with pytest.raises(ValidationError, match="valid integer"):
        SupportResolutionV1.model_validate(malformed_refund)


def test_typed_wrong_status_is_schema_valid_but_hardened_clean_passes() -> None:
    baseline_handoff = build_handoff("baseline", FIXTURE_INPUT, "typed_wrong_status")
    baseline_output = build_output(
        "baseline", FIXTURE_INPUT, baseline_handoff, "typed_wrong_status"
    )
    SupportResolutionV1.model_validate(baseline_output)
    baseline_checks = evaluate_output(
        "baseline", FIXTURE_INPUT, baseline_output, "typed_wrong_status"
    )

    hardened_handoff = build_handoff("hardened", FIXTURE_INPUT, "clean")
    hardened_output = build_output("hardened", FIXTURE_INPUT, hardened_handoff, "clean")
    SupportResolutionV1.model_validate(hardened_output)
    hardened_checks = evaluate_output("hardened", FIXTURE_INPUT, hardened_output, "clean")

    baseline_by_id = {check.check_id: check for check in baseline_checks}
    assert not baseline_by_id["fixture_grounding"].passed
    assert not baseline_by_id["model_task_fit"].passed
    assert all(check.passed for check in hardened_checks)


def test_tool_misuse_is_schema_valid_unsafe_in_baseline_and_contained_in_hardened() -> None:
    clean_handoff = build_handoff("baseline", FIXTURE_INPUT, "clean")
    clean_output = build_output("baseline", FIXTURE_INPUT, clean_handoff, "clean")
    baseline_handoff = build_handoff("baseline", FIXTURE_INPUT, "tool_misuse")
    baseline_output = build_output(
        "baseline", FIXTURE_INPUT, baseline_handoff, "tool_misuse"
    )
    hardened_handoff = build_handoff("hardened", FIXTURE_INPUT, "tool_misuse")
    hardened_output = build_output(
        "hardened", FIXTURE_INPUT, hardened_handoff, "tool_misuse"
    )

    clean = SupportResolutionV1.model_validate(clean_output)
    unsafe = SupportResolutionV1.model_validate(baseline_output)
    contained = SupportResolutionV1.model_validate(hardened_output)
    baseline_checks = {
        check.check_id: check.passed
        for check in evaluate_output(
            "baseline", FIXTURE_INPUT, baseline_output, "tool_misuse"
        )
    }
    hardened_checks = evaluate_output(
        "hardened", FIXTURE_INPUT, hardened_output, "tool_misuse"
    )

    assert clean.action.kind == "track_shipment"
    assert unsafe.action.kind == "issue_refund"
    assert unsafe.tool_policy.decision == "unsafe_selection"
    assert unsafe.tool_policy.tool_execution_count == 0
    assert baseline_checks["tool_scope"] is False
    assert contained.action.kind == "track_shipment"
    assert contained.reply_code == "refund_selection_blocked"
    assert contained.tool_policy.decision == "blocked"
    assert contained.tool_policy.reason_code == "not_in_allowed_actions"
    assert contained.tool_policy.tool_execution_count == 0
    assert all(check.passed for check in hardened_checks)


def test_build_output_rejects_broken_handoff_identity_and_variant() -> None:
    handoff = build_handoff("hardened", FIXTURE_INPUT, "clean")
    mutations = [
        {**handoff, "ticket_id": "SUP-9999"},
        {**handoff, "order_id": "ORD-9999"},
        {**handoff, "variant": "baseline"},
        {**handoff, "input_fingerprint": "0" * 64},
    ]

    for mutation in mutations:
        with pytest.raises(ValueError, match="Handoff does not match"):
            build_output("hardened", FIXTURE_INPUT, mutation, "clean")


def test_output_quality_rejects_identity_drift_and_noncanonical_claims() -> None:
    handoff = build_handoff("hardened", FIXTURE_INPUT, "clean")
    output = build_output("hardened", FIXTURE_INPUT, handoff, "clean")

    wrong_ticket = {**output, "ticket_id": "SUP-9999"}
    SupportResolutionV1.model_validate(wrong_ticket)
    ticket_checks = {
        check.check_id: check.passed
        for check in evaluate_output("hardened", FIXTURE_INPUT, wrong_ticket, "clean")
    }
    assert ticket_checks["identity_continuity"] is False

    wrong_order = {
        **output,
        "order_id": "ORD-9999",
        "action": {**output["action"], "order_id": "ORD-9999"},
    }
    SupportResolutionV1.model_validate(wrong_order)
    order_checks = {
        check.check_id: check.passed
        for check in evaluate_output("hardened", FIXTURE_INPUT, wrong_order, "clean")
    }
    assert order_checks["identity_continuity"] is False

    with pytest.raises(ValidationError, match="canonical typed reply_code"):
        SupportResolutionV1.model_validate(
            {**output, "reply": "The package was destroyed and a refund was issued."}
        )

    unsafe_handoff = build_handoff("baseline", FIXTURE_INPUT, "tool_misuse")
    unsafe_output = build_output(
        "baseline", FIXTURE_INPUT, unsafe_handoff, "tool_misuse"
    )
    unsafe_checks = {
        check.check_id: check.passed
        for check in evaluate_output(
            "baseline", FIXTURE_INPUT, unsafe_output, "tool_misuse"
        )
    }
    assert unsafe_checks["tool_scope"] is False
    assert unsafe_checks["fixture_grounding"] is False


def test_runner_records_real_pydantic_ai_retry_transcript(tmp_path: Path) -> None:
    run = _run_scenario(tmp_path, "hardened", "clean")

    retries = [event for event in run.events if event.kind == "agent_output_retry"]
    producer = next(item for item in run.agent_invocations if item.node_id == "producer")
    requests = [
        event
        for event in run.events
        if event.node_id == "producer" and event.kind == "model_request"
    ]
    evidence = next(
        item
        for item in run.pydantic_evidence
        if item.node_id == "producer" and item.layer == "agent_output"
    )

    assert len(retries) == 1
    assert producer.request_count == 2
    assert [event.attempt for event in requests] == [1, 2]
    assert evidence.status == "repaired"
    assert evidence.validation_errors
    assert evidence.input_snapshot is not None
    assert "handler_pool" not in evidence.input_snapshot


def test_contract_repair_eval_requires_edge_type_adapter_repair(tmp_path: Path) -> None:
    drift = _run_scenario(tmp_path, "hardened", "contract_drift")
    clean = _run_scenario(tmp_path, "hardened", "clean")
    eval_case = next(
        case for case in definition.eval_cases if case.name == "bloated_swarm_contract_repair"
    )

    edge_rejections = [
        event for event in drift.events if event.kind == "edge_contract_rejected"
    ]
    assert len(edge_rejections) == 1
    assert edge_rejections[0].metadata["enforcement_layer"] == "pydantic_type_adapter"
    assert all(eval_case.evaluate(drift).values())
    assert not all(eval_case.evaluate(clean).values())
    assert any(event.kind == "agent_output_retry" for event in clean.events)
    assert not any(event.kind == "edge_contract_rejected" for event in clean.events)


def test_runner_presets_and_eval_assertions_are_behavior_specific(tmp_path: Path) -> None:
    clean_baseline = _run_scenario(tmp_path, "baseline", "clean")
    wrong_baseline = _run_scenario(tmp_path, "baseline", "typed_wrong_status")
    unsafe_baseline = _run_scenario(tmp_path, "baseline", "tool_misuse")
    contained_hardened = _run_scenario(tmp_path, "hardened", "tool_misuse")
    typed_eval = next(
        case for case in definition.eval_cases if case.name == "bloated_swarm_typed_but_wrong"
    )
    tool_eval = next(
        case
        for case in definition.eval_cases
        if case.name == "bloated_swarm_tool_misuse_containment"
    )

    assert clean_baseline.outputs["result"]["action"]["shipment_status"] == "in_transit"
    assert wrong_baseline.outputs["result"]["action"]["shipment_status"] == "delayed"
    assert all(typed_eval.evaluate(wrong_baseline).values())
    assert not all(typed_eval.evaluate(clean_baseline).values())
    assert unsafe_baseline.outputs["result"]["action"]["kind"] == "issue_refund"
    assert contained_hardened.outputs["result"]["action"]["kind"] == "track_shipment"
    assert contained_hardened.metrics and contained_hardened.metrics.task_pass
    assert contained_hardened.metrics.tool_calls == 0
    assert not any(event.kind == "tool_call" for event in contained_hardened.events)
    assert all(tool_eval.evaluate(contained_hardened).values())
    assert not all(tool_eval.evaluate(clean_baseline).values())


def test_every_eval_rejects_wrong_identity_variant_status_and_forged_evidence(
    tmp_path: Path,
) -> None:
    for case in definition.eval_cases:
        run = _run_scenario(tmp_path, case.variant, case.fixture_preset or "clean")
        assert all(case.evaluate(run).values()), case.name

        wrong_identity = run.model_copy(deep=True)
        wrong_identity.scenario_id = "threat-analyst"
        wrong_variant = run.model_copy(deep=True)
        wrong_variant.variant = "baseline" if case.variant == "hardened" else "hardened"
        wrong_preset = run.model_copy(deep=True)
        wrong_preset.fixture_preset = "clean" if case.fixture_preset != "clean" else "tool_misuse"
        failed = run.model_copy(deep=True)
        failed.terminal_status = "failed"
        wrong_input = run.model_copy(deep=True)
        wrong_input.input["ticket_id"] = "SUP-9999"
        stripped = run.model_copy(deep=True)
        stripped.pydantic_evidence = [
            item for item in stripped.pydantic_evidence if item.node_id != "producer"
        ]
        forged = run.model_copy(deep=True)
        producer = next(
            item for item in forged.agent_invocations if item.node_id == "producer"
        )
        producer.request_count = 99

        negatives = [
            wrong_identity,
            wrong_variant,
            wrong_preset,
            failed,
            wrong_input,
            stripped,
            forged,
        ]
        assert all(not all(case.evaluate(negative).values()) for negative in negatives), (
            case.name
        )


def test_definition_exposes_teaching_presets_and_four_evals() -> None:
    assert definition.scenario_id == "bloated-swarm"
    assert set(definition.fixture_presets) == {
        "clean",
        "contract_drift",
        "typed_wrong_status",
        "tool_misuse",
    }
    assert len(definition.pydantic_lessons) == 4
    assert len(definition.eval_cases) == 4
    assert {case.variant for case in definition.eval_cases} == {"baseline", "hardened"}
