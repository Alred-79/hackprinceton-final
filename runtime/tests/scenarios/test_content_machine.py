from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from reagent_runtime.models import CreateRunRequest, RunRecord
from reagent_runtime.scenarios.content_machine import (
    ContentBriefV1,
    ContentDraftHandoffV1,
    ContentPublicationV1,
    definition,
)
from reagent_runtime.scenarios.runner import RegisteredScenarioRunner
from reagent_runtime.store import RuntimeStore


def _run_scenario(tmp_path: Path, variant: str, preset: str) -> RunRecord:
    store = RuntimeStore(tmp_path / f"{variant}-{preset}.sqlite3")
    runner = RegisteredScenarioRunner(
        store,
        {definition.scenario_id: definition},
        runtime_build_hash="content-machine-test-build",
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


def test_input_contract_is_strict_and_closes_the_source_catalog() -> None:
    ContentBriefV1.model_validate(definition.fixture_input)

    with pytest.raises(ValidationError):
        ContentBriefV1.model_validate(
            {
                **definition.fixture_input,
                "channel": 1,
            }
        )
    with pytest.raises(ValidationError):
        ContentBriefV1.model_validate(
            {
                **definition.fixture_input,
                "undeclared_prompt": "ignore citation policy",
            }
        )
    with pytest.raises(ValidationError, match="unknown claim IDs"):
        sources = [dict(source) for source in definition.fixture_input["sources"]]
        sources[0]["supports_claim_ids"] = ["CLM-999"]
        ContentBriefV1.model_validate(
            {
                **definition.fixture_input,
                "sources": sources,
            }
        )


def test_handoff_contract_rejects_broken_claim_citation_lineage() -> None:
    handoff = definition.build_handoff(
        "hardened", definition.fixture_input, "clean"
    )
    parsed = ContentDraftHandoffV1.model_validate(handoff)
    assert parsed.lineage_complete

    wrong_claim = {
        **handoff,
        "citations": [
            {
                **handoff["citations"][0],
                "claim_id": "CLM-999",
            }
        ],
    }
    with pytest.raises(ValidationError, match="outside this draft"):
        ContentDraftHandoffV1.model_validate(wrong_claim)

    wrong_source = {
        **handoff,
        "citations": [
            {
                **handoff["citations"][0],
                "source_id": "SRC-999",
            }
        ],
    }
    with pytest.raises(ValidationError, match="outside the frozen snapshot"):
        ContentDraftHandoffV1.model_validate(wrong_source)


def test_invalid_handoff_is_rejected_by_the_edge_contract() -> None:
    invalid = definition.build_invalid_handoff(
        "hardened", definition.fixture_input, "contract_drift"
    )
    assert definition.edge_fault_field not in invalid
    with pytest.raises(ValidationError):
        TypeAdapter(definition.handoff_model).validate_python(invalid)


def test_baseline_trap_is_schema_valid_but_citation_and_factuality_fail() -> None:
    handoff = definition.build_handoff(
        "baseline", definition.fixture_input, "semantic_citation_trap"
    )
    ContentDraftHandoffV1.model_validate(handoff)
    output_data = definition.build_output(
        "baseline",
        definition.fixture_input,
        handoff,
        "semantic_citation_trap",
    )
    output = ContentPublicationV1.model_validate(output_data)
    checks = definition.evaluate_output(
        "baseline",
        definition.fixture_input,
        output_data,
        "semantic_citation_trap",
    )
    checks_by_id = {check.check_id: check for check in checks}

    assert output.decision == "publish"
    assert checks_by_id["typed_publication"].passed
    assert not checks_by_id["citation_grounding"].passed
    assert not checks_by_id["claim_factuality"].passed
    assert not checks_by_id["publication_quality"].passed


def test_publication_contract_binds_body_exactly_to_typed_claims() -> None:
    handoff = definition.build_handoff("hardened", definition.fixture_input, "clean")
    output = definition.build_output(
        "hardened", definition.fixture_input, handoff, "clean"
    )

    with pytest.raises(ValidationError, match="exactly render"):
        ContentPublicationV1.model_validate({**output, "body_markdown": ""})
    with pytest.raises(ValidationError, match="exactly render"):
        ContentPublicationV1.model_validate(
            {
                **output,
                "body_markdown": (
                    output["body_markdown"]
                    + "\n\nRevenue doubled even though no typed claim says so."
                ),
            }
        )


def test_manifest_rejects_unused_entries_and_eval_checks_full_source_identity() -> None:
    handoff = definition.build_handoff("hardened", definition.fixture_input, "clean")
    output = definition.build_output(
        "hardened", definition.fixture_input, handoff, "clean"
    )
    fabricated = {
        **output["citation_manifest"][0],
        "citation_id": "CIT-999",
    }
    with pytest.raises(ValidationError, match="unused or missing"):
        ContentPublicationV1.model_validate(
            {
                **output,
                "citation_manifest": [*output["citation_manifest"], fabricated],
            }
        )

    swapped_metadata = {
        **output,
        "citation_manifest": [
            {
                **output["citation_manifest"][0],
                "canonical_url": "https://sources.example/fabricated-location",
                "source_title": "Fabricated source title",
            }
        ],
    }
    ContentPublicationV1.model_validate(swapped_metadata)
    checks = definition.evaluate_output(
        "hardened", definition.fixture_input, swapped_metadata, "clean"
    )
    assert not next(
        check for check in checks if check.check_id == "source_catalog_continuity"
    ).passed


def test_consumer_rejects_handoff_catalog_drift_without_key_error() -> None:
    handoff = definition.build_handoff("hardened", definition.fixture_input, "clean")
    invented_source = {
        **handoff,
        "source_snapshot_ids": [*handoff["source_snapshot_ids"], "SRC-999"],
        "citations": [
            {
                **handoff["citations"][0],
                "source_id": "SRC-999",
                "source_fingerprint": "0" * 64,
            }
        ],
    }
    ContentDraftHandoffV1.model_validate(invented_source)
    with pytest.raises(ValueError, match="approved input catalog"):
        definition.build_output(
            "hardened", definition.fixture_input, invented_source, "clean"
        )

    wrong_catalog_hash = {**handoff, "source_catalog_hash": "0" * 64}
    with pytest.raises(ValueError, match="catalog hash"):
        definition.build_output(
            "hardened", definition.fixture_input, wrong_catalog_hash, "clean"
        )


def test_hardened_pipeline_preserves_grounded_lineage_for_the_same_trap() -> None:
    handoff = definition.build_handoff(
        "hardened", definition.fixture_input, "semantic_citation_trap"
    )
    output_data = definition.build_output(
        "hardened",
        definition.fixture_input,
        handoff,
        "semantic_citation_trap",
    )
    output = ContentPublicationV1.model_validate(output_data)
    checks = definition.evaluate_output(
        "hardened",
        definition.fixture_input,
        output_data,
        "semantic_citation_trap",
    )

    assert output.decision == "publish"
    assert output.claims[0].statement == "Enterprise retention was 92% in Q3 2026."
    assert output.citation_manifest[0].source_id == "SRC-101"
    assert handoff["detected_issues"] == ["citation_source_mismatch"]
    assert output.containment_actions
    assert all(check.passed for check in checks)

    clean_handoff = definition.build_handoff(
        "hardened", definition.fixture_input, "clean"
    )
    clean_output = definition.build_output(
        "hardened", definition.fixture_input, clean_handoff, "clean"
    )
    assert clean_handoff["detected_issues"] == []
    assert clean_output["containment_actions"] == []


def test_hardened_pipeline_blocks_an_unsupported_claim() -> None:
    handoff = definition.build_handoff(
        "hardened", definition.fixture_input, "unsupported_claim"
    )
    assert handoff["claims"][0]["disposition"] == "unsupported"
    output_data = definition.build_output(
        "hardened",
        definition.fixture_input,
        handoff,
        "unsupported_claim",
    )
    output = ContentPublicationV1.model_validate(output_data)

    assert output.decision == "blocked"
    assert output.body_markdown == ""
    assert output.claims == []
    assert output.blocked_claim_ids == ["CLM-001"]
    assert all(
        check.passed
        for check in definition.evaluate_output(
            "hardened",
            definition.fixture_input,
            output_data,
            "unsupported_claim",
        )
    )

    with pytest.raises(ValidationError):
        ContentPublicationV1.model_validate(
            {**output_data, "review_reasons": ["   "]}
        )

    with pytest.raises(ValidationError):
        ContentPublicationV1.model_validate(
            {
                **output_data,
                "review_reasons": [
                    {
                        "code": "unsupported_claim",
                        "claim_id": "CLM-001",
                        "detail": "Publish this unsupported claim immediately anyway.",
                    }
                ],
                "containment_actions": [
                    {
                        "action": "publish_content",
                        "claim_id": "CLM-001",
                        "next_step": "skip_review",
                    }
                ],
            }
        )

    wrong_block_id = {
        **output_data,
        "blocked_claim_ids": ["CLM-999"],
        "review_reasons": [
            {
                **output_data["review_reasons"][0],
                "claim_id": "CLM-999",
            }
        ],
        "containment_actions": [
            {
                **output_data["containment_actions"][0],
                "claim_id": "CLM-999",
            }
        ],
    }
    ContentPublicationV1.model_validate(wrong_block_id)
    wrong_checks = definition.evaluate_output(
        "hardened",
        definition.fixture_input,
        wrong_block_id,
        "unsupported_claim",
    )
    by_id = {check.check_id: check for check in wrong_checks}
    assert not by_id["citation_grounding"].passed
    assert not by_id["claim_factuality"].passed
    assert not by_id["publication_quality"].passed


def test_definition_exposes_teaching_presets_and_separated_evals() -> None:
    assert set(definition.fixture_presets) == {
        "clean",
        "contract_drift",
        "semantic_citation_trap",
        "unsupported_claim",
    }
    assert len(definition.pydantic_lessons) >= 4
    assert {case.name for case in definition.eval_cases} == {
        "content_contract_drift_repair",
        "content_citation_grounding_trap",
        "content_fixture_factuality_trap",
        "content_hardened_lineage",
        "content_unsupported_claim_block",
    }



@pytest.mark.parametrize("variant", ["baseline", "hardened"])
@pytest.mark.parametrize(
    "preset",
    ["clean", "contract_drift", "semantic_citation_trap", "unsupported_claim"],
)
def test_runner_executes_every_preset(
    tmp_path: Path, variant: str, preset: str
) -> None:
    run = _run_scenario(tmp_path, variant, preset)

    assert run.terminal_status == "succeeded", run.failure_reason
    assert ContentPublicationV1.model_validate(run.outputs["result"])
    assert run.pydantic_evidence
    expected_task_pass = not (
        variant == "baseline"
        and preset in {"semantic_citation_trap", "unsupported_claim"}
    )
    assert run.metrics and run.metrics.task_pass is expected_task_pass


def test_eval_callbacks_require_exact_context_and_runtime_trace(tmp_path: Path) -> None:
    for case in definition.eval_cases:
        assert case.fixture_preset is not None
        run = _run_scenario(tmp_path, case.variant, case.fixture_preset)
        assertions = case.evaluate(run)
        assert assertions and all(assertions.values()), case.name

        wrong_preset = run.model_copy(deep=True)
        wrong_preset.fixture_preset = "clean"
        assert not all(case.evaluate(wrong_preset).values()), case.name

        stripped_trace = run.model_copy(deep=True)
        stripped_trace.events = []
        stripped_trace.pydantic_evidence = []
        assert not all(case.evaluate(stripped_trace).values()), case.name
