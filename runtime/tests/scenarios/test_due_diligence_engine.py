from __future__ import annotations

from copy import deepcopy
from itertools import product
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from reagent_runtime.models import CreateRunRequest, RunRecord
from reagent_runtime.scenarios.due_diligence_engine import (
    FIXTURE_INPUT,
    DiligenceConclusionV1,
    DiligencePacketV1,
    DiligenceRequestV1,
    definition,
)
from reagent_runtime.scenarios.runner import RegisteredScenarioRunner
from reagent_runtime.store import RuntimeStore


def _output(variant: str, preset: str) -> dict[str, object]:
    handoff = definition.build_handoff(variant, FIXTURE_INPUT, preset)
    return definition.build_output(variant, FIXTURE_INPUT, handoff, preset)


def _checks(variant: str, preset: str) -> dict[str, object]:
    output = _output(variant, preset)
    return {
        check.check_id: check
        for check in definition.evaluate_output(
            variant,
            FIXTURE_INPUT,
            output,
            preset,
        )
    }


def _runtime_run(tmp_path: Path, variant: str, preset: str) -> RunRecord:
    runner = RegisteredScenarioRunner(
        RuntimeStore(tmp_path / f"{variant}-{preset}.db"),
        {definition.scenario_id: definition},
        "due-diligence-test-build",
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


def test_input_contract_is_strict_temporal_and_catalog_aware() -> None:
    parsed = DiligenceRequestV1.model_validate(FIXTURE_INPUT)
    assert parsed.company == "Northstar Systems"
    assert len(parsed.required_topics) == 4

    with pytest.raises(ValidationError):
        DiligenceRequestV1.model_validate(
            {
                **FIXTURE_INPUT,
                "decision_kind": 1,
            }
        )
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        DiligenceRequestV1.model_validate(
            {
                **FIXTURE_INPUT,
                "hidden_assumption": "growth always continues",
            }
        )

    future_sources = [dict(source) for source in FIXTURE_INPUT["sources"]]
    future_sources[0]["published_on"] = "2026-07-21"
    future_sources[0]["retrieved_on"] = "2026-07-21"
    with pytest.raises(ValidationError, match="published after the as-of date"):
        DiligenceRequestV1.model_validate(
            {
                **FIXTURE_INPUT,
                "sources": future_sources,
            }
        )

    forged_reliability = [dict(source) for source in FIXTURE_INPUT["sources"]]
    forged_reliability[-1]["reliability"] = "audited"
    with pytest.raises(ValidationError, match="management_claim requires reliability"):
        DiligenceRequestV1.model_validate(
            {
                **FIXTURE_INPUT,
                "sources": forged_reliability,
            }
        )


def test_handoff_contract_closes_claim_citation_and_source_lineage() -> None:
    handoff = definition.build_handoff("hardened", FIXTURE_INPUT, "clean")
    parsed = DiligencePacketV1.model_validate(handoff)
    assert parsed.unresolved_topics == []
    assert len(parsed.source_snapshot_ids) == 4

    broken = {
        **handoff,
        "citations": [
            {
                **handoff["citations"][0],
                "source_id": "SRC-999",
            },
            *handoff["citations"][1:],
        ],
    }
    with pytest.raises(ValidationError, match="outside the frozen snapshot"):
        DiligencePacketV1.model_validate(broken)

    dishonest_coverage = {
        **handoff,
        "coverage": [
            {
                **handoff["coverage"][0],
                "status": "missing",
            },
            *handoff["coverage"][1:],
        ],
    }
    with pytest.raises(ValidationError):
        DiligencePacketV1.model_validate(dishonest_coverage)


def test_packet_identity_and_derived_ledger_cannot_be_forged() -> None:
    handoff = definition.build_handoff(
        "hardened",
        FIXTURE_INPUT,
        "insufficient_evidence",
    )
    packet = DiligencePacketV1.model_validate(handoff)
    assert packet.coverage[-1].status == "missing"

    missing_row = {**handoff, "coverage": handoff["coverage"][:-1]}
    with pytest.raises(ValidationError, match="exactly one row per required topic"):
        DiligencePacketV1.model_validate(missing_row)

    forged_covered = {
        **handoff,
        "coverage": [
            *handoff["coverage"][:-1],
            {
                **handoff["coverage"][-1],
                "status": "covered",
                "source_ids": ["SRC-101"],
                "reason_code": "current_verified_citation",
                "explanation": (
                    "A current, non-self-reported citation is attached to this required topic."
                ),
            },
        ],
        "unresolved_topics": [],
        "uncertainty": "moderate",
    }
    with pytest.raises(ValidationError, match="must be derived from cited frozen sources"):
        DiligencePacketV1.model_validate(forged_covered)

    dangling_snapshot = {
        **handoff,
        "source_snapshot_ids": [*handoff["source_snapshot_ids"], "SRC-404"],
    }
    with pytest.raises(ValidationError, match="exactly match cited sources"):
        DiligencePacketV1.model_validate(dangling_snapshot)

    wrong_request = {
        **handoff,
        "company": "Another Company",
        "request_fingerprint": "0" * 64,
    }
    DiligencePacketV1.model_validate(wrong_request)
    with pytest.raises(ValueError, match="identity does not match"):
        definition.build_output(
            "hardened",
            FIXTURE_INPUT,
            wrong_request,
            "insufficient_evidence",
        )

    wrong_policy = {**handoff, "variant": "baseline", "policy_mode": "enforce"}
    with pytest.raises(ValidationError, match="baseline packets require policy_mode"):
        DiligencePacketV1.model_validate(wrong_policy)

    clean_handoff = definition.build_handoff("hardened", FIXTURE_INPUT, "clean")
    covered_row_claims_no_evidence = {
        **clean_handoff,
        "coverage": [
            {
                **clean_handoff["coverage"][0],
                "reason_code": "no_cited_evidence",
                "explanation": "No citation is attached to this required topic.",
            },
            *clean_handoff["coverage"][1:],
        ],
    }
    with pytest.raises(ValidationError, match="canonical rendering derived from status"):
        DiligencePacketV1.model_validate(covered_row_claims_no_evidence)


def test_invalid_handoff_is_rejected_by_the_edge_type_adapter() -> None:
    invalid = definition.build_invalid_handoff(
        "hardened",
        FIXTURE_INPUT,
        "contract_drift",
    )
    assert definition.edge_fault_field not in invalid
    with pytest.raises(ValidationError, match="source_snapshot_ids"):
        TypeAdapter(definition.handoff_model).validate_python(invalid)


def test_baseline_is_schema_valid_but_proceeds_with_a_gap_and_false_confidence() -> None:
    output_data = _output("baseline", "clean")
    output = DiligenceConclusionV1.model_validate(output_data)
    checks = _checks("baseline", "clean")

    assert output.decision == "proceed"
    assert output.policy_mode == "monitor"
    assert output.confidence == 0.98
    assert output.unresolved_topics == ["customer_concentration"]
    assert checks["typed_conclusion"].passed
    assert checks["citation_integrity"].passed
    assert checks["claim_factuality"].passed
    assert not checks["coverage_guard"].passed
    assert not checks["uncertainty_calibration"].passed
    assert not checks["diligence_task_success"].passed


def test_semantic_and_citation_traps_fail_different_independent_guarantees() -> None:
    semantic_output = DiligenceConclusionV1.model_validate(
        _output("baseline", "semantic_evidence_trap")
    )
    semantic_checks = _checks("baseline", "semantic_evidence_trap")
    assert "up 42%" in semantic_output.claims[0].statement
    assert semantic_checks["typed_conclusion"].passed
    assert semantic_checks["citation_integrity"].passed
    assert not semantic_checks["claim_factuality"].passed

    citation_output = DiligenceConclusionV1.model_validate(
        _output("baseline", "citation_lineage_trap")
    )
    citation_checks = _checks("baseline", "citation_lineage_trap")
    assert citation_output.evidence_manifest[0].canonical_uri.endswith("unrelated-investor-slide")
    assert citation_checks["typed_conclusion"].passed
    assert citation_checks["claim_factuality"].passed
    assert not citation_checks["citation_integrity"].passed


def test_stale_schema_valid_evidence_cannot_satisfy_freshness_policy() -> None:
    output = DiligenceConclusionV1.model_validate(_output("baseline", "stale_evidence"))
    checks = _checks("baseline", "stale_evidence")

    assert output.decision == "proceed"
    assert output.evidence_manifest[0].source_id == "SRC-909"
    assert output.coverage[0].status == "stale"
    assert checks["typed_conclusion"].passed
    assert not checks["freshness_guard"].passed
    assert not checks["diligence_task_success"].passed


def test_hardened_clean_path_enforces_lineage_freshness_and_bounded_confidence() -> None:
    output = DiligenceConclusionV1.model_validate(_output("hardened", "clean"))
    checks = _checks("hardened", "clean")

    assert output.decision == "proceed"
    assert output.policy_mode == "enforce"
    assert output.variant == "hardened"
    assert output.company == FIXTURE_INPUT["company"]
    assert output.decision_kind == FIXTURE_INPUT["decision_kind"]
    assert output.as_of_date == FIXTURE_INPUT["as_of_date"]
    assert output.required_topics == FIXTURE_INPUT["required_topics"]
    assert len(output.request_fingerprint) == 64
    assert output.coverage_gate_passed
    assert output.freshness_gate_passed
    assert output.source_lineage_complete
    assert output.confidence <= 0.85
    assert all(check.passed for check in checks.values())


def test_hardened_insufficient_evidence_returns_a_typed_escalation() -> None:
    output_data = _output("hardened", "insufficient_evidence")
    output = DiligenceConclusionV1.model_validate(output_data)
    checks = _checks("hardened", "insufficient_evidence")

    assert output.decision == "escalate"
    assert output.recommendation == "defer"
    assert output.confidence <= 0.5
    assert output.unresolved_topics == ["customer_concentration"]
    assert [action.topic for action in output.escalation_actions] == ["customer_concentration"]
    assert output.escalation_actions[0].requirement == (
        "obtain_fresh_independently_verified_evidence"
    )
    assert all(check.passed for check in checks.values())

    unsafe_proceed = {
        **output_data,
        "decision": "proceed",
        "recommendation": "invest",
        "confidence": 0.74,
        "summary_code": "enforced_proceed_after_declared_gates",
        "summary": (
            "Proceed with bounded confidence after all required topics passed the declared "
            "coverage and freshness gates."
        ),
        "escalation_actions": [],
    }
    with pytest.raises(ValidationError, match="require coverage and freshness"):
        DiligenceConclusionV1.model_validate(unsafe_proceed)


def test_conclusion_identity_decision_and_structured_actions_resist_tampering() -> None:
    clean = _output("hardened", "clean")
    wrong_recommendation = {**clean, "recommendation": "defer"}
    with pytest.raises(ValidationError, match="requires recommendation='invest'"):
        DiligenceConclusionV1.model_validate(wrong_recommendation)

    incomplete_coverage = {**clean, "coverage": clean["coverage"][:-1]}
    with pytest.raises(ValidationError, match="exactly one row per required topic"):
        DiligenceConclusionV1.model_validate(incomplete_coverage)

    forged_snapshot = {
        **clean,
        "source_snapshot_ids": [*clean["source_snapshot_ids"], "SRC-909"],
    }
    with pytest.raises(ValidationError, match="exactly match cited sources"):
        DiligenceConclusionV1.model_validate(forged_snapshot)

    escalation = _output("hardened", "insufficient_evidence")
    arbitrary_action = {
        **escalation,
        "escalation_actions": ["please investigate"],
    }
    with pytest.raises(ValidationError):
        DiligenceConclusionV1.model_validate(arbitrary_action)

    wrong_action_topic = {
        **escalation,
        "escalation_actions": [
            {
                "topic": "financial_performance",
                "requirement": "obtain_fresh_independently_verified_evidence",
            }
        ],
    }
    with pytest.raises(ValidationError, match="exactly cover unresolved topics"):
        DiligenceConclusionV1.model_validate(wrong_action_topic)

    invented_clean_summary = {
        **clean,
        "summary": (
            "Proceed because revenue is $99 million and the company has no material risks."
        ),
    }
    with pytest.raises(
        ValidationError,
        match="canonical rendering derived from variant, decision, and coverage",
    ):
        DiligenceConclusionV1.model_validate(invented_clean_summary)

    contradictory_escalation_summary = {
        **escalation,
        "summary_code": "enforced_proceed_after_declared_gates",
        "summary": (
            "Proceed with bounded confidence after all required topics passed the declared "
            "coverage and freshness gates."
        ),
    }
    with pytest.raises(
        ValidationError,
        match="canonical rendering derived from variant, decision, and coverage",
    ):
        DiligenceConclusionV1.model_validate(contradictory_escalation_summary)

    forged_identity = {**clean, "company": "Another Company"}
    DiligenceConclusionV1.model_validate(forged_identity)
    checks = definition.evaluate_output(
        "hardened",
        FIXTURE_INPUT,
        forged_identity,
        "clean",
    )
    checks_by_id = {check.check_id: check for check in checks}
    assert not checks_by_id["request_identity"].passed
    assert not checks_by_id["diligence_task_success"].passed


def test_human_facing_text_is_only_canonical_process_language() -> None:
    clean = DiligenceConclusionV1.model_validate(_output("hardened", "clean"))
    escalation = DiligenceConclusionV1.model_validate(_output("hardened", "insufficient_evidence"))

    assert clean.summary == (
        "Proceed with bounded confidence after all required topics passed the declared "
        "coverage and freshness gates."
    )
    assert escalation.summary == (
        "Defer and escalate because required topics lack current, verified cited evidence."
    )
    display_text = [
        clean.summary,
        escalation.summary,
        *(item.explanation for item in clean.coverage),
        *(item.explanation for item in escalation.coverage),
    ]
    for claim in [*clean.claims, *escalation.claims]:
        assert all(claim.statement not in text for text in display_text)
    assert all("$99" not in text and "no material risks" not in text for text in display_text)


def test_definition_teaches_pydantic_and_exposes_separated_eval_guarantees() -> None:
    assert definition.scenario_id == "due-diligence-engine"
    assert set(definition.fixture_presets) == {
        "clean",
        "contract_drift",
        "semantic_evidence_trap",
        "citation_lineage_trap",
        "stale_evidence",
        "insufficient_evidence",
    }
    assert len(definition.pydantic_lessons) >= 4
    assert {case.name for case in definition.eval_cases} == {
        "due_diligence_contract_drift_repair",
        "due_diligence_baseline_evidence_gap",
        "due_diligence_semantic_evidence_trap",
        "due_diligence_citation_lineage_trap",
        "due_diligence_hardened_clean",
        "due_diligence_hardened_escalation",
        "due_diligence_stale_evidence_escape",
    }


@pytest.mark.parametrize(
    ("variant", "preset"),
    list(product(("baseline", "hardened"), definition.fixture_presets)),
)
def test_all_twelve_variant_preset_runs_execute_real_pydantic_pipeline(
    tmp_path: Path,
    variant: str,
    preset: str,
) -> None:
    run = _runtime_run(tmp_path, variant, preset)

    assert run.terminal_status == "succeeded", run.failure_reason
    assert run.scenario_id == definition.scenario_id
    assert run.variant == variant
    assert run.fixture_preset == preset
    assert run.metrics is not None
    assert run.metrics.request_count == 3
    assert run.metrics.first_attempt_contract_pass is False
    assert run.metrics.final_contract_pass is True
    assert run.metrics.task_pass is (variant == "hardened")
    DiligenceConclusionV1.model_validate(run.outputs["result"])
    assert any(
        item.node_id == "producer" and item.layer == "agent_output" and item.status == "repaired"
        for item in run.pydantic_evidence
    )


def test_all_seven_evals_require_and_accept_complete_runtime_proof(
    tmp_path: Path,
) -> None:
    for case in definition.eval_cases:
        run = _runtime_run(tmp_path, case.variant, case.fixture_preset or "clean")
        assertions = case.evaluate(run)
        assert assertions and all(assertions.values()), (
            case.name,
            [name for name, passed in assertions.items() if not passed],
        )


def test_eval_rejects_wrong_identity_stripped_evidence_and_forged_transcripts(
    tmp_path: Path,
) -> None:
    case = next(
        item
        for item in definition.eval_cases
        if item.name == "due_diligence_semantic_evidence_trap"
    )
    authentic = _runtime_run(tmp_path, case.variant, case.fixture_preset or "clean")
    assert all(case.evaluate(authentic).values())

    wrong_identity = deepcopy(authentic)
    wrong_identity.scenario_id = "threat-analyst"
    assert not case.evaluate(wrong_identity)["run_identity_and_fixture_are_exact"]

    stripped = deepcopy(authentic)
    stripped.agent_invocations = []
    stripped.pydantic_evidence = []
    stripped_assertions = case.evaluate(stripped)
    assert not stripped_assertions["producer_retry_transcript_is_real"]
    assert not stripped_assertions["consumer_transcript_matches_output"]
    assert not stripped_assertions["contract_evidence_inventory_is_complete"]

    forged_consumer = deepcopy(authentic)
    consumer = next(
        item for item in forged_consumer.agent_invocations if item.node_id == "consumer"
    )
    for message in consumer.serialized_messages:
        for part in message.get("parts", []):
            if part.get("part_kind") == "tool-call":
                part["args"]["company"] = "Forged Transcript Company"
    assert not case.evaluate(forged_consumer)["consumer_transcript_matches_output"]

    forged_quality = deepcopy(authentic)
    forged_quality.outputs["quality_checks"][0]["passed"] = False
    assert not case.evaluate(forged_quality)["quality_checks_match_pydantic_evidence"]


def test_contract_eval_requires_exact_type_adapter_rejection_evidence(
    tmp_path: Path,
) -> None:
    case = next(
        item for item in definition.eval_cases if item.name == "due_diligence_contract_drift_repair"
    )
    authentic = _runtime_run(tmp_path, case.variant, case.fixture_preset or "clean")
    assert all(case.evaluate(authentic).values())

    forged = deepcopy(authentic)
    rejection = next(event for event in forged.events if event.kind == "edge_contract_rejected")
    rejection.validation_errors = ["forged error"]
    assertions = case.evaluate(forged)
    assert not assertions["edge_type_adapter_evidence_matches"]
