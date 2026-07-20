from hashlib import sha256
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from reagent_runtime.models import CreateRunRequest, RunRecord
from reagent_runtime.scenarios.runner import RegisteredScenarioRunner
from reagent_runtime.scenarios.safety_net import (
    CLEAN_CONTENT,
    DETAILED_SUMMARY,
    EXECUTIVE_SUMMARY,
    CompleteDocumentSummaryV1,
    GracefulDocumentFallbackV1,
    SafetyNetHandoffV1,
    SafetyNetInputV1,
    SafetyNetOutputV1,
    definition,
)
from reagent_runtime.store import RuntimeStore


def _run_scenario(tmp_path: Path, variant: str, preset: str) -> RunRecord:
    store = RuntimeStore(tmp_path / f"{variant}-{preset}.sqlite3")
    runner = RegisteredScenarioRunner(
        store,
        {definition.scenario_id: definition},
        runtime_build_hash="safety-net-test-build",
    )
    return runner.create_run(
        CreateRunRequest(
            scenario_id=definition.scenario_id,
            variant=variant,
            run_mode="fixture",
            input=definition.fixture_input,
            fault_plan=[],
            fixture_preset=preset,
        )
    )


def test_input_contract_is_strict_and_blocks_unsafe_file_references() -> None:
    with pytest.raises(ValidationError):
        SafetyNetInputV1.model_validate(
            {
                **definition.fixture_input,
                "file_ref": "fixture://documents/../secrets.txt",
            }
        )
    with pytest.raises(ValidationError):
        SafetyNetInputV1.model_validate(
            {
                **definition.fixture_input,
                "max_bytes": "262144",
            }
        )
    with pytest.raises(ValidationError):
        SafetyNetInputV1.model_validate(
            {
                **definition.fixture_input,
                "undeclared": True,
            }
        )


def test_discriminated_read_contract_rejects_route_and_failure_mismatches() -> None:
    hardened = definition.build_handoff(
        "hardened", definition.fixture_input, "corrupt_partial"
    )
    with pytest.raises(ValidationError):
        SafetyNetHandoffV1.model_validate({**hardened, "route": "process"})

    malformed = {
        **hardened,
        "read": {
            **hardened["read"],
            "partial_content": None,
            "bytes_read": 0,
        },
    }
    with pytest.raises(ValidationError):
        SafetyNetHandoffV1.model_validate(malformed)


def test_handoff_revalidates_safe_reference_and_success_content_integrity() -> None:
    clean = definition.build_handoff("hardened", definition.fixture_input, "clean_read")
    with pytest.raises(ValidationError, match="unsafe path"):
        SafetyNetHandoffV1.model_validate(
            {**clean, "file_ref": "fixture://documents/../secrets.txt"}
        )
    with pytest.raises(ValidationError, match="SHA256"):
        SafetyNetHandoffV1.model_validate(
            {
                **clean,
                "read": {**clean["read"], "content_sha256": "0" * 64},
            }
        )
    with pytest.raises(ValidationError, match="encoded content length"):
        SafetyNetHandoffV1.model_validate(
            {
                **clean,
                "read": {**clean["read"], "bytes_read": clean["read"]["bytes_read"] + 1},
            }
        )


def test_baseline_is_schema_valid_but_mislabels_partial_data() -> None:
    handoff = definition.build_handoff(
        "baseline", definition.fixture_input, "corrupt_partial"
    )
    SafetyNetHandoffV1.model_validate(handoff)
    output_data = definition.build_output(
        "baseline", definition.fixture_input, handoff, "corrupt_partial"
    )
    output = SafetyNetOutputV1.model_validate(output_data)

    assert isinstance(output.result, CompleteDocumentSummaryV1)
    assert output.result.fallback_used is False
    checks = definition.evaluate_output(
        "baseline", definition.fixture_input, output_data, "corrupt_partial"
    )
    assert next(check for check in checks if check.check_id == "typed_output").passed
    assert not next(
        check for check in checks if check.check_id == "partial_not_mislabeled"
    ).passed


def test_hardened_partial_read_returns_typed_actionable_fallback() -> None:
    handoff = definition.build_handoff(
        "hardened", definition.fixture_input, "corrupt_partial"
    )
    assert handoff["read"]["status"] == "error"
    assert handoff["route"] == "fallback"
    output_data = definition.build_output(
        "hardened", definition.fixture_input, handoff, "corrupt_partial"
    )
    output = SafetyNetOutputV1.model_validate(output_data)

    assert isinstance(output.result, GracefulDocumentFallbackV1)
    assert output.result.error_code == "corrupt_partial"
    assert output.result.partial_data_discarded
    assert all(
        check.passed
        for check in definition.evaluate_output(
            "hardened", definition.fixture_input, output_data, "corrupt_partial"
        )
    )


def test_quality_checks_reject_semantically_swapped_corrupt_fallback() -> None:
    handoff = definition.build_handoff(
        "hardened", definition.fixture_input, "corrupt_partial"
    )
    output_data = definition.build_output(
        "hardened", definition.fixture_input, handoff, "corrupt_partial"
    )
    swapped = {
        **output_data,
        "result": {
            **output_data["result"],
            "error_code": "not_found",
            "partial_data_discarded": False,
            "retry_recommended": False,
        },
    }
    SafetyNetOutputV1.model_validate(swapped)
    checks = {
        check.check_id: check.passed
        for check in definition.evaluate_output(
            "hardened", definition.fixture_input, swapped, "corrupt_partial"
        )
    }

    assert checks["typed_output"] is True
    assert checks["fixture_semantics"] is False
    assert checks["failure_routed_at_source"] is False
    assert checks["partial_not_mislabeled"] is False


def test_request_continuity_is_enforced_in_build_and_quality_evaluation() -> None:
    handoff = definition.build_handoff("hardened", definition.fixture_input, "clean_read")
    wrong_handoff = {**handoff, "request_id": "docreq-2026-other"}
    SafetyNetHandoffV1.model_validate(wrong_handoff)
    with pytest.raises(ValueError, match="request_id"):
        definition.build_output(
            "hardened", definition.fixture_input, wrong_handoff, "clean_read"
        )

    output = definition.build_output(
        "hardened", definition.fixture_input, handoff, "clean_read"
    )
    wrong_output = {**output, "request_id": "docreq-2026-other"}
    SafetyNetOutputV1.model_validate(wrong_output)
    checks = {
        check.check_id: check.passed
        for check in definition.evaluate_output(
            "hardened", definition.fixture_input, wrong_output, "clean_read"
        )
    }
    assert checks["request_continuity"] is False


def test_summary_mode_is_honored_with_distinct_grounded_outputs() -> None:
    executive_handoff = definition.build_handoff(
        "hardened", definition.fixture_input, "clean_read"
    )
    executive = definition.build_output(
        "hardened", definition.fixture_input, executive_handoff, "clean_read"
    )
    detailed_input = {**definition.fixture_input, "summary_mode": "detailed"}
    detailed_handoff = definition.build_handoff("hardened", detailed_input, "clean_read")
    detailed = definition.build_output(
        "hardened", detailed_input, detailed_handoff, "clean_read"
    )

    assert executive["result"]["summary"] == EXECUTIVE_SUMMARY
    assert detailed["result"]["summary"] == DETAILED_SUMMARY
    assert executive["result"]["summary"] != detailed["result"]["summary"]
    assert all(
        check.passed
        for check in definition.evaluate_output(
            "hardened", detailed_input, detailed, "clean_read"
        )
    )


@pytest.mark.parametrize("read_kind", ["success", "corrupt_partial"])
def test_read_byte_budget_rejects_oversized_handoff_and_quality_result(
    read_kind: str,
) -> None:
    limited_input = {**definition.fixture_input, "max_bytes": 1_024}
    content = "x" * 2_048
    if read_kind == "success":
        handoff = definition.build_handoff("hardened", limited_input, "clean_read")
        oversized_read = {
            "status": "ok",
            "content": content,
            "content_sha256": sha256(content.encode()).hexdigest(),
            "bytes_read": len(content.encode()),
            "complete": True,
        }
        preset = "clean_read"
    else:
        handoff = definition.build_handoff(
            "hardened", limited_input, "corrupt_partial"
        )
        oversized_read = {
            **handoff["read"],
            "partial_content": content,
            "bytes_read": len(content.encode()),
        }
        preset = "corrupt_partial"
    oversized_handoff = {**handoff, "read": oversized_read}
    SafetyNetHandoffV1.model_validate(oversized_handoff)

    with pytest.raises(ValueError, match="exceeds max_bytes=1024"):
        definition.build_output(
            "hardened", limited_input, oversized_handoff, preset
        )

    normal_handoff = definition.build_handoff("hardened", limited_input, preset)
    output = definition.build_output(
        "hardened", limited_input, normal_handoff, preset
    )
    oversized_output = {
        **output,
        "result": {
            **output["result"],
            (
                "source_bytes"
                if read_kind == "success"
                else "source_bytes_observed"
            ): 2_048,
        },
    }
    SafetyNetOutputV1.model_validate(oversized_output)
    checks = {
        check.check_id: check.passed
        for check in definition.evaluate_output(
            "hardened", limited_input, oversized_output, preset
        )
    }
    assert checks["read_within_requested_limit"] is False
    assert checks["fixture_semantics"] is False


def test_clean_eval_rejects_ungrounded_summary_and_source_metadata() -> None:
    handoff = definition.build_handoff("hardened", definition.fixture_input, "clean_read")
    output = definition.build_output(
        "hardened", definition.fixture_input, handoff, "clean_read"
    )
    clean_eval = next(
        case for case in definition.eval_cases if case.name == "clean_document_summary"
    )
    expected_bytes = len(CLEAN_CONTENT.encode())
    assert output["result"]["source_bytes"] == expected_bytes

    for result_override in (
        {"summary": "A plausible but fixture-ungrounded document summary was returned."},
        {"source_sha256": "f" * 64},
        {"source_bytes": expected_bytes + 1},
    ):
        mutated = {
            **output,
            "result": {**output["result"], **result_override},
        }
        SafetyNetOutputV1.model_validate(mutated)
        run = RunRecord.model_construct(
            terminal_status="succeeded",
            input=definition.fixture_input,
            outputs={"result": mutated},
        )
        assert not all(clean_eval.evaluate(run).values())


def test_invalid_handoff_is_rejected_at_the_edge() -> None:
    invalid = definition.build_invalid_handoff(
        "hardened", definition.fixture_input, "corrupt_partial"
    )
    with pytest.raises(ValidationError):
        TypeAdapter(definition.handoff_model).validate_python(invalid)


def test_eval_case_contracts_cover_clean_escape_and_both_fallbacks() -> None:
    expected = {
        "clean_document_summary",
        "baseline_partial_data_escape",
        "hardened_partial_data_fallback",
        "missing_file_fallback",
        "safety_net_contract_drift_repair",
    }
    assert {case.name for case in definition.eval_cases} == expected

    for case in definition.eval_cases:
        if case.name == "safety_net_contract_drift_repair":
            continue
        handoff = definition.build_handoff(
            case.variant, definition.fixture_input, case.fixture_preset
        )
        output = definition.build_output(
            case.variant,
            definition.fixture_input,
            handoff,
            case.fixture_preset,
        )
        run = RunRecord.model_construct(
            terminal_status="succeeded",
            input=definition.fixture_input,
            outputs={"result": output},
        )
        assertions = case.evaluate(run)
        assert assertions
        assert all(assertions.values()), case.name


def test_runner_records_real_retry_transcript(tmp_path: Path) -> None:
    run = _run_scenario(tmp_path, "hardened", "clean_read")
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

    assert run.terminal_status == "succeeded"
    assert len(retries) == 1
    assert producer.request_count == 2
    assert [event.attempt for event in requests] == [1, 2]
    assert evidence.status == "repaired"
    assert evidence.validation_errors
    assert evidence.input_snapshot is not None
    assert "read" not in evidence.input_snapshot


def test_runner_edge_type_adapter_repairs_post_output_drift(tmp_path: Path) -> None:
    drift = _run_scenario(tmp_path, "hardened", "contract_drift")
    clean = _run_scenario(tmp_path, "hardened", "clean_read")
    rejections = [
        event for event in drift.events if event.kind == "edge_contract_rejected"
    ]
    edge_evidence = next(
        item
        for item in drift.pydantic_evidence
        if item.node_id == "edge_validator" and item.layer == "edge_contract"
    )
    eval_case = next(
        case
        for case in definition.eval_cases
        if case.name == "safety_net_contract_drift_repair"
    )

    assert len(rejections) == 1
    assert rejections[0].metadata["enforcement_layer"] == "pydantic_type_adapter"
    assert edge_evidence.status == "repaired"
    assert edge_evidence.validation_errors
    assert drift.metrics and drift.metrics.final_contract_pass and drift.metrics.task_pass
    assert not any(event.kind == "edge_contract_rejected" for event in clean.events)
    assert all(eval_case.evaluate(drift).values())
    assert not all(eval_case.evaluate(clean).values())


def test_runner_eval_cases_are_fixture_specific(tmp_path: Path) -> None:
    runs = {
        "clean_document_summary": _run_scenario(tmp_path, "hardened", "clean_read"),
        "baseline_partial_data_escape": _run_scenario(
            tmp_path, "baseline", "corrupt_partial"
        ),
        "hardened_partial_data_fallback": _run_scenario(
            tmp_path, "hardened", "corrupt_partial"
        ),
        "missing_file_fallback": _run_scenario(
            tmp_path, "hardened", "missing_file"
        ),
        "safety_net_contract_drift_repair": _run_scenario(
            tmp_path, "hardened", "contract_drift"
        ),
    }
    clean_control = runs["clean_document_summary"]

    for case in definition.eval_cases:
        assert all(case.evaluate(runs[case.name]).values()), case.name
        if case.name != "clean_document_summary":
            assert not all(case.evaluate(clean_control).values()), case.name
