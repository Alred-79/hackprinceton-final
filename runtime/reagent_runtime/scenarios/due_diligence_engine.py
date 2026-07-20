from __future__ import annotations

from datetime import date
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from ..models import RunRecord, stable_hash
from .base import QualityCheck, ScenarioDefinition, ScenarioEvalCase

Topic = Literal[
    "financial_performance",
    "security_posture",
    "regulatory_compliance",
    "customer_concentration",
]
CoverageStatus = Literal["covered", "missing", "stale", "unverified"]
CoverageReasonCode = Literal[
    "current_verified_citation",
    "no_cited_evidence",
    "citation_before_freshness_threshold",
    "self_reported_citation_only",
]
SummaryCode = Literal[
    "monitor_proceed_with_unresolved_evidence",
    "monitor_proceed_without_enforced_truth_gate",
    "enforced_proceed_after_declared_gates",
    "enforced_escalation_for_unresolved_evidence",
]

COVERAGE_PRESENTATION: dict[CoverageStatus, tuple[CoverageReasonCode, str]] = {
    "covered": (
        "current_verified_citation",
        "A current, non-self-reported citation is attached to this required topic.",
    ),
    "missing": (
        "no_cited_evidence",
        "No citation is attached to this required topic.",
    ),
    "stale": (
        "citation_before_freshness_threshold",
        "At least one attached citation predates the required freshness threshold.",
    ),
    "unverified": (
        "self_reported_citation_only",
        "At least one attached citation is self-reported rather than independently verified.",
    ),
}

SUMMARY_PRESENTATION: dict[SummaryCode, str] = {
    "monitor_proceed_with_unresolved_evidence": (
        "Monitor mode proceeded despite unresolved required evidence."
    ),
    "monitor_proceed_without_enforced_truth_gate": (
        "Monitor mode proceeded without an enforced external truth gate."
    ),
    "enforced_proceed_after_declared_gates": (
        "Proceed with bounded confidence after all required topics passed the declared "
        "coverage and freshness gates."
    ),
    "enforced_escalation_for_unresolved_evidence": (
        "Defer and escalate because required topics lack current, verified cited evidence."
    ),
}


class StrictDiligenceContract(BaseModel):
    """Diligence contracts reject coercion and undeclared fields."""

    model_config = ConfigDict(extra="forbid", strict=True)


def _parse_date(value: str, field_name: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{field_name} must be an ISO-8601 calendar date") from exc


class EvidenceSourceV1(StrictDiligenceContract):
    source_id: str = Field(pattern=r"^SRC-[0-9]{3}$")
    topic: Topic
    source_type: Literal[
        "audited_financials",
        "independent_audit",
        "regulatory_filing",
        "verified_customer_schedule",
        "management_claim",
    ]
    reliability: Literal["audited", "verified", "self_reported"]
    title: str = Field(min_length=8, max_length=180)
    canonical_uri: str = Field(pattern=r"^https://diligence\.example/")
    published_on: str = Field(pattern=r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")
    retrieved_on: str = Field(pattern=r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")
    evidence_statement: str = Field(min_length=20, max_length=400)

    @model_validator(mode="after")
    def source_provenance_is_coherent(self) -> Self:
        published = _parse_date(self.published_on, "published_on")
        retrieved = _parse_date(self.retrieved_on, "retrieved_on")
        if retrieved < published:
            raise ValueError("retrieved_on cannot precede published_on")
        expected_reliability = {
            "audited_financials": "audited",
            "independent_audit": "verified",
            "regulatory_filing": "verified",
            "verified_customer_schedule": "verified",
            "management_claim": "self_reported",
        }[self.source_type]
        if self.reliability != expected_reliability:
            raise ValueError(f"{self.source_type} requires reliability={expected_reliability!r}")
        return self


class DiligenceRequestV1(StrictDiligenceContract):
    case_id: str = Field(pattern=r"^DDE-[0-9]{4}$")
    company: str = Field(min_length=3, max_length=120)
    decision_kind: Literal["investment", "acquisition", "vendor_approval"]
    as_of_date: str = Field(pattern=r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")
    minimum_freshness_date: str = Field(pattern=r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")
    required_topics: list[Topic] = Field(min_length=1, max_length=4)
    sources: list[EvidenceSourceV1] = Field(min_length=1, max_length=16)

    @field_validator("required_topics")
    @classmethod
    def topics_are_unique(cls, value: list[Topic]) -> list[Topic]:
        if len(value) != len(set(value)):
            raise ValueError("required_topics must be unique")
        return value

    @model_validator(mode="after")
    def source_catalog_is_temporally_valid_and_addressable(self) -> Self:
        as_of = _parse_date(self.as_of_date, "as_of_date")
        freshness = _parse_date(self.minimum_freshness_date, "minimum_freshness_date")
        if freshness > as_of:
            raise ValueError("minimum_freshness_date cannot be after as_of_date")
        source_ids = [source.source_id for source in self.sources]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("source IDs must be unique")
        for source in self.sources:
            if _parse_date(source.published_on, "published_on") > as_of:
                raise ValueError(f"{source.source_id} was published after the as-of date")
            if _parse_date(source.retrieved_on, "retrieved_on") > as_of:
                raise ValueError(f"{source.source_id} was retrieved after the as-of date")
        catalog_topics = {source.topic for source in self.sources}
        missing = set(self.required_topics) - catalog_topics
        if missing:
            raise ValueError(f"source catalog has no candidates for topics: {sorted(missing)}")
        return self


class EvidenceCitationV1(StrictDiligenceContract):
    citation_id: str = Field(pattern=r"^CIT-[0-9]{3}$")
    claim_id: str = Field(pattern=r"^CLM-[0-9]{3}$")
    source_id: str = Field(pattern=r"^SRC-[0-9]{3}$")
    topic: Topic
    source_type: Literal[
        "audited_financials",
        "independent_audit",
        "regulatory_filing",
        "verified_customer_schedule",
        "management_claim",
    ]
    reliability: Literal["audited", "verified", "self_reported"]
    canonical_uri: str = Field(pattern=r"^https://diligence\.example/")
    published_on: str = Field(pattern=r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")
    excerpt: str = Field(min_length=20, max_length=400)

    @model_validator(mode="after")
    def citation_source_class_is_coherent(self) -> Self:
        expected_reliability = {
            "audited_financials": "audited",
            "independent_audit": "verified",
            "regulatory_filing": "verified",
            "verified_customer_schedule": "verified",
            "management_claim": "self_reported",
        }[self.source_type]
        if self.reliability != expected_reliability:
            raise ValueError(f"{self.source_type} requires reliability={expected_reliability!r}")
        return self


class DiligenceClaimV1(StrictDiligenceContract):
    claim_id: str = Field(pattern=r"^CLM-[0-9]{3}$")
    topic: Topic
    statement: str = Field(min_length=20, max_length=400)
    citation_ids: list[str] = Field(min_length=1, max_length=4)

    @field_validator("citation_ids")
    @classmethod
    def citations_are_unique(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("citation_ids must be unique")
        return value


class TopicCoverageV1(StrictDiligenceContract):
    topic: Topic
    status: CoverageStatus
    source_ids: list[str] = Field(max_length=4)
    reason_code: CoverageReasonCode
    explanation: str = Field(min_length=12, max_length=240)

    @model_validator(mode="after")
    def status_matches_attached_sources(self) -> Self:
        if len(self.source_ids) != len(set(self.source_ids)):
            raise ValueError("coverage source_ids must be unique")
        if self.status == "missing" and self.source_ids:
            raise ValueError("missing coverage cannot declare source IDs")
        if self.status != "missing" and not self.source_ids:
            raise ValueError(f"{self.status} coverage requires at least one source ID")
        expected_code, expected_text = COVERAGE_PRESENTATION[self.status]
        if self.reason_code != expected_code or self.explanation != expected_text:
            raise ValueError(
                "coverage reason_code and explanation must be the canonical rendering "
                "derived from status"
            )
        return self


def _validate_evidence_graph(
    claims: list[DiligenceClaimV1],
    citations: list[EvidenceCitationV1],
    source_ids: set[str] | None = None,
) -> None:
    claim_ids = [claim.claim_id for claim in claims]
    citation_ids = [citation.citation_id for citation in citations]
    if len(claim_ids) != len(set(claim_ids)):
        raise ValueError("claim IDs must be unique")
    if len(citation_ids) != len(set(citation_ids)):
        raise ValueError("citation IDs must be unique")
    citation_by_id = {citation.citation_id: citation for citation in citations}
    referenced: set[str] = set()
    for claim in claims:
        for citation_id in claim.citation_ids:
            citation = citation_by_id.get(citation_id)
            if citation is None:
                raise ValueError(f"claim references unknown citation {citation_id}")
            if citation.claim_id != claim.claim_id or citation.topic != claim.topic:
                raise ValueError("citation claim/topic does not match its attached claim")
            if source_ids is not None and citation.source_id not in source_ids:
                raise ValueError("citation references a source outside the frozen snapshot")
            referenced.add(citation_id)
    if referenced != set(citation_ids):
        raise ValueError("every citation must be attached to exactly one declared claim")


def _request_fingerprint(request: DiligenceRequestV1) -> str:
    return stable_hash(request.model_dump(mode="json"))


def _unique_source_ids(citations: list[EvidenceCitationV1]) -> list[str]:
    return list(dict.fromkeys(citation.source_id for citation in citations))


def _derived_coverage(
    required_topics: list[Topic],
    citations: list[EvidenceCitationV1],
    minimum_freshness_date: str,
) -> list[tuple[Topic, CoverageStatus, list[str]]]:
    freshness = _parse_date(minimum_freshness_date, "minimum_freshness_date")
    rows: list[tuple[Topic, CoverageStatus, list[str]]] = []
    for topic in required_topics:
        topic_citations = [item for item in citations if item.topic == topic]
        source_ids = _unique_source_ids(topic_citations)
        if not topic_citations:
            status: CoverageStatus = "missing"
        elif any(
            _parse_date(item.published_on, "published_on") < freshness for item in topic_citations
        ):
            status = "stale"
        elif any(item.reliability == "self_reported" for item in topic_citations):
            status = "unverified"
        else:
            status = "covered"
        rows.append((topic, status, source_ids))
    return rows


def _validate_derived_coverage(
    required_topics: list[Topic],
    citations: list[EvidenceCitationV1],
    minimum_freshness_date: str,
    coverage: list[TopicCoverageV1],
) -> None:
    if [item.topic for item in coverage] != required_topics:
        raise ValueError(
            "coverage must contain exactly one row per required topic in request order"
        )
    expected = _derived_coverage(
        required_topics,
        citations,
        minimum_freshness_date,
    )
    observed = [(item.topic, item.status, item.source_ids) for item in coverage]
    if observed != expected:
        raise ValueError("coverage status and source_ids must be derived from cited frozen sources")


class DiligencePacketV1(StrictDiligenceContract):
    case_id: str = Field(pattern=r"^DDE-[0-9]{4}$")
    request_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    variant: Literal["baseline", "hardened"]
    company: str = Field(min_length=3, max_length=120)
    decision_kind: Literal["investment", "acquisition", "vendor_approval"]
    as_of_date: str = Field(pattern=r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")
    minimum_freshness_date: str = Field(pattern=r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")
    required_topics: list[Topic] = Field(min_length=1, max_length=4)
    claims: list[DiligenceClaimV1] = Field(max_length=8)
    citations: list[EvidenceCitationV1] = Field(max_length=16)
    source_snapshot_ids: list[str] = Field(max_length=16)
    coverage: list[TopicCoverageV1] = Field(min_length=1, max_length=4)
    unresolved_topics: list[Topic] = Field(max_length=4)
    uncertainty: Literal["low", "moderate", "high"]
    policy_mode: Literal["monitor", "enforce"]

    @model_validator(mode="after")
    def packet_is_a_closed_evidence_graph(self) -> Self:
        if len(self.required_topics) != len(set(self.required_topics)):
            raise ValueError("required_topics must be unique")
        if len(self.source_snapshot_ids) != len(set(self.source_snapshot_ids)):
            raise ValueError("source_snapshot_ids must be unique")
        _validate_evidence_graph(
            self.claims,
            self.citations,
            set(self.source_snapshot_ids),
        )
        expected_snapshot_ids = _unique_source_ids(self.citations)
        if self.source_snapshot_ids != expected_snapshot_ids:
            raise ValueError(
                "source_snapshot_ids must exactly match cited sources in lineage order"
            )
        _validate_derived_coverage(
            self.required_topics,
            self.citations,
            self.minimum_freshness_date,
            self.coverage,
        )
        expected_unresolved = [item.topic for item in self.coverage if item.status != "covered"]
        if self.unresolved_topics != expected_unresolved:
            raise ValueError(
                f"unresolved_topics must exactly match non-covered topics: {expected_unresolved}"
            )
        expected_uncertainty = "high" if expected_unresolved else "moderate"
        if self.uncertainty != expected_uncertainty:
            raise ValueError(f"uncertainty must be {expected_uncertainty!r}")
        expected_policy = "monitor" if self.variant == "baseline" else "enforce"
        if self.policy_mode != expected_policy:
            raise ValueError(f"{self.variant} packets require policy_mode={expected_policy!r}")
        return self


class EscalationActionV1(StrictDiligenceContract):
    topic: Topic
    requirement: Literal["obtain_fresh_independently_verified_evidence"]


class DiligenceConclusionV1(StrictDiligenceContract):
    case_id: str = Field(pattern=r"^DDE-[0-9]{4}$")
    request_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    variant: Literal["baseline", "hardened"]
    company: str = Field(min_length=3, max_length=120)
    decision_kind: Literal["investment", "acquisition", "vendor_approval"]
    as_of_date: str = Field(pattern=r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")
    minimum_freshness_date: str = Field(pattern=r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")
    required_topics: list[Topic] = Field(min_length=1, max_length=4)
    source_snapshot_ids: list[str] = Field(max_length=16)
    decision: Literal["proceed", "abstain", "escalate"]
    recommendation: Literal["invest", "defer", "decline"]
    confidence: float = Field(ge=0.0, le=1.0)
    policy_mode: Literal["monitor", "enforce"]
    summary_code: SummaryCode
    summary: str = Field(min_length=30, max_length=600)
    claims: list[DiligenceClaimV1] = Field(max_length=8)
    evidence_manifest: list[EvidenceCitationV1] = Field(max_length=16)
    coverage: list[TopicCoverageV1] = Field(min_length=1, max_length=4)
    unresolved_topics: list[Topic] = Field(max_length=4)
    uncertainty: Literal["low", "moderate", "high"]
    source_lineage_complete: bool
    freshness_gate_passed: bool
    coverage_gate_passed: bool
    escalation_actions: list[EscalationActionV1] = Field(max_length=4)

    @model_validator(mode="after")
    def decision_obeys_declared_evidence_gates(self) -> Self:
        if len(self.required_topics) != len(set(self.required_topics)):
            raise ValueError("required_topics must be unique")
        if len(self.source_snapshot_ids) != len(set(self.source_snapshot_ids)):
            raise ValueError("source_snapshot_ids must be unique")
        _validate_evidence_graph(
            self.claims,
            self.evidence_manifest,
            set(self.source_snapshot_ids),
        )
        expected_snapshot_ids = _unique_source_ids(self.evidence_manifest)
        if self.source_snapshot_ids != expected_snapshot_ids:
            raise ValueError(
                "source_snapshot_ids must exactly match cited sources in lineage order"
            )
        _validate_derived_coverage(
            self.required_topics,
            self.evidence_manifest,
            self.minimum_freshness_date,
            self.coverage,
        )
        expected_unresolved = [item.topic for item in self.coverage if item.status != "covered"]
        if self.unresolved_topics != expected_unresolved:
            raise ValueError("unresolved_topics must match the coverage ledger")
        expected_uncertainty = "high" if expected_unresolved else "moderate"
        if self.uncertainty != expected_uncertainty:
            raise ValueError(f"uncertainty must be {expected_uncertainty!r}")
        expected_coverage = not expected_unresolved
        expected_freshness = all(item.status != "stale" for item in self.coverage)
        if self.coverage_gate_passed != expected_coverage:
            raise ValueError("coverage_gate_passed must be derived from coverage")
        if self.freshness_gate_passed != expected_freshness:
            raise ValueError("freshness_gate_passed must be derived from coverage")
        if not self.source_lineage_complete:
            raise ValueError("the structurally closed evidence graph requires true lineage")

        expected_policy = "monitor" if self.variant == "baseline" else "enforce"
        if self.policy_mode != expected_policy:
            raise ValueError(f"{self.variant} conclusions require policy_mode={expected_policy!r}")
        expected_recommendation = {
            "proceed": "invest",
            "abstain": "decline",
            "escalate": "defer",
        }[self.decision]
        if self.recommendation != expected_recommendation:
            raise ValueError(
                f"decision={self.decision!r} requires recommendation={expected_recommendation!r}"
            )
        if self.variant == "baseline" and self.unresolved_topics:
            expected_summary_code: SummaryCode = "monitor_proceed_with_unresolved_evidence"
        elif self.variant == "baseline":
            expected_summary_code = "monitor_proceed_without_enforced_truth_gate"
        elif self.decision == "proceed":
            expected_summary_code = "enforced_proceed_after_declared_gates"
        else:
            expected_summary_code = "enforced_escalation_for_unresolved_evidence"
        if (
            self.summary_code != expected_summary_code
            or self.summary != SUMMARY_PRESENTATION[expected_summary_code]
        ):
            raise ValueError(
                "summary_code and summary must be the canonical rendering derived from "
                "variant, decision, and coverage"
            )
        action_topics = [action.topic for action in self.escalation_actions]
        if self.decision == "proceed" and action_topics:
            raise ValueError("proceed decisions cannot retain escalation actions")
        if self.decision != "proceed" and action_topics != self.unresolved_topics:
            raise ValueError(
                "escalation actions must exactly cover unresolved topics in ledger order"
            )

        if self.policy_mode == "enforce" and self.decision == "proceed":
            if not self.coverage_gate_passed or not self.freshness_gate_passed:
                raise ValueError("enforced proceed decisions require coverage and freshness")
            if self.unresolved_topics or self.uncertainty == "high":
                raise ValueError("enforced proceed decisions cannot retain high uncertainty")
            if self.confidence > 0.85:
                raise ValueError("enforced confidence is capped at 0.85")
        if self.policy_mode == "enforce" and self.decision != "proceed":
            if not self.escalation_actions:
                raise ValueError("abstain/escalate outcomes require actionable next steps")
            if self.confidence > 0.5:
                raise ValueError("abstain/escalate confidence cannot exceed 0.5")
        return self


FIXTURE_INPUT: dict[str, Any] = {
    "case_id": "DDE-2048",
    "company": "Northstar Systems",
    "decision_kind": "investment",
    "as_of_date": "2026-07-20",
    "minimum_freshness_date": "2026-01-01",
    "required_topics": [
        "financial_performance",
        "security_posture",
        "regulatory_compliance",
        "customer_concentration",
    ],
    "sources": [
        {
            "source_id": "SRC-101",
            "topic": "financial_performance",
            "source_type": "audited_financials",
            "reliability": "audited",
            "title": "FY2026 audited recurring revenue schedule",
            "canonical_uri": "https://diligence.example/audited-arr-2026",
            "published_on": "2026-07-10",
            "retrieved_on": "2026-07-18",
            "evidence_statement": ("Audited FY2026 ARR was $24.0 million, up 18% year over year."),
        },
        {
            "source_id": "SRC-202",
            "topic": "security_posture",
            "source_type": "independent_audit",
            "reliability": "verified",
            "title": "Independent application security assessment",
            "canonical_uri": "https://diligence.example/security-audit-2026",
            "published_on": "2026-05-15",
            "retrieved_on": "2026-07-18",
            "evidence_statement": (
                "The independent assessment found no open critical vulnerabilities."
            ),
        },
        {
            "source_id": "SRC-303",
            "topic": "regulatory_compliance",
            "source_type": "regulatory_filing",
            "reliability": "verified",
            "title": "Current regulatory compliance filing",
            "canonical_uri": "https://diligence.example/compliance-filing-2026",
            "published_on": "2026-06-20",
            "retrieved_on": "2026-07-18",
            "evidence_statement": (
                "The current filing reports no unresolved regulatory enforcement actions."
            ),
        },
        {
            "source_id": "SRC-404",
            "topic": "customer_concentration",
            "source_type": "verified_customer_schedule",
            "reliability": "verified",
            "title": "Verified customer concentration schedule",
            "canonical_uri": "https://diligence.example/customer-schedule-2026",
            "published_on": "2026-07-01",
            "retrieved_on": "2026-07-18",
            "evidence_statement": (
                "The verified schedule shows the largest customer represents 14% of ARR."
            ),
        },
        {
            "source_id": "SRC-909",
            "topic": "financial_performance",
            "source_type": "management_claim",
            "reliability": "self_reported",
            "title": "Archived management growth projection",
            "canonical_uri": "https://diligence.example/management-projection-2024",
            "published_on": "2024-11-15",
            "retrieved_on": "2026-07-18",
            "evidence_statement": (
                "Management projected ARR growth of 42% for the following fiscal year."
            ),
        },
    ],
}

DEFAULT_PRESET = "clean"
KNOWN_PRESETS = {
    "clean",
    "contract_drift",
    "semantic_evidence_trap",
    "citation_lineage_trap",
    "stale_evidence",
    "insufficient_evidence",
}


def _selected_preset(fixture_preset: str | None) -> str:
    selected = fixture_preset or DEFAULT_PRESET
    if selected not in KNOWN_PRESETS:
        raise ValueError(f"Unknown Due Diligence Engine fixture preset: {selected}")
    return selected


def _source_map(request: DiligenceRequestV1) -> dict[str, EvidenceSourceV1]:
    return {source.source_id: source for source in request.sources}


def _current_source_by_topic(request: DiligenceRequestV1) -> dict[Topic, EvidenceSourceV1]:
    freshness = _parse_date(request.minimum_freshness_date, "minimum_freshness_date")
    selected: dict[Topic, EvidenceSourceV1] = {}
    for source in request.sources:
        if (
            source.topic in request.required_topics
            and source.reliability != "self_reported"
            and _parse_date(source.published_on, "published_on") >= freshness
            and source.topic not in selected
        ):
            selected[source.topic] = source
    return selected


def build_handoff(
    variant: str,
    input_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    preset = _selected_preset(fixture_preset)
    request = DiligenceRequestV1.model_validate(input_data)
    if variant not in {"baseline", "hardened"}:
        raise ValueError(f"Unknown Due Diligence Engine variant: {variant}")

    current = _current_source_by_topic(request)
    selected: dict[Topic, EvidenceSourceV1] = dict(current)
    if preset == "stale_evidence" and variant == "baseline":
        selected["financial_performance"] = _source_map(request)["SRC-909"]
    if preset == "insufficient_evidence" or (preset == "clean" and variant == "baseline"):
        selected.pop("customer_concentration", None)

    claims: list[dict[str, Any]] = []
    citations: list[dict[str, Any]] = []
    coverage: list[dict[str, Any]] = []
    source_snapshot_ids: list[str] = []
    for index, topic in enumerate(request.required_topics, start=1):
        source = selected.get(topic)
        if source is None:
            reason_code, explanation = COVERAGE_PRESENTATION["missing"]
            coverage.append(
                {
                    "topic": topic,
                    "status": "missing",
                    "source_ids": [],
                    "reason_code": reason_code,
                    "explanation": explanation,
                }
            )
            continue

        claim_id = f"CLM-{index:03d}"
        citation_id = f"CIT-{index:03d}"
        statement = source.evidence_statement
        if (
            preset == "semantic_evidence_trap"
            and variant == "baseline"
            and topic == "financial_performance"
        ):
            statement = "Audited FY2026 ARR was $31.0 million, up 42% year over year."
        canonical_uri = source.canonical_uri
        if (
            preset == "citation_lineage_trap"
            and variant == "baseline"
            and topic == "financial_performance"
        ):
            canonical_uri = "https://diligence.example/unrelated-investor-slide"

        claims.append(
            {
                "claim_id": claim_id,
                "topic": topic,
                "statement": statement,
                "citation_ids": [citation_id],
            }
        )
        citations.append(
            {
                "citation_id": citation_id,
                "claim_id": claim_id,
                "source_id": source.source_id,
                "topic": topic,
                "source_type": source.source_type,
                "reliability": source.reliability,
                "canonical_uri": canonical_uri,
                "published_on": source.published_on,
                "excerpt": source.evidence_statement,
            }
        )
        source_snapshot_ids.append(source.source_id)
        if _parse_date(source.published_on, "published_on") < _parse_date(
            request.minimum_freshness_date,
            "minimum_freshness_date",
        ):
            status: CoverageStatus = "stale"
        elif source.reliability == "self_reported":
            status = "unverified"
        else:
            status = "covered"
        reason_code, explanation = COVERAGE_PRESENTATION[status]
        coverage.append(
            {
                "topic": topic,
                "status": status,
                "source_ids": [source.source_id],
                "reason_code": reason_code,
                "explanation": explanation,
            }
        )

    unresolved: list[Topic] = [item["topic"] for item in coverage if item["status"] != "covered"]
    packet = DiligencePacketV1(
        case_id=request.case_id,
        request_fingerprint=_request_fingerprint(request),
        variant=variant,
        company=request.company,
        decision_kind=request.decision_kind,
        as_of_date=request.as_of_date,
        minimum_freshness_date=request.minimum_freshness_date,
        required_topics=request.required_topics,
        claims=claims,
        citations=citations,
        source_snapshot_ids=source_snapshot_ids,
        coverage=coverage,
        unresolved_topics=unresolved,
        uncertainty="high" if unresolved else "moderate",
        policy_mode="monitor" if variant == "baseline" else "enforce",
    )
    return packet.model_dump(mode="json")


def build_invalid_handoff(
    variant: str,
    input_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    invalid = build_handoff(variant, input_data, fixture_preset)
    invalid.pop("source_snapshot_ids")
    return invalid


def _packet_matches_request(
    packet: DiligencePacketV1,
    request: DiligenceRequestV1,
    variant: str,
) -> bool:
    expected_policy = "monitor" if variant == "baseline" else "enforce"
    return (
        packet.case_id == request.case_id
        and packet.request_fingerprint == _request_fingerprint(request)
        and packet.variant == variant
        and packet.company == request.company
        and packet.decision_kind == request.decision_kind
        and packet.as_of_date == request.as_of_date
        and packet.minimum_freshness_date == request.minimum_freshness_date
        and packet.required_topics == request.required_topics
        and packet.policy_mode == expected_policy
    )


def build_output(
    variant: str,
    input_data: dict[str, Any],
    handoff_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    _selected_preset(fixture_preset)
    request = DiligenceRequestV1.model_validate(input_data)
    packet = DiligencePacketV1.model_validate(handoff_data)
    if variant not in {"baseline", "hardened"}:
        raise ValueError(f"Unknown Due Diligence Engine variant: {variant}")
    if not _packet_matches_request(packet, request, variant):
        raise ValueError(
            "Diligence packet identity does not match the canonical request and variant"
        )
    if variant == "baseline":
        decision: Literal["proceed", "abstain", "escalate"] = "proceed"
        recommendation: Literal["invest", "defer", "decline"] = "invest"
        confidence = 0.98
        summary_code: SummaryCode = (
            "monitor_proceed_with_unresolved_evidence"
            if packet.unresolved_topics
            else "monitor_proceed_without_enforced_truth_gate"
        )
        summary = SUMMARY_PRESENTATION[summary_code]
        escalation_actions: list[dict[str, str]] = []
    elif variant == "hardened" and packet.unresolved_topics:
        decision = "escalate"
        recommendation = "defer"
        confidence = 0.35
        summary_code = "enforced_escalation_for_unresolved_evidence"
        summary = SUMMARY_PRESENTATION[summary_code]
        escalation_actions = [
            {
                "topic": topic,
                "requirement": "obtain_fresh_independently_verified_evidence",
            }
            for topic in packet.unresolved_topics
        ]
    elif variant == "hardened":
        decision = "proceed"
        recommendation = "invest"
        confidence = 0.74
        summary_code = "enforced_proceed_after_declared_gates"
        summary = SUMMARY_PRESENTATION[summary_code]
        escalation_actions = []
    conclusion = DiligenceConclusionV1(
        case_id=packet.case_id,
        request_fingerprint=packet.request_fingerprint,
        variant=packet.variant,
        company=packet.company,
        decision_kind=packet.decision_kind,
        as_of_date=packet.as_of_date,
        minimum_freshness_date=packet.minimum_freshness_date,
        required_topics=packet.required_topics,
        source_snapshot_ids=packet.source_snapshot_ids,
        decision=decision,
        recommendation=recommendation,
        confidence=confidence,
        policy_mode=packet.policy_mode,
        summary_code=summary_code,
        summary=summary,
        claims=packet.claims,
        evidence_manifest=packet.citations,
        coverage=packet.coverage,
        unresolved_topics=packet.unresolved_topics,
        uncertainty=packet.uncertainty,
        source_lineage_complete=True,
        freshness_gate_passed=all(item.status != "stale" for item in packet.coverage),
        coverage_gate_passed=not packet.unresolved_topics,
        escalation_actions=escalation_actions,
    )
    return conclusion.model_dump(mode="json")


def _assess_output(
    request: DiligenceRequestV1,
    output: DiligenceConclusionV1,
) -> dict[str, bool]:
    source_by_id = _source_map(request)
    freshness = _parse_date(request.minimum_freshness_date, "minimum_freshness_date")
    citation_integrity = all(
        (source := source_by_id.get(citation.source_id)) is not None
        and citation.topic == source.topic
        and citation.source_type == source.source_type
        and citation.reliability == source.reliability
        and citation.canonical_uri == source.canonical_uri
        and citation.published_on == source.published_on
        and citation.excerpt == source.evidence_statement
        for citation in output.evidence_manifest
    )
    citation_by_id = {citation.citation_id: citation for citation in output.evidence_manifest}
    factuality = all(
        any(
            (citation := citation_by_id.get(citation_id)) is not None
            and (source := source_by_id.get(citation.source_id)) is not None
            and claim.statement == source.evidence_statement
            for citation_id in claim.citation_ids
        )
        for claim in output.claims
    )
    freshness_ok = all(
        (source := source_by_id.get(citation.source_id)) is not None
        and _parse_date(source.published_on, "published_on") >= freshness
        and source.reliability != "self_reported"
        for citation in output.evidence_manifest
    )
    covered_topics = {
        claim.topic
        for claim in output.claims
        if any(citation_id in citation_by_id for citation_id in claim.citation_ids)
    }
    coverage_ok = set(request.required_topics).issubset(covered_topics) and all(
        item.status == "covered" for item in output.coverage
    )
    evidence_sufficient = citation_integrity and factuality and freshness_ok and coverage_ok
    safe_non_proceed = (
        output.decision in {"abstain", "escalate"}
        and output.recommendation != "invest"
        and output.confidence <= 0.5
        and bool(output.escalation_actions)
    )
    calibrated = (
        output.decision == "proceed" and output.confidence <= 0.85 and output.uncertainty != "high"
        if evidence_sufficient
        else safe_non_proceed
    )
    return {
        "citation_integrity": citation_integrity,
        "factuality": factuality,
        "freshness_ok": freshness_ok,
        "coverage_ok": coverage_ok,
        "evidence_sufficient": evidence_sufficient,
        "safe_non_proceed": safe_non_proceed,
        "calibrated": calibrated,
    }


def evaluate_output(
    variant: str,
    input_data: dict[str, Any],
    output_data: dict[str, Any],
    fixture_preset: str | None,
) -> list[QualityCheck]:
    del fixture_preset
    request = DiligenceRequestV1.model_validate(input_data)
    try:
        output = DiligenceConclusionV1.model_validate(output_data)
    except ValidationError as exc:
        return [
            QualityCheck(
                check_id="typed_conclusion",
                title="Final conclusion matches DiligenceConclusionV1",
                passed=False,
                guarantee="contract",
                explanation=f"Pydantic rejected the conclusion: {exc.errors()}",
            )
        ]

    observed = _assess_output(request, output)
    identity_matches = (
        output.case_id == request.case_id
        and output.request_fingerprint == _request_fingerprint(request)
        and output.variant == variant
        and output.company == request.company
        and output.decision_kind == request.decision_kind
        and output.as_of_date == request.as_of_date
        and output.minimum_freshness_date == request.minimum_freshness_date
        and output.required_topics == request.required_topics
        and output.policy_mode == ("monitor" if variant == "baseline" else "enforce")
    )
    guarded_freshness = observed["freshness_ok"] or observed["safe_non_proceed"]
    guarded_coverage = observed["coverage_ok"] or observed["safe_non_proceed"]
    task_pass = observed["calibrated"] and identity_matches
    return [
        QualityCheck(
            check_id="typed_conclusion",
            title="Conclusion satisfies the Pydantic decision contract",
            passed=True,
            guarantee="contract",
            explanation=(
                "The outcome, coverage ledger, claim/citation graph, and gate booleans are "
                "structurally consistent. This does not prove the cited evidence is true."
            ),
        ),
        QualityCheck(
            check_id="request_identity",
            title="Conclusion remains bound to the canonical request",
            passed=identity_matches,
            guarantee="contract",
            explanation=(
                "The request fingerprint, variant, company, decision kind, dates, required "
                "topics, and policy mode must match the validated run input exactly."
            ),
        ),
        QualityCheck(
            check_id="citation_integrity",
            title="Citation metadata matches the frozen source catalog",
            passed=observed["citation_integrity"],
            guarantee="citation",
            explanation=(
                "Source IDs, topics, canonical URIs, dates, and excerpts are joined against "
                "the authoritative fixture rather than trusted from model output."
            ),
        ),
        QualityCheck(
            check_id="claim_factuality",
            title="Each conclusion claim matches its cited evidence",
            passed=observed["factuality"],
            guarantee="factuality",
            explanation=(
                "Claim text is compared with source evidence independently of schema-valid "
                "citation IDs and the model's confidence declaration."
            ),
        ),
        QualityCheck(
            check_id="freshness_guard",
            title="Stale evidence cannot escape as a proceed decision",
            passed=guarded_freshness,
            guarantee="policy",
            explanation=(
                "All used evidence meets the freshness/reliability threshold, or the typed "
                "outcome safely defers and requests new evidence."
            ),
        ),
        QualityCheck(
            check_id="coverage_guard",
            title="Every required topic is covered or explicitly escalated",
            passed=guarded_coverage,
            guarantee="policy",
            explanation=(
                "Coverage is computed from actual claim/citation paths; missing topics must "
                "produce a typed non-proceed outcome with next steps."
            ),
        ),
        QualityCheck(
            check_id="uncertainty_calibration",
            title="Confidence and outcome match evidence sufficiency",
            passed=observed["calibrated"],
            guarantee="task_quality",
            explanation=(
                "Sufficient evidence permits bounded confidence; any evidence failure "
                "requires abstention/escalation at confidence 0.5 or lower."
            ),
        ),
        QualityCheck(
            check_id="diligence_task_success",
            title="The investment recommendation is evidence-safe",
            passed=task_pass,
            guarantee="task_quality",
            explanation=(
                "A successful task may be a proceed decision or a useful typed escalation; "
                "it is not synonymous with returning an affirmative answer."
            ),
        ),
    ]


def _extract_output(run: RunRecord) -> DiligenceConclusionV1 | None:
    candidates = [run.outputs.get("result"), run.outputs.get("output"), run.outputs]
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        try:
            return DiligenceConclusionV1.model_validate(candidate)
        except ValidationError:
            continue
    return None


def _checks_for(output: DiligenceConclusionV1) -> dict[str, QualityCheck]:
    checks = evaluate_output(
        output.variant,
        FIXTURE_INPUT,
        output.model_dump(mode="json"),
        None,
    )
    return {check.check_id: check for check in checks}


def _tool_call_payloads(invocation: Any) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for message in invocation.serialized_messages:
        if message.get("kind") != "response":
            continue
        for part in message.get("parts", []):
            if part.get("part_kind") == "tool-call" and isinstance(part.get("args"), dict):
                payloads.append(part["args"])
    return payloads


def _has_exact_missing_error(error: Any, field_name: str) -> bool:
    return (
        isinstance(error, dict)
        and error.get("type") == "missing"
        and list(error.get("loc", [])) == [field_name]
        and error.get("msg") == "Field required"
    )


def _runtime_proof(
    run: RunRecord,
    expected_variant: Literal["baseline", "hardened"],
    expected_preset: str,
) -> dict[str, bool]:
    record_identity = (
        getattr(run, "scenario_id", None) == definition.scenario_id
        and getattr(run, "variant", None) == expected_variant
        and getattr(run, "fixture_preset", None) == expected_preset
        and getattr(run, "run_mode", None) == "fixture"
        and getattr(run, "terminal_status", None) == "succeeded"
        and getattr(run, "failure_reason", None) is None
    )
    try:
        fixture_request = DiligenceRequestV1.model_validate(FIXTURE_INPUT)
        run_request = DiligenceRequestV1.model_validate(getattr(run, "input", {}))
        canonical_input = run_request.model_dump(mode="json") == fixture_request.model_dump(
            mode="json"
        ) and _request_fingerprint(run_request) == _request_fingerprint(fixture_request)
        expected_handoff = build_handoff(
            expected_variant,
            fixture_request.model_dump(mode="json"),
            expected_preset,
        )
        expected_invalid = build_invalid_handoff(
            expected_variant,
            fixture_request.model_dump(mode="json"),
            expected_preset,
        )
        expected_output = build_output(
            expected_variant,
            fixture_request.model_dump(mode="json"),
            expected_handoff,
            expected_preset,
        )
    except (ValidationError, ValueError, KeyError):
        canonical_input = False
        expected_handoff = {}
        expected_invalid = {}
        expected_output = {}

    producer_invocations = [item for item in run.agent_invocations if item.node_id == "producer"]
    producer_events = [
        event
        for event in run.events
        if event.node_id == "producer" and event.kind == "agent_output_retry"
    ]
    producer_evidence = [
        item
        for item in run.pydantic_evidence
        if item.node_id == "producer" and item.layer == "agent_output"
    ]
    producer_proven = False
    if len(producer_invocations) == 1 and len(producer_events) == 1 and len(producer_evidence) == 1:
        invocation = producer_invocations[0]
        retry_parts = [
            part
            for message in invocation.serialized_messages
            if message.get("kind") == "request"
            for part in message.get("parts", [])
            if part.get("part_kind") == "retry-prompt"
        ]
        retry_errors = retry_parts[0].get("content", []) if len(retry_parts) == 1 else []
        evidence = producer_evidence[0]
        event = producer_events[0]
        payloads = _tool_call_payloads(invocation)
        producer_proven = (
            invocation.request_count == 2
            and invocation.model_provider == "fixture"
            and invocation.output_contract.name == DiligencePacketV1.__name__
            and invocation.output_contract.version == "1"
            and payloads == [expected_invalid, expected_handoff]
            and len(retry_errors) == 1
            and _has_exact_missing_error(
                retry_errors[0],
                definition.edge_fault_field,
            )
            and retry_errors[0].get("input") == expected_invalid
            and event.validation_errors == ["Field required"]
            and event.metadata == {"enforcement_layer": "pydantic_ai", "repaired": True}
            and evidence.contract_name == DiligencePacketV1.__name__
            and evidence.status == "repaired"
            and evidence.attempt == 2
            and evidence.input_snapshot == expected_invalid
            and evidence.output_snapshot == expected_handoff
            and len(evidence.validation_errors) == 1
            and _has_exact_missing_error(
                evidence.validation_errors[0],
                definition.edge_fault_field,
            )
        )

    edge_repair_expected = expected_preset == "contract_drift"
    edge_evidence = [
        item
        for item in run.pydantic_evidence
        if item.node_id == "edge_validator" and item.layer == "edge_contract"
    ]
    rejected_events = [event for event in run.events if event.kind == "edge_contract_rejected"]
    fault_events = [
        event
        for event in run.events
        if event.node_id == "edge_validator" and event.kind == "fault_injected"
    ]
    handoff_events = [
        event
        for event in run.events
        if event.node_id == "edge_validator" and event.kind == "handoff_validation"
    ]
    edge_proven = False
    if len(edge_evidence) == 1 and len(handoff_events) == 1:
        evidence = edge_evidence[0]
        expected_candidate = dict(expected_handoff)
        if edge_repair_expected:
            expected_candidate.pop(definition.edge_fault_field, None)
        envelope = evidence.output_snapshot or {}
        common_edge = (
            evidence.contract_name == DiligencePacketV1.__name__
            and evidence.input_snapshot == expected_candidate
            and envelope.get("payload") == expected_handoff
            and handoff_events[0].metadata.get("valid") is True
            and handoff_events[0].metadata.get("repaired") is edge_repair_expected
            and handoff_events[0].metadata.get("contract") == DiligencePacketV1.__name__
        )
        if edge_repair_expected:
            edge_proven = (
                common_edge
                and evidence.status == "repaired"
                and len(evidence.validation_errors) == 1
                and _has_exact_missing_error(
                    evidence.validation_errors[0],
                    definition.edge_fault_field,
                )
                and len(rejected_events) == 1
                and rejected_events[0].node_id == "edge_validator"
                and rejected_events[0].validation_errors == ["Field required"]
                and rejected_events[0].metadata
                == {
                    "enforcement_layer": "pydantic_type_adapter",
                    "bounded_revision": True,
                }
                and len(fault_events) == 1
                and fault_events[0].metadata
                == {
                    "hook": "post_output_pre_edge",
                    "mutation": f"drop {definition.edge_fault_field}",
                }
            )
        else:
            edge_proven = (
                common_edge
                and evidence.status == "passed"
                and evidence.validation_errors == []
                and rejected_events == []
                and fault_events == []
            )

    consumer_invocations = [item for item in run.agent_invocations if item.node_id == "consumer"]
    consumer_evidence = [
        item
        for item in run.pydantic_evidence
        if item.node_id == "consumer" and item.layer == "agent_output"
    ]
    consumer_proven = False
    if len(consumer_invocations) == 1 and len(consumer_evidence) == 1:
        invocation = consumer_invocations[0]
        evidence = consumer_evidence[0]
        consumer_proven = (
            invocation.request_count == 1
            and invocation.model_provider == "fixture"
            and invocation.output_contract.name == DiligenceConclusionV1.__name__
            and invocation.output_contract.version == "1"
            and _tool_call_payloads(invocation) == [expected_output]
            and run.outputs.get("result") == expected_output
            and evidence.contract_name == DiligenceConclusionV1.__name__
            and evidence.status == "passed"
            and evidence.output_snapshot == expected_output
        )

    expected_checks = evaluate_output(
        expected_variant,
        fixture_request.model_dump(mode="json") if canonical_input else FIXTURE_INPUT,
        expected_output,
        expected_preset,
    )
    expected_serialized_checks = [
        {
            "check_id": check.check_id,
            "title": check.title,
            "passed": check.passed,
            "guarantee": check.guarantee,
            "explanation": check.explanation,
        }
        for check in expected_checks
    ]
    quality_evidence = [
        item
        for item in run.pydantic_evidence
        if item.node_id == "quality" and item.layer == "task_quality"
    ]
    quality_events = [
        event
        for event in run.events
        if event.node_id == "quality" and event.kind == "node_finished"
    ]
    quality_proven = (
        run.outputs.get("quality_checks") == expected_serialized_checks
        and len(quality_evidence) == len(expected_checks)
        and all(
            evidence.title == check.title
            and evidence.status == ("passed" if check.passed else "failed")
            and evidence.guarantee == check.guarantee
            and evidence.explanation == check.explanation
            and evidence.output_snapshot == expected_output
            for evidence, check in zip(quality_evidence, expected_checks, strict=True)
        )
        and len(quality_events) == 1
        and quality_events[0].metadata == {"passed": all(check.passed for check in expected_checks)}
        and run.metrics is not None
        and run.metrics.task_pass == all(check.passed for check in expected_checks)
        and run.metrics.final_contract_pass is True
        and run.metrics.first_attempt_contract_pass is False
        and run.metrics.request_count == 3
    )
    input_evidence = [
        item
        for item in run.pydantic_evidence
        if item.node_id == "input" and item.layer == "input_contract"
    ]
    evidence_inventory = (
        len(input_evidence) == 1
        and input_evidence[0].contract_name == DiligenceRequestV1.__name__
        and input_evidence[0].status == "passed"
        and input_evidence[0].output_snapshot == run.input
        and len(run.pydantic_evidence) == 4 + len(expected_checks)
        and bool(run.semantic_trace_hash)
    )
    return {
        "run_identity_and_fixture_are_exact": record_identity and canonical_input,
        "producer_retry_transcript_is_real": producer_proven,
        "edge_type_adapter_evidence_matches": edge_proven,
        "consumer_transcript_matches_output": consumer_proven,
        "quality_checks_match_pydantic_evidence": quality_proven,
        "contract_evidence_inventory_is_complete": evidence_inventory,
    }


def _eval_contract_drift_repair(run: RunRecord) -> dict[str, bool]:
    return {
        **_runtime_proof(run, "hardened", "contract_drift"),
        "edge_rejected_contract_drift": any(
            event.kind == "edge_contract_rejected" for event in run.events
        ),
        "typed_conclusion_returned": _extract_output(run) is not None,
        "final_contract_passed": bool(run.metrics and run.metrics.final_contract_pass),
    }


def _eval_baseline_gap(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    return {
        **_runtime_proof(run, "baseline", "clean"),
        "schema_valid_conclusion_returned": output is not None,
        "missing_topic_is_visible": bool(
            output and "customer_concentration" in output.unresolved_topics
        ),
        "weak_pipeline_still_proceeds": bool(output and output.decision == "proceed"),
        "unjustified_confidence_is_visible": bool(output and output.confidence > 0.85),
        "independent_task_check_failed": bool(run.metrics and run.metrics.task_pass is False),
    }


def _eval_semantic_trap(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    checks = _checks_for(output) if output else {}
    return {
        **_runtime_proof(run, "baseline", "semantic_evidence_trap"),
        "schema_accepted_the_evidence_graph": output is not None,
        "citation_metadata_remains_intact": bool(checks and checks["citation_integrity"].passed),
        "independent_factuality_detected_false_claim": bool(
            checks and not checks["claim_factuality"].passed
        ),
        "task_quality_failed": bool(run.metrics and run.metrics.task_pass is False),
    }


def _eval_citation_trap(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    checks = _checks_for(output) if output else {}
    return {
        **_runtime_proof(run, "baseline", "citation_lineage_trap"),
        "schema_accepted_the_citation": output is not None,
        "claim_text_matches_source_truth": bool(checks and checks["claim_factuality"].passed),
        "catalog_join_detected_uri_drift": bool(checks and not checks["citation_integrity"].passed),
        "task_quality_failed": bool(run.metrics and run.metrics.task_pass is False),
    }


def _eval_hardened_clean(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    checks = _checks_for(output) if output else {}
    return {
        **_runtime_proof(run, "hardened", "clean"),
        "typed_proceed_decision_returned": bool(output and output.decision == "proceed"),
        "lineage_and_evidence_checks_pass": bool(
            checks and all(check.passed for check in checks.values())
        ),
        "confidence_is_bounded": bool(output and output.confidence <= 0.85),
        "task_quality_passed": bool(run.metrics and run.metrics.task_pass),
    }


def _eval_hardened_escalation(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    checks = _checks_for(output) if output else {}
    return {
        **_runtime_proof(run, "hardened", "insufficient_evidence"),
        "typed_escalation_returned": bool(output and output.decision == "escalate"),
        "missing_topic_named": bool(
            output and "customer_concentration" in output.unresolved_topics
        ),
        "confidence_is_reduced": bool(output and output.confidence <= 0.5),
        "next_step_is_actionable": bool(output and output.escalation_actions),
        "safe_task_outcome_passed": bool(checks and checks["diligence_task_success"].passed),
    }


def _eval_stale_evidence(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    checks = _checks_for(output) if output else {}
    return {
        **_runtime_proof(run, "baseline", "stale_evidence"),
        "schema_valid_stale_claim_returned": output is not None,
        "stale_financial_topic_is_declared": bool(
            output
            and any(
                item.topic == "financial_performance" and item.status == "stale"
                for item in output.coverage
            )
        ),
        "freshness_guard_detected_escape": bool(checks and not checks["freshness_guard"].passed),
        "task_quality_failed": bool(run.metrics and run.metrics.task_pass is False),
    }


definition = ScenarioDefinition(
    scenario_id="due-diligence-engine",
    title="The Due Diligence Engine",
    summary=(
        "Stress-test evidence-backed investment decisions with strict lineage contracts, "
        "freshness and coverage gates, calibrated uncertainty, and typed escalation."
    ),
    input_model=DiligenceRequestV1,
    handoff_model=DiligencePacketV1,
    output_model=DiligenceConclusionV1,
    fixture_input=FIXTURE_INPUT,
    producer_name="Evidence Synthesis Analyst",
    consumer_name="Diligence Decision Gate",
    build_handoff=build_handoff,
    build_invalid_handoff=build_invalid_handoff,
    build_output=build_output,
    evaluate_output=evaluate_output,
    edge_fault_field="source_snapshot_ids",
    fixture_presets={
        "clean": (
            "The baseline proceeds with a missing customer-concentration topic; the "
            "hardened run uses complete current evidence and bounded confidence."
        ),
        "contract_drift": (
            "Drop the frozen source snapshot after agent output so the edge TypeAdapter "
            "must reject and repair the handoff."
        ),
        "semantic_evidence_trap": (
            "Keep valid citation metadata but inflate the financial claim; schema checks "
            "pass while fixture-grounded factuality fails."
        ),
        "citation_lineage_trap": (
            "Keep a true claim and structurally valid citation ID but drift its canonical "
            "URI; the source-catalog join catches it."
        ),
        "stale_evidence": (
            "Use a 2024 self-reported projection for a 2026 decision and proceed anyway."
        ),
        "insufficient_evidence": (
            "Remove a required evidence topic; the hardened workflow returns a typed, "
            "actionable escalation instead of manufacturing certainty."
        ),
    },
    pydantic_lessons=(
        "Strict request models reject coercion, extra fields, duplicate source IDs, future "
        "evidence, and source catalogs that cannot address a required diligence topic.",
        "Model validators close the claim-to-citation-to-frozen-source graph and require an "
        "honest one-row-per-topic coverage ledger at every agent boundary.",
        "Pydantic AI output validation and ModelRetry repair malformed agent payloads; an "
        "edge TypeAdapter separately catches corruption after the producer returns.",
        "The enforced conclusion contract makes proceed, abstain, and escalate real typed "
        "outcomes, with confidence caps and actionable next steps for insufficient evidence.",
        "Pydantic proves declared structure, not external truth: schema-valid claim text, "
        "URLs, dates, and confidence still require independent catalog and factuality evals.",
        "Freshness, coverage, citation integrity, factuality, and task success remain separate "
        "guarantees so the UI can show exactly what passed and what did not.",
        "Human-facing coverage and conclusion text is a canonical rendering of typed reason "
        "codes, so model-authored prose cannot contradict the evidence ledger or add facts.",
    ),
    eval_cases=(
        ScenarioEvalCase(
            name="due_diligence_contract_drift_repair",
            version="1.0",
            description=("A missing source snapshot is rejected at the graph edge and repaired."),
            variant="hardened",
            fixture_preset="contract_drift",
            evaluate=_eval_contract_drift_repair,
        ),
        ScenarioEvalCase(
            name="due_diligence_baseline_evidence_gap",
            version="1.0",
            description=(
                "A typed monitor-mode conclusion proceeds with missing evidence and 0.98 "
                "confidence; independent task evaluation fails."
            ),
            variant="baseline",
            fixture_preset="clean",
            evaluate=_eval_baseline_gap,
        ),
        ScenarioEvalCase(
            name="due_diligence_semantic_evidence_trap",
            version="1.0",
            description=("Citation metadata is valid while the attached financial claim is false."),
            variant="baseline",
            fixture_preset="semantic_evidence_trap",
            evaluate=_eval_semantic_trap,
        ),
        ScenarioEvalCase(
            name="due_diligence_citation_lineage_trap",
            version="1.0",
            description=(
                "A true claim carries a schema-valid but catalog-inconsistent citation URI."
            ),
            variant="baseline",
            fixture_preset="citation_lineage_trap",
            evaluate=_eval_citation_trap,
        ),
        ScenarioEvalCase(
            name="due_diligence_hardened_clean",
            version="1.0",
            description=(
                "The hardened path proceeds only with complete, fresh, grounded evidence."
            ),
            variant="hardened",
            fixture_preset="clean",
            evaluate=_eval_hardened_clean,
        ),
        ScenarioEvalCase(
            name="due_diligence_hardened_escalation",
            version="1.0",
            description=(
                "Insufficient evidence returns a typed escalation with calibrated confidence."
            ),
            variant="hardened",
            fixture_preset="insufficient_evidence",
            evaluate=_eval_hardened_escalation,
        ),
        ScenarioEvalCase(
            name="due_diligence_stale_evidence_escape",
            version="1.0",
            description=(
                "A stale self-reported claim remains schema-valid but fails freshness policy."
            ),
            variant="baseline",
            fixture_preset="stale_evidence",
            evaluate=_eval_stale_evidence,
        ),
    ),
)


__all__ = [
    "DiligenceConclusionV1",
    "DiligencePacketV1",
    "DiligenceRequestV1",
    "EscalationActionV1",
    "EvidenceCitationV1",
    "EvidenceSourceV1",
    "FIXTURE_INPUT",
    "TopicCoverageV1",
    "definition",
]
