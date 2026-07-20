from __future__ import annotations

from collections.abc import Iterator
from copy import deepcopy

import pytest
from pydantic import TypeAdapter, ValidationError

from reagent_runtime.models import CreateRunRequest, RunRecord
from reagent_runtime.scenarios.ops_center import (
    MutationActionV1,
    OpsCenterHandoffV1,
    OpsCenterResultV1,
    OpsIncidentInputV1,
    definition,
)
from reagent_runtime.scenarios.runner import RegisteredScenarioRunner
from reagent_runtime.store import RuntimeStore


@pytest.fixture
def runner(tmp_path) -> Iterator[RegisteredScenarioRunner]:
    store = RuntimeStore(tmp_path / "ops-center.sqlite3")
    yield RegisteredScenarioRunner(
        store,
        {definition.scenario_id: definition},
        "ops-center-test-build",
    )
    store.conn.close()


def _execute(
    runner: RegisteredScenarioRunner,
    variant: str,
    preset: str,
) -> RunRecord:
    return runner.create_run(
        CreateRunRequest(
            scenario_id=definition.scenario_id,
            variant=variant,  # type: ignore[arg-type]
            run_mode="fixture",
            input=definition.fixture_input,
            fault_plan=[],
            fixture_preset=preset,
        )
    )


def _checks(
    variant: str,
    preset: str,
    output: dict,
    input_data: dict | None = None,
) -> dict[str, bool]:
    return {
        check.check_id: check.passed
        for check in definition.evaluate_output(
            variant,
            input_data or definition.fixture_input,
            output,
            preset,
        )
    }


def test_input_contract_rejects_coercion_extras_and_duplicate_policy_scope() -> None:
    with pytest.raises(ValidationError):
        OpsIncidentInputV1.model_validate(
            {**definition.fixture_input, "severity": 1}
        )
    with pytest.raises(ValidationError):
        OpsIncidentInputV1.model_validate(
            {**definition.fixture_input, "unregistered_override": True}
        )
    with pytest.raises(ValidationError):
        OpsIncidentInputV1.model_validate(
            {
                **definition.fixture_input,
                "authorized_automation_scopes": [
                    "incident:read",
                    "incident:read",
                ],
            }
        )


def test_approval_state_requires_supported_modeled_proof() -> None:
    with pytest.raises(ValidationError):
        OpsIncidentInputV1.model_validate(
            {**definition.fixture_input, "approval_state": "approved"}
        )
    with pytest.raises(ValidationError, match="requires pending_approval_ref proof"):
        OpsIncidentInputV1.model_validate(
            {**definition.fixture_input, "approval_state": "pending"}
        )

    pending_input = {
        **definition.fixture_input,
        "approval_state": "pending",
        "pending_approval_ref": "APR-7712",
    }
    handoff = definition.build_handoff(
        "hardened",
        pending_input,
        "schema_valid_policy_trap",
    )
    approval_action = next(
        action
        for action in handoff["plan"]["actions"]
        if action["kind"] == "request_approval"
    )
    assert approval_action["approval_ref"] == "APR-7712"
    assert approval_action["status"] == "already_pending"
    output = definition.build_output(
        "hardened",
        pending_input,
        handoff,
        "schema_valid_policy_trap",
    )
    assert output["human_escalation"]["approval_ref"] == "APR-7712"
    approval_log = next(
        step
        for step in output["execution_log"]
        if step["action_id"] == approval_action["action_id"]
    )
    assert approval_log["side_effect"] is False
    assert "reused" in approval_log["note"]
    pending_checks = _checks(
        "hardened",
        "schema_valid_policy_trap",
        output,
        pending_input,
    )
    assert pending_checks["approval_state_continuity"] is True
    assert pending_checks["task_success"] is True


def test_action_contract_binds_operations_and_keys_to_exact_policy() -> None:
    handoff = definition.build_handoff(
        "baseline",
        definition.fixture_input,
        "schema_valid_policy_trap",
    )
    rollback_index = next(
        index
        for index, action in enumerate(handoff["plan"]["actions"])
        if action.get("operation") == "rollback_deploy"
    )
    wrong_scope = {
        **handoff,
        "plan": {
            **handoff["plan"],
            "actions": [dict(action) for action in handoff["plan"]["actions"]],
        },
    }
    wrong_scope["plan"]["actions"][rollback_index]["required_scope"] = (
        "traffic:manage"
    )
    with pytest.raises(ValidationError) as scope_error:
        OpsCenterHandoffV1.model_validate(wrong_scope)
    assert "rollback_deploy requires scope deploy:rollback" in str(scope_error.value)

    wrong_incident_key = {
        **handoff,
        "plan": {
            **handoff["plan"],
            "actions": [dict(action) for action in handoff["plan"]["actions"]],
        },
    }
    wrong_incident_key["plan"]["actions"][0]["idempotency_key"] = (
        "INC-9999:observe:checkout"
    )
    with pytest.raises(ValidationError) as key_error:
        OpsCenterHandoffV1.model_validate(wrong_incident_key)
    assert "idempotency_key must be bound to plan incident_id" in str(key_error.value)


def test_invalid_agent_handoff_exposes_exact_idempotency_invariant() -> None:
    invalid = definition.build_invalid_handoff(
        "hardened",
        definition.fixture_input,
        "clean",
    )
    with pytest.raises(ValidationError) as caught:
        TypeAdapter(definition.handoff_model).validate_python(invalid)
    assert "idempotency_key values must be unique" in str(caught.value)


def test_build_output_rejects_input_to_handoff_incident_drift() -> None:
    handoff = definition.build_handoff(
        "hardened",
        definition.fixture_input,
        "clean",
    )
    drifted = {
        **handoff,
        "incident_id": "INC-9999",
        "plan": {
            **handoff["plan"],
            "incident_id": "INC-9999",
            "actions": [
                {
                    **action,
                    "idempotency_key": action["idempotency_key"].replace(
                        "INC-2042:", "INC-9999:"
                    ),
                }
                for action in handoff["plan"]["actions"]
            ],
        },
    }
    OpsCenterHandoffV1.model_validate(drifted)
    with pytest.raises(ValueError, match="handoff incident_id does not match input"):
        definition.build_output(
            "hardened",
            definition.fixture_input,
            drifted,
            "clean",
        )


def test_baseline_is_schema_valid_while_authorization_and_task_checks_fail() -> None:
    handoff_data = definition.build_handoff(
        "baseline",
        definition.fixture_input,
        "schema_valid_policy_trap",
    )
    handoff = OpsCenterHandoffV1.model_validate(handoff_data)
    output_data = definition.build_output(
        "baseline",
        definition.fixture_input,
        handoff_data,
        "schema_valid_policy_trap",
    )
    output = OpsCenterResultV1.model_validate(output_data)
    checks = _checks("baseline", "schema_valid_policy_trap", output_data)

    rollback = next(
        action
        for action in handoff.plan.actions
        if isinstance(action, MutationActionV1)
    )
    assert rollback.execution_mode == "automated"
    assert rollback.required_scope == "deploy:rollback"
    assert output.outcome == "unsafe_execution"
    assert checks["strict_pydantic_contract"] is True
    assert checks["authorization"] is False
    assert checks["human_escalation"] is False
    assert checks["task_success"] is False


def test_authorization_check_covers_non_human_automation_scopes() -> None:
    restricted_input = {
        **definition.fixture_input,
        "authorized_automation_scopes": ["incident:read", "notify:write"],
    }
    OpsIncidentInputV1.model_validate(restricted_input)
    handoff = definition.build_handoff("hardened", restricted_input, "clean")
    output = definition.build_output(
        "hardened",
        restricted_input,
        handoff,
        "clean",
    )
    checks = _checks("hardened", "clean", output, restricted_input)
    assert checks["strict_pydantic_contract"] is True
    assert checks["authorization"] is False
    assert checks["task_success"] is False


def test_semantic_duplicates_and_order_are_independent_of_schema_validity() -> None:
    duplicate_handoff = definition.build_handoff(
        "baseline",
        definition.fixture_input,
        "duplicate_replay",
    )
    OpsCenterHandoffV1.model_validate(duplicate_handoff)
    duplicate_output = definition.build_output(
        "baseline",
        definition.fixture_input,
        duplicate_handoff,
        "duplicate_replay",
    )
    duplicate_checks = _checks("baseline", "duplicate_replay", duplicate_output)
    assert duplicate_checks["strict_pydantic_contract"] is True
    assert duplicate_checks["semantic_idempotency"] is False
    assert OpsCenterResultV1.model_validate(duplicate_output).duplicate_effects

    order_handoff = definition.build_handoff(
        "baseline",
        definition.fixture_input,
        "out_of_order",
    )
    OpsCenterHandoffV1.model_validate(order_handoff)
    order_output = definition.build_output(
        "baseline",
        definition.fixture_input,
        order_handoff,
        "out_of_order",
    )
    order_checks = _checks("baseline", "out_of_order", order_output)
    assert order_checks["strict_pydantic_contract"] is True
    assert order_checks["dependency_order"] is False


def test_hardened_clean_and_privileged_paths_enforce_different_policies() -> None:
    clean_handoff = definition.build_handoff(
        "hardened",
        definition.fixture_input,
        "clean",
    )
    clean_output_data = definition.build_output(
        "hardened",
        definition.fixture_input,
        clean_handoff,
        "clean",
    )
    clean_output = OpsCenterResultV1.model_validate(clean_output_data)
    assert clean_output.outcome == "contained"
    assert clean_output.human_escalation is None
    assert "act-drain-traffic" in clean_output.executed_action_ids
    assert all(_checks("hardened", "clean", clean_output_data).values())

    gated_handoff = definition.build_handoff(
        "hardened",
        definition.fixture_input,
        "schema_valid_policy_trap",
    )
    gated_output_data = definition.build_output(
        "hardened",
        definition.fixture_input,
        gated_handoff,
        "schema_valid_policy_trap",
    )
    gated_output = OpsCenterResultV1.model_validate(gated_output_data)
    rollback = next(
        action
        for action in gated_output.plan.actions
        if isinstance(action, MutationActionV1)
    )
    assert rollback.execution_mode == "human_gate"
    assert rollback.action_id in gated_output.blocked_action_ids
    assert rollback.action_id not in gated_output.executed_action_ids
    assert gated_output.human_escalation is not None
    assert gated_output.human_escalation.approval_ref == rollback.approval_ref
    assert all(
        _checks(
            "hardened",
            "schema_valid_policy_trap",
            gated_output_data,
        ).values()
    )


@pytest.mark.parametrize(
    ("mutation", "expected_error"),
    [
        ("missing_action", "every planned action must appear exactly once"),
        ("wrong_result_incident", "result incident_id must match plan incident_id"),
        (
            "wrong_escalation_ref",
            "human escalation approval_ref and scope must match",
        ),
    ],
)
def test_result_contract_rejects_continuity_and_accounting_tampering(
    mutation: str,
    expected_error: str,
) -> None:
    handoff = definition.build_handoff(
        "hardened",
        definition.fixture_input,
        "schema_valid_policy_trap",
    )
    output = definition.build_output(
        "hardened",
        definition.fixture_input,
        handoff,
        "schema_valid_policy_trap",
    )
    tampered = {**output}
    if mutation == "missing_action":
        tampered["executed_action_ids"] = output["executed_action_ids"][:-1]
        removed = output["executed_action_ids"][-1]
        tampered["execution_log"] = [
            step for step in output["execution_log"] if step["action_id"] != removed
        ]
    elif mutation == "wrong_result_incident":
        tampered["incident_id"] = "INC-9999"
    else:
        tampered["human_escalation"] = {
            **output["human_escalation"],
            "approval_ref": "APR-9999",
        }
    with pytest.raises(ValidationError) as caught:
        OpsCenterResultV1.model_validate(tampered)
    assert expected_error in str(caught.value)


def test_result_contract_rejects_reversed_execution_and_log_order() -> None:
    handoff = definition.build_handoff(
        "hardened",
        definition.fixture_input,
        "clean",
    )
    output = definition.build_output(
        "hardened",
        definition.fixture_input,
        handoff,
        "clean",
    )
    assert output["executed_action_ids"] == [
        "act-diagnose",
        "act-drain-traffic",
        "act-notify-contained",
    ]
    tampered = {
        **output,
        "executed_action_ids": list(reversed(output["executed_action_ids"])),
        "execution_log": list(reversed(output["execution_log"])),
    }
    with pytest.raises(
        ValidationError,
        match="execution_log order must place dependencies before actions",
    ):
        OpsCenterResultV1.model_validate(tampered)


@pytest.mark.parametrize(
    ("preset", "action_id", "wrong_side_effect"),
    [
        ("clean", "act-diagnose", True),
        ("clean", "act-drain-traffic", False),
        ("clean", "act-notify-contained", False),
        ("schema_valid_policy_trap", "act-request-rollback", True),
        ("schema_valid_policy_trap", "act-rollback", True),
    ],
)
def test_result_contract_enforces_action_specific_side_effect_semantics(
    preset: str,
    action_id: str,
    wrong_side_effect: bool,
) -> None:
    handoff = definition.build_handoff(
        "hardened",
        definition.fixture_input,
        preset,
    )
    output = definition.build_output(
        "hardened",
        definition.fixture_input,
        handoff,
        preset,
    )
    tampered = {
        **output,
        "execution_log": [
            {**step, "side_effect": wrong_side_effect}
            if step["action_id"] == action_id
            else step
            for step in output["execution_log"]
        ],
    }
    with pytest.raises(ValidationError):
        OpsCenterResultV1.model_validate(tampered)


def test_independent_checks_reject_input_and_approver_continuity_tampering() -> None:
    handoff = definition.build_handoff(
        "hardened",
        definition.fixture_input,
        "schema_valid_policy_trap",
    )
    output = definition.build_output(
        "hardened",
        definition.fixture_input,
        handoff,
        "schema_valid_policy_trap",
    )
    wrong_approver = {
        **output,
        "human_escalation": {
            **output["human_escalation"],
            "approver": "Unregistered Commander",
        },
    }
    OpsCenterResultV1.model_validate(wrong_approver)
    approver_checks = _checks(
        "hardened",
        "schema_valid_policy_trap",
        wrong_approver,
    )
    assert approver_checks["strict_pydantic_contract"] is True
    assert approver_checks["human_escalation"] is False
    assert approver_checks["task_success"] is False

    mismatched_input = {
        **definition.fixture_input,
        "incident_id": "INC-9999",
    }
    incident_checks = _checks(
        "hardened",
        "schema_valid_policy_trap",
        output,
        mismatched_input,
    )
    assert incident_checks["strict_pydantic_contract"] is True
    assert incident_checks["incident_continuity"] is False
    assert incident_checks["task_success"] is False


def test_approval_continuity_rejects_correlated_reference_substitution() -> None:
    handoff = definition.build_handoff(
        "hardened",
        definition.fixture_input,
        "schema_valid_policy_trap",
    )
    output = definition.build_output(
        "hardened",
        definition.fixture_input,
        handoff,
        "schema_valid_policy_trap",
    )
    substituted = deepcopy(output)
    for action in substituted["plan"]["actions"]:
        if action["kind"] in {"request_approval", "mutate"}:
            action["approval_ref"] = "APR-9999"
    substituted["human_escalation"]["approval_ref"] = "APR-9999"
    OpsCenterResultV1.model_validate(substituted)

    checks = _checks(
        "hardened",
        "schema_valid_policy_trap",
        substituted,
    )
    assert checks["strict_pydantic_contract"] is True
    assert checks["human_escalation"] is True
    assert checks["approval_state_continuity"] is False
    assert checks["task_success"] is False


def test_approval_continuity_rejects_status_swap() -> None:
    handoff = definition.build_handoff(
        "hardened",
        definition.fixture_input,
        "schema_valid_policy_trap",
    )
    output = definition.build_output(
        "hardened",
        definition.fixture_input,
        handoff,
        "schema_valid_policy_trap",
    )
    swapped = deepcopy(output)
    approval_action = next(
        action
        for action in swapped["plan"]["actions"]
        if action["kind"] == "request_approval"
    )
    approval_action["status"] = "already_pending"
    OpsCenterResultV1.model_validate(swapped)

    checks = _checks(
        "hardened",
        "schema_valid_policy_trap",
        swapped,
    )
    assert checks["strict_pydantic_contract"] is True
    assert checks["approval_state_continuity"] is False
    assert checks["task_success"] is False


def test_every_variant_and_preset_runs_through_real_langgraph_and_pydantic_ai(
    runner: RegisteredScenarioRunner,
) -> None:
    signatures: dict[tuple[str, str], tuple[tuple[str, ...], str]] = {}
    for variant in ("baseline", "hardened"):
        for preset in definition.fixture_presets:
            run = _execute(runner, variant, preset)
            assert run.terminal_status == "succeeded", run.failure_reason
            assert run.metrics and run.metrics.final_contract_pass
            assert any(event.kind == "agent_output_retry" for event in run.events)
            edge = next(
                item
                for item in run.pydantic_evidence
                if item.layer == "edge_contract"
            )
            assert edge.status == (
                "repaired" if preset == "contract_drift" else "passed"
            )
            result = OpsCenterResultV1.model_validate(run.outputs["result"])
            checks = {
                item["check_id"]: item["passed"]
                for item in run.outputs["quality_checks"]
            }
            assert checks["preset_trajectory"] is True
            signatures[(variant, preset)] = (
                tuple(action.action_id for action in result.plan.actions),
                result.outcome,
            )

    assert signatures[("hardened", "clean")] != signatures[
        ("hardened", "schema_valid_policy_trap")
    ]
    assert signatures[("hardened", "duplicate_replay")] != signatures[
        ("hardened", "out_of_order")
    ]
    assert signatures[("baseline", "duplicate_replay")] != signatures[
        ("baseline", "out_of_order")
    ]


def test_all_eval_callbacks_require_identity_status_and_real_evidence(
    runner: RegisteredScenarioRunner,
) -> None:
    for case in definition.eval_cases:
        run = _execute(runner, case.variant, case.fixture_preset or "clean")
        assertions = case.evaluate(run)
        assert assertions
        assert all(assertions.values()), (case.name, assertions)

        wrong_preset = run.model_copy(update={"fixture_preset": "wrong-preset"})
        assert case.evaluate(wrong_preset)["exact_fixture_preset"] is False

        wrong_variant = run.model_copy(
            update={
                "variant": "hardened" if run.variant == "baseline" else "baseline"
            }
        )
        assert case.evaluate(wrong_variant)["exact_variant"] is False

        wrong_status = run.model_copy(update={"terminal_status": "failed"})
        assert case.evaluate(wrong_status)["terminal_status_succeeded"] is False

        stripped = run.model_copy(
            update={
                "events": [],
                "agent_invocations": [],
                "pydantic_evidence": [],
            }
        )
        stripped_assertions = case.evaluate(stripped)
        assert stripped_assertions["producer_retry_event_has_errors"] is False
        assert stripped_assertions["model_retry_pydantic_evidence"] is False
        assert stripped_assertions["edge_type_adapter_evidence"] is False
        assert stripped_assertions["final_output_pydantic_evidence"] is False

        stripped_quality = run.model_copy(
            update={"outputs": {"result": run.outputs["result"]}}
        )
        assert (
            case.evaluate(stripped_quality)["quality_output_is_structured"] is False
        )


def test_eval_cases_cover_contract_policy_safety_task_and_edge_layers() -> None:
    assert {case.name for case in definition.eval_cases} == {
        "ops_schema_valid_policy_trap",
        "ops_semantic_idempotency",
        "ops_dependency_order",
        "ops_human_gate_safety",
        "ops_safe_task_success",
        "ops_edge_contract_drift",
    }


def test_definition_exposes_guided_pydantic_teaching_surface() -> None:
    assert set(definition.fixture_presets) == {
        "clean",
        "contract_drift",
        "schema_valid_policy_trap",
        "duplicate_replay",
        "out_of_order",
    }
    assert len(definition.pydantic_lessons) >= 4
    assert any("ModelRetry" in lesson for lesson in definition.pydantic_lessons)
    assert any("TypeAdapter" in lesson for lesson in definition.pydantic_lessons)
    assert any("Schema validity" in lesson for lesson in definition.pydantic_lessons)
