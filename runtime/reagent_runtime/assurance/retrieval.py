from __future__ import annotations

import hashlib
import math
import re
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Any, Literal

from .wire import canonical_decimal, canonical_hash

RetrievalMode = Literal["bm25", "vector", "hybrid"]
_TOKEN = re.compile(r"[a-z0-9]+")
_VECTOR_DIMENSIONS = 64
_QUANT = Decimal("0.001")


@dataclass(frozen=True)
class KnowledgeChunk:
    chunk_id: str
    source_id: str
    title: str
    text: str
    relevant: bool


_CORPORA: dict[tuple[str, str], tuple[str, tuple[KnowledgeChunk, ...]]] = {
    ("threat-analyst", "retrieve_intel_knowledge"): (
        "threat-intel-fixture-v1",
        (
            KnowledgeChunk(
                "intel-ip-198-51-100-42",
                "intel-ledger",
                "Observed command-and-control indicator",
                "The indicator 198.51.100.42 was observed in command-and-control traffic and "
                "is linked to the Northstar credential campaign.",
                True,
            ),
            KnowledgeChunk(
                "intel-northstar-campaign",
                "campaign-catalog",
                "Northstar credential campaign",
                "The Northstar campaign uses credential phishing followed by outbound beaconing "
                "to infrastructure including 198.51.100.42.",
                True,
            ),
            KnowledgeChunk(
                "intel-response-playbook",
                "soc-playbook",
                "Credential campaign response",
                "For confirmed Northstar indicators, isolate affected assets, preserve DNS and "
                "proxy evidence, and rotate exposed credentials.",
                True,
            ),
            KnowledgeChunk(
                "intel-printer-maintenance",
                "facilities-feed",
                "Printer maintenance window",
                "Office printers receive firmware maintenance on the first Sunday of each month.",
                False,
            ),
            KnowledgeChunk(
                "intel-travel-notice",
                "people-operations",
                "Travel policy notice",
                "International travel requests require manager approval ten days before departure.",
                False,
            ),
        ),
    ),
    ("due-diligence-engine", "research_company"): (
        "northstar-diligence-fixture-v1",
        (
            KnowledgeChunk(
                "northstar-financials",
                "company-ledger",
                "Northstar financial profile",
                "Northstar Labs reports 20 percent annual growth, 30 percent gross margin, "
                "and 10 million dollars in recurring revenue.",
                True,
            ),
            KnowledgeChunk(
                "northstar-concentration",
                "risk-register",
                "Customer concentration risk",
                "Northstar Labs has customer concentration risk: its largest customer "
                "represents 38 percent of recurring revenue.",
                True,
            ),
            KnowledgeChunk(
                "northstar-team",
                "people-dossier",
                "Leadership assessment",
                "Northstar Labs retains its founding engineering team and added an experienced "
                "enterprise sales leader in 2025.",
                True,
            ),
            KnowledgeChunk(
                "market-weather",
                "misc-notes",
                "Unrelated market note",
                "Regional weather conditions improved shipping times for consumer retailers.",
                False,
            ),
            KnowledgeChunk(
                "office-renovation",
                "facilities-log",
                "Facilities update",
                "The downtown office renovation replaced lighting and conference room furniture.",
                False,
            ),
        ),
    ),
    ("ops-center", "lookup_runbook"): (
        "ops-runbooks-fixture-v1",
        (
            KnowledgeChunk(
                "runbook-checkout-latency",
                "runbook-catalog",
                "Checkout API latency",
                "For elevated checkout-api latency, inspect p99 duration, database pool "
                "saturation, and recent deploys before considering rollback.",
                True,
            ),
            KnowledgeChunk(
                "runbook-database-pool",
                "runbook-catalog",
                "Database connection saturation",
                "When checkout requests queue, compare active database connections with pool "
                "limits and reduce concurrency before restarting services.",
                True,
            ),
            KnowledgeChunk(
                "runbook-observability-gap",
                "runbook-catalog",
                "Missing logs during an incident",
                "If checkout logs are unavailable, preserve the observability gap, use status "
                "and metric evidence, and request manual log retrieval.",
                True,
            ),
            KnowledgeChunk(
                "runbook-password-reset",
                "support-handbook",
                "Customer password reset",
                "Verify customer identity before sending a password reset link.",
                False,
            ),
            KnowledgeChunk(
                "runbook-office-network",
                "facilities-handbook",
                "Office guest network",
                "Guest wireless access expires after eight hours and cannot reach production.",
                False,
            ),
        ),
    ),
}


def retrieval_registry_digest() -> str:
    return canonical_hash(
        {
            f"{scenario_id}:{operation_id}": {
                "corpus_id": corpus_id,
                "chunks": [
                    {
                        "chunk_id": chunk.chunk_id,
                        "source_id": chunk.source_id,
                        "title": chunk.title,
                        "text": chunk.text,
                        "relevant": chunk.relevant,
                    }
                    for chunk in chunks
                ],
            }
            for (scenario_id, operation_id), (corpus_id, chunks) in sorted(_CORPORA.items())
        }
    )


def _tokens(value: str) -> list[str]:
    return _TOKEN.findall(value.casefold())


def _semantic_values(value: Any) -> list[str]:
    if isinstance(value, Mapping):
        return [
            text
            for key, item in value.items()
            if not str(key).startswith("_")
            for text in _semantic_values(item)
        ]
    if isinstance(value, (list, tuple)):
        return [text for item in value for text in _semantic_values(item)]
    if isinstance(value, (str, int, float, bool)):
        return [str(value)]
    return []


def _query(payload: Any, run_input: Mapping[str, Any]) -> str:
    source = run_input if run_input else payload
    text = " ".join(_semantic_values(source)).strip()
    return text or "registered knowledge query"


def _bm25_scores(query: str, chunks: tuple[KnowledgeChunk, ...]) -> list[float]:
    documents = [_tokens(f"{chunk.title} {chunk.text}") for chunk in chunks]
    query_terms = Counter(_tokens(query))
    average_length = sum(map(len, documents)) / max(len(documents), 1)
    scores: list[float] = []
    for document in documents:
        frequencies = Counter(document)
        score = 0.0
        for term, query_frequency in query_terms.items():
            containing = sum(term in candidate for candidate in documents)
            inverse_frequency = math.log(
                1 + (len(documents) - containing + 0.5) / (containing + 0.5)
            )
            frequency = frequencies[term]
            denominator = frequency + 1.5 * (
                1 - 0.75 + 0.75 * len(document) / max(average_length, 1)
            )
            score += query_frequency * inverse_frequency * (frequency * 2.5 / denominator)
        scores.append(score)
    return scores


def _hashed_vector(tokens: list[str]) -> list[float]:
    vector = [0.0] * _VECTOR_DIMENSIONS
    for token, count in Counter(tokens).items():
        digest = hashlib.sha256(token.encode()).digest()
        index = int.from_bytes(digest[:4], "big") % _VECTOR_DIMENSIONS
        vector[index] += float(count)
    magnitude = math.sqrt(sum(item * item for item in vector))
    return [item / magnitude for item in vector] if magnitude else vector


def _vector_scores(query: str, chunks: tuple[KnowledgeChunk, ...]) -> list[float]:
    query_vector = _hashed_vector(_tokens(query))
    return [
        sum(
            left * right
            for left, right in zip(
                query_vector,
                _hashed_vector(_tokens(f"{chunk.title} {chunk.text}")),
                strict=True,
            )
        )
        for chunk in chunks
    ]


def _normalize(values: list[float]) -> list[float]:
    maximum = max(values, default=0.0)
    if maximum <= 0:
        return [0.0 for _ in values]
    return [max(0.0, min(value / maximum, 1.0)) for value in values]


def _metric(value: float) -> str:
    bounded = Decimal(str(max(0.0, min(value, 1.0)))).quantize(_QUANT, rounding=ROUND_HALF_EVEN)
    return canonical_decimal(bounded)


def execute_knowledge_retrieval(
    *,
    scenario_id: str,
    operation_id: str,
    payload: Any,
    run_input: Mapping[str, Any],
    retrieval_mode: RetrievalMode,
    top_k: int,
) -> dict[str, Any]:
    """Run a deterministic one-run retrieval fixture with ID-based ground truth.

    The vector mode intentionally uses a stable token-hash vector rather than claiming a
    production embedding service. Metrics are RAGAS-aligned, deterministic teaching metrics.
    """

    corpus_id, chunks = _CORPORA[(scenario_id, operation_id)]
    query = _query(payload, run_input)
    bm25 = _normalize(_bm25_scores(query, chunks))
    vector = _normalize(_vector_scores(query, chunks))
    if retrieval_mode == "bm25":
        scores = bm25
    elif retrieval_mode == "vector":
        scores = vector
    else:
        scores = [(left + right) / 2 for left, right in zip(bm25, vector, strict=True)]

    ranked = sorted(zip(chunks, scores, strict=True), key=lambda item: (-item[1], item[0].chunk_id))
    selected = ranked[: min(top_k, len(ranked))]
    relevant_total = sum(chunk.relevant for chunk in chunks)
    relevant_retrieved = sum(chunk.relevant for chunk, _ in selected)
    precision_terms: list[float] = []
    relevant_seen = 0
    for rank, (chunk, _) in enumerate(selected, start=1):
        if chunk.relevant:
            relevant_seen += 1
            precision_terms.append(relevant_seen / rank)
    context_precision = sum(precision_terms) / len(precision_terms) if precision_terms else 0.0
    context_recall = relevant_retrieved / relevant_total if relevant_total else 1.0
    context_relevance = sum(score for _, score in selected) / len(selected) if selected else 0.0
    retrieved = [
        {
            "chunk_id": chunk.chunk_id,
            "source_id": chunk.source_id,
            "rank": rank,
            "score": _metric(score),
            "relevant": chunk.relevant,
            "title": chunk.title,
            "excerpt": chunk.text,
        }
        for rank, (chunk, score) in enumerate(selected, start=1)
    ]
    return {
        "operation_id": operation_id,
        "corpus_id": corpus_id,
        "retrieval_mode": retrieval_mode,
        "top_k": top_k,
        "query": query,
        "retrieved": retrieved,
        "metrics": {
            "metric_family": "ragas_aligned_deterministic",
            "context_precision": _metric(context_precision),
            "context_recall": _metric(context_recall),
            "context_relevance": _metric(context_relevance),
            "faithfulness": None,
            "faithfulness_status": "not_measured_requires_generation",
        },
    }
