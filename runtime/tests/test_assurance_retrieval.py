from __future__ import annotations

import pytest

from reagent_runtime.assurance.retrieval import (
    execute_knowledge_retrieval,
    retrieval_registry_digest,
)


@pytest.mark.parametrize("retrieval_mode", ["bm25", "vector", "hybrid"])
def test_registered_retrieval_modes_are_deterministic_and_inspectable(
    retrieval_mode: str,
) -> None:
    arguments = {
        "scenario_id": "threat-analyst",
        "operation_id": "retrieve_intel_knowledge",
        "payload": {},
        "run_input": {
            "indicator": "198.51.100.42",
            "campaign": "Northstar credential campaign",
        },
        "retrieval_mode": retrieval_mode,
        "top_k": 3,
    }

    first = execute_knowledge_retrieval(**arguments)  # type: ignore[arg-type]
    second = execute_knowledge_retrieval(**arguments)  # type: ignore[arg-type]

    assert first == second
    assert first["retrieval_mode"] == retrieval_mode
    assert [chunk["rank"] for chunk in first["retrieved"]] == [1, 2, 3]
    assert all(chunk["chunk_id"] and chunk["source_id"] for chunk in first["retrieved"])
    assert first["metrics"]["metric_family"] == "ragas_aligned_deterministic"
    assert first["metrics"]["faithfulness"] is None
    assert first["metrics"]["faithfulness_status"] == "not_measured_requires_generation"


def test_top_k_changes_retrieval_evidence_and_fixture_recall() -> None:
    common = {
        "scenario_id": "ops-center",
        "operation_id": "lookup_runbook",
        "payload": {},
        "run_input": {
            "service": "checkout-api",
            "symptom": "elevated p99 latency and missing logs",
        },
        "retrieval_mode": "hybrid",
    }
    top_one = execute_knowledge_retrieval(**common, top_k=1)  # type: ignore[arg-type]
    top_five = execute_knowledge_retrieval(**common, top_k=5)  # type: ignore[arg-type]

    assert len(top_one["retrieved"]) == 1
    assert len(top_five["retrieved"]) == 5
    assert float(top_one["metrics"]["context_recall"]) < float(
        top_five["metrics"]["context_recall"]
    )
    assert any(not chunk["relevant"] for chunk in top_five["retrieved"])


def test_frozen_corpus_registry_is_bound_to_a_stable_digest() -> None:
    assert len(retrieval_registry_digest()) == 64
    assert retrieval_registry_digest() == retrieval_registry_digest()
