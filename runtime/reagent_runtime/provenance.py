from __future__ import annotations

import re
from typing import Any

from .models import (
    ClaimAssessment,
    HandoffEnvelope,
    ModelClaim,
    SourceRef,
    stable_hash,
)

SOURCES = {
    "src-telemetry": SourceRef(
        id="src-telemetry",
        uri="fixture://telemetry/198.51.100.42",
        content_hash=stable_hash("198.51.100.42 is malicious"),
        excerpt="198.51.100.42 is malicious with high-confidence telemetry matches.",
    ),
    "src-advisory": SourceRef(
        id="src-advisory",
        uri="fixture://advisory/campaign-7",
        content_hash=stable_hash("Campaign 7 has unknown attribution"),
        excerpt="Campaign 7 attribution is unknown; no operator has been confirmed.",
    ),
}

FACT_LEDGER = {
    "fact-indicator-malicious": {
        "source_id": "src-telemetry",
        "tokens": {"indicator", "198", "51", "100", "42", "malicious"},
        "status": "supported",
    },
    "fact-attribution-unknown": {
        "source_id": "src-advisory",
        "tokens": {"attribution", "unknown", "not", "confirmed"},
        "status": "contradicted",
    },
}


def normalize_claim(statement: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", statement.lower()))


def claim_fingerprint(statement: str) -> str:
    return stable_hash(" ".join(sorted(normalize_claim(statement))))


def assess_claim(claim: ModelClaim, node_id: str) -> ClaimAssessment:
    tokens = normalize_claim(claim.statement)
    state_sponsor = bool({"state", "sponsored"} <= tokens or "attribution" in tokens)
    malicious_indicator = "malicious" in tokens and bool({"indicator", "198"} & tokens)
    if state_sponsor:
        return ClaimAssessment(
            claim_fingerprint=claim_fingerprint(claim.statement),
            claim_id=claim.id,
            node_id=node_id,
            assessment="unsupported",
            matched_fixture_fact_ids=["fact-attribution-unknown"],
        )
    if malicious_indicator:
        return ClaimAssessment(
            claim_fingerprint=claim_fingerprint(claim.statement),
            claim_id=claim.id,
            node_id=node_id,
            assessment="supported",
            matched_fixture_fact_ids=["fact-indicator-malicious"],
        )
    return ClaimAssessment(
        claim_fingerprint=claim_fingerprint(claim.statement),
        claim_id=claim.id,
        node_id=node_id,
        assessment="unknown",
    )


def citation_integrity(claim: ModelClaim) -> tuple[bool, list[str]]:
    missing = sorted(source_id for source_id in claim.citation_ids if source_id not in SOURCES)
    return not missing, missing


def citation_support(claim: ModelClaim) -> bool:
    assessment = assess_claim(claim, "citation-support")
    if assessment.assessment == "supported":
        return "src-telemetry" in claim.citation_ids
    if "state" in normalize_claim(claim.statement):
        return False
    return False


def make_envelope(
    *,
    run_id: str,
    trace_id: str,
    hop: int,
    sender: str,
    receiver: str,
    schema_name: str,
    payload: Any,
    claims: list[ModelClaim],
    source_ids: list[str],
    constraint_ids: list[str],
    parent_hash: str | None,
) -> HandoffEnvelope[Any]:
    owned = {
        "run_id": run_id,
        "trace_id": trace_id,
        "hop": hop,
        "sender": sender,
        "receiver": receiver,
        "schema_name": schema_name,
        "schema_version": "1",
        "payload": payload.model_dump(mode="json") if hasattr(payload, "model_dump") else payload,
        "claims": [claim.model_dump(mode="json") for claim in claims],
        "source_ids": source_ids,
        "preserved_constraint_ids": constraint_ids,
        "parent_envelope_hash": parent_hash,
    }
    return HandoffEnvelope[Any](**owned, integrity_hash=stable_hash(owned))
