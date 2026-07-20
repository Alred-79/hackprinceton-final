from __future__ import annotations

from typing import Annotated, Any, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    model_validator,
)

from ..models import RunRecord, stable_hash
from .base import QualityCheck, ScenarioDefinition, ScenarioEvalCase


class StrictContentContract(BaseModel):
    """Content-pipeline contracts reject coercion and undeclared fields."""

    model_config = ConfigDict(extra="forbid", strict=True)


class RequestedClaimV1(StrictContentContract):
    claim_id: str = Field(pattern=r"^CLM-[0-9]{3}$")
    brief: str = Field(min_length=12, max_length=240)


class SourceRecordV1(StrictContentContract):
    source_id: str = Field(pattern=r"^SRC-[0-9]{3}$")
    title: str = Field(min_length=5, max_length=160)
    canonical_url: str = Field(pattern=r"^https://sources\.example/")
    published_on: str = Field(pattern=r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")
    verified_statement: str = Field(min_length=16, max_length=300)
    supports_claim_ids: list[str] = Field(max_length=8)

    @model_validator(mode="after")
    def support_ids_are_unique(self) -> Self:
        if len(self.supports_claim_ids) != len(set(self.supports_claim_ids)):
            raise ValueError("supports_claim_ids must be unique")
        return self


class ContentBriefV1(StrictContentContract):
    job_id: str = Field(pattern=r"^CONTENT-[0-9]{4}$")
    topic: str = Field(min_length=8, max_length=160)
    audience: Literal["customers", "executives", "developers"]
    channel: Literal["blog", "newsletter", "press_release"]
    requested_claims: list[RequestedClaimV1] = Field(min_length=1, max_length=8)
    sources: list[SourceRecordV1] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def source_catalog_covers_requested_claims(self) -> Self:
        claim_ids = [claim.claim_id for claim in self.requested_claims]
        source_ids = [source.source_id for source in self.sources]
        if len(claim_ids) != len(set(claim_ids)):
            raise ValueError("requested claim IDs must be unique")
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("source IDs must be unique")
        declared_support = {
            claim_id
            for source in self.sources
            for claim_id in source.supports_claim_ids
        }
        unknown = declared_support - set(claim_ids)
        if unknown:
            raise ValueError(f"source catalog references unknown claim IDs: {sorted(unknown)}")
        return self


class CitationEvidenceV1(StrictContentContract):
    citation_id: str = Field(pattern=r"^CIT-[0-9]{3}$")
    claim_id: str = Field(pattern=r"^CLM-[0-9]{3}$")
    source_id: str = Field(pattern=r"^SRC-[0-9]{3}$")
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    excerpt: str = Field(min_length=12, max_length=300)
    locator: str = Field(min_length=3, max_length=80)


class DraftClaimV1(StrictContentContract):
    claim_id: str = Field(pattern=r"^CLM-[0-9]{3}$")
    statement: str = Field(min_length=16, max_length=300)
    disposition: Literal["supported", "unsupported"]
    citation_ids: list[str] = Field(max_length=6)

    @model_validator(mode="after")
    def disposition_controls_citations(self) -> Self:
        if self.disposition == "supported" and not self.citation_ids:
            raise ValueError("supported claims require at least one citation")
        if self.disposition == "unsupported" and self.citation_ids:
            raise ValueError("unsupported claims must not carry misleading citations")
        if len(self.citation_ids) != len(set(self.citation_ids)):
            raise ValueError("citation_ids must be unique")
        return self


class ContentDraftHandoffV1(StrictContentContract):
    job_id: str = Field(pattern=r"^CONTENT-[0-9]{4}$")
    headline: str = Field(min_length=12, max_length=180)
    claims: list[DraftClaimV1] = Field(min_length=1, max_length=8)
    citations: list[CitationEvidenceV1] = Field(max_length=16)
    source_snapshot_ids: list[str] = Field(min_length=1, max_length=12)
    source_catalog_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    detected_issues: list[
        Literal["citation_source_mismatch", "unsupported_claim"]
    ] = Field(max_length=8)
    lineage_complete: bool

    @model_validator(mode="after")
    def citations_form_a_closed_claim_graph(self) -> Self:
        claim_ids = [claim.claim_id for claim in self.claims]
        citation_ids = [citation.citation_id for citation in self.citations]
        source_ids = self.source_snapshot_ids
        if len(claim_ids) != len(set(claim_ids)):
            raise ValueError("draft claim IDs must be unique")
        if len(citation_ids) != len(set(citation_ids)):
            raise ValueError("citation IDs must be unique")
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("source_snapshot_ids must be unique")
        if len(self.detected_issues) != len(set(self.detected_issues)):
            raise ValueError("detected_issues must be unique")

        citations_by_id = {citation.citation_id: citation for citation in self.citations}
        for citation in self.citations:
            if citation.claim_id not in claim_ids:
                raise ValueError("citation references a claim outside this draft")
            if citation.source_id not in source_ids:
                raise ValueError("citation references a source outside the frozen snapshot")
        for claim in self.claims:
            for citation_id in claim.citation_ids:
                citation = citations_by_id.get(citation_id)
                if citation is None:
                    raise ValueError(f"claim references unknown citation {citation_id}")
                if citation.claim_id != claim.claim_id:
                    raise ValueError("citation claim_id does not match its attached claim")

        expected_complete = all(
            claim.disposition == "unsupported" or bool(claim.citation_ids)
            for claim in self.claims
        )
        if self.lineage_complete != expected_complete:
            raise ValueError(
                "lineage_complete must describe structural citation coverage honestly"
            )
        return self


class PublishedClaimV1(StrictContentContract):
    claim_id: str = Field(pattern=r"^CLM-[0-9]{3}$")
    statement: str = Field(min_length=16, max_length=300)
    citation_ids: list[str] = Field(min_length=1, max_length=6)


class CitationManifestEntryV1(StrictContentContract):
    citation_id: str = Field(pattern=r"^CIT-[0-9]{3}$")
    claim_id: str = Field(pattern=r"^CLM-[0-9]{3}$")
    source_id: str = Field(pattern=r"^SRC-[0-9]{3}$")
    source_title: str = Field(min_length=5, max_length=160)
    canonical_url: str = Field(pattern=r"^https://sources\.example/")
    published_on: str = Field(pattern=r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    excerpt: str = Field(min_length=12, max_length=300)


class UnsupportedClaimReasonV1(StrictContentContract):
    code: Literal["unsupported_claim"]
    claim_id: str = Field(pattern=r"^CLM-[0-9]{3}$")
    detail: Literal[
        "No approved source supports this claim; publication requires source review."
    ]


class WithholdPublicationActionV1(StrictContentContract):
    action: Literal["withhold_publication"]
    claim_id: str = Field(pattern=r"^CLM-[0-9]{3}$")
    next_step: Literal["review_sources"]


class RepairCitationLineageActionV1(StrictContentContract):
    action: Literal["repair_citation_lineage"]
    claim_id: str = Field(pattern=r"^CLM-[0-9]{3}$")
    rejected_source_id: str = Field(pattern=r"^SRC-[0-9]{3}$")
    approved_source_id: str = Field(pattern=r"^SRC-[0-9]{3}$")

    @model_validator(mode="after")
    def replacement_must_change_the_source(self) -> Self:
        if self.rejected_source_id == self.approved_source_id:
            raise ValueError("citation repair must replace the rejected source")
        return self


ContainmentActionV1 = Annotated[
    WithholdPublicationActionV1 | RepairCitationLineageActionV1,
    Field(discriminator="action"),
]


class ContentPublicationV1(StrictContentContract):
    job_id: str = Field(pattern=r"^CONTENT-[0-9]{4}$")
    decision: Literal["publish", "blocked"]
    headline: str = Field(min_length=12, max_length=180)
    body_markdown: str = Field(max_length=2_000)
    claims: list[PublishedClaimV1] = Field(max_length=8)
    citation_manifest: list[CitationManifestEntryV1] = Field(max_length=16)
    source_catalog_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    blocked_claim_ids: list[str] = Field(max_length=8)
    review_reasons: list[UnsupportedClaimReasonV1] = Field(max_length=8)
    containment_actions: list[ContainmentActionV1] = Field(max_length=8)

    @model_validator(mode="after")
    def publication_decision_is_enforced(self) -> Self:
        if self.decision == "publish":
            if not self.claims or not self.citation_manifest:
                raise ValueError("published content requires claims and a citation manifest")
            if self.blocked_claim_ids or self.review_reasons:
                raise ValueError("published content cannot retain blocked-claim state")
            if any(
                isinstance(action, WithholdPublicationActionV1)
                for action in self.containment_actions
            ):
                raise ValueError("published content cannot carry a withhold action")
            if any(
                action.claim_id not in {claim.claim_id for claim in self.claims}
                for action in self.containment_actions
            ):
                raise ValueError("containment actions must reference a published claim")
        else:
            if self.claims or self.citation_manifest or self.body_markdown:
                raise ValueError("blocked content must not expose publishable claims or body")
            if not self.blocked_claim_ids or not self.review_reasons:
                raise ValueError("blocked content requires claim IDs and review reasons")
            if not self.containment_actions:
                raise ValueError("blocked content requires an explicit containment action")
            reason_ids = {reason.claim_id for reason in self.review_reasons}
            action_ids = {
                action.claim_id
                for action in self.containment_actions
                if isinstance(action, WithholdPublicationActionV1)
            }
            if reason_ids != set(self.blocked_claim_ids):
                raise ValueError("review reasons must exactly cover blocked claim IDs")
            if action_ids != set(self.blocked_claim_ids):
                raise ValueError("withhold actions must exactly cover blocked claim IDs")
            if len(reason_ids) != len(self.review_reasons):
                raise ValueError("review reasons must be unique per blocked claim")
            if len(action_ids) != len(self.containment_actions):
                raise ValueError("withhold actions must be unique per blocked claim")
            if any(
                not isinstance(action, WithholdPublicationActionV1)
                for action in self.containment_actions
            ):
                raise ValueError("blocked content may only carry withhold actions")

        claim_ids = [claim.claim_id for claim in self.claims]
        blocked_ids = self.blocked_claim_ids
        if len(claim_ids) != len(set(claim_ids)):
            raise ValueError("published claim IDs must be unique")
        if len(blocked_ids) != len(set(blocked_ids)):
            raise ValueError("blocked_claim_ids must be unique")

        manifest_by_id = {
            citation.citation_id: citation for citation in self.citation_manifest
        }
        if len(manifest_by_id) != len(self.citation_manifest):
            raise ValueError("citation manifest IDs must be unique")
        used_citation_ids: set[str] = set()
        for claim in self.claims:
            if len(claim.citation_ids) != len(set(claim.citation_ids)):
                raise ValueError("published citation IDs must be unique per claim")
            for citation_id in claim.citation_ids:
                used_citation_ids.add(citation_id)
                citation = manifest_by_id.get(citation_id)
                if citation is None:
                    raise ValueError("published claim references a missing citation")
                if citation.claim_id != claim.claim_id:
                    raise ValueError("published citation is attached to the wrong claim")
        if used_citation_ids != set(manifest_by_id):
            raise ValueError("citation manifest contains unused or missing entries")
        expected_body = _render_claims(self.claims)
        if self.decision == "publish" and self.body_markdown != expected_body:
            raise ValueError(
                "body_markdown must exactly render the approved typed claims and citations"
            )
        return self


FIXTURE_INPUT: dict[str, Any] = {
    "job_id": "CONTENT-2048",
    "topic": "Quarterly enterprise retention update",
    "audience": "executives",
    "channel": "blog",
    "requested_claims": [
        {
            "claim_id": "CLM-001",
            "brief": "Report verified Q3 2026 enterprise retention",
        }
    ],
    "sources": [
        {
            "source_id": "SRC-101",
            "title": "Q3 2026 audited customer metrics",
            "canonical_url": "https://sources.example/q3-audited-metrics",
            "published_on": "2026-10-12",
            "verified_statement": "Enterprise retention was 92% in Q3 2026.",
            "supports_claim_ids": ["CLM-001"],
        },
        {
            "source_id": "SRC-202",
            "title": "Developer beta launch notes",
            "canonical_url": "https://sources.example/beta-launch",
            "published_on": "2026-09-18",
            "verified_statement": "Twelve development teams joined the private beta.",
            "supports_claim_ids": [],
        },
    ],
}

DEFAULT_PRESET = "semantic_citation_trap"
VALID_PRESETS = {
    "clean",
    "contract_drift",
    "semantic_citation_trap",
    "unsupported_claim",
}


def _selected_preset(preset: str | None) -> str:
    selected = preset or DEFAULT_PRESET
    if selected not in VALID_PRESETS:
        raise ValueError(f"Unknown Content Machine fixture preset: {selected}")
    return selected


def _validated_input(input_data: dict[str, Any]) -> ContentBriefV1:
    return ContentBriefV1.model_validate(input_data)


def _source_by_id(brief: ContentBriefV1) -> dict[str, SourceRecordV1]:
    return {source.source_id: source for source in brief.sources}


def _source_fingerprint(source: SourceRecordV1) -> str:
    return stable_hash(source.model_dump(mode="json"))


def _catalog_hash(brief: ContentBriefV1) -> str:
    return stable_hash(
        [
            {
                **source.model_dump(mode="json"),
                "source_fingerprint": _source_fingerprint(source),
            }
            for source in brief.sources
        ]
    )


def _render_claims(claims: list[PublishedClaimV1] | list[DraftClaimV1]) -> str:
    return "\n\n".join(
        f"{claim.statement} [{', '.join(claim.citation_ids)}]" for claim in claims
    )


def build_handoff(
    variant: str,
    input_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    brief = _validated_input(input_data)
    preset = _selected_preset(fixture_preset)
    if variant not in {"baseline", "hardened"}:
        raise ValueError(f"Unknown Content Machine variant: {variant}")

    claim_id = brief.requested_claims[0].claim_id
    primary_source = brief.sources[0]
    unrelated_source = brief.sources[1]
    unsupported = preset == "unsupported_claim"
    semantic_trap = preset == "semantic_citation_trap"
    detected_issues: list[
        Literal["citation_source_mismatch", "unsupported_claim"]
    ] = []

    if unsupported and variant == "hardened":
        statement = "Company revenue doubled during Q3 2026."
        disposition: Literal["supported", "unsupported"] = "unsupported"
        citations: list[dict[str, Any]] = []
        citation_ids: list[str] = []
        detected_issues = ["unsupported_claim"]
    elif variant == "baseline" and (semantic_trap or unsupported):
        statement = (
            "Enterprise retention reached 98% in Q3 2026."
            if semantic_trap
            else "Company revenue doubled during Q3 2026."
        )
        disposition = "supported"
        citations = [
            {
                "citation_id": "CIT-001",
                "claim_id": claim_id,
                "source_id": unrelated_source.source_id,
                "source_fingerprint": _source_fingerprint(unrelated_source),
                "excerpt": unrelated_source.verified_statement,
                "locator": "launch-note:overview",
            }
        ]
        citation_ids = ["CIT-001"]
    else:
        statement = primary_source.verified_statement
        disposition = "supported"
        citations = [
            {
                "citation_id": "CIT-001",
                "claim_id": claim_id,
                "source_id": primary_source.source_id,
                "source_fingerprint": _source_fingerprint(primary_source),
                "excerpt": primary_source.verified_statement,
                "locator": "audited-table:retention",
            }
        ]
        citation_ids = ["CIT-001"]
        if semantic_trap and variant == "hardened":
            detected_issues = ["citation_source_mismatch"]

    handoff = ContentDraftHandoffV1(
        job_id=brief.job_id,
        headline="What the audited Q3 retention data actually shows",
        claims=[
            {
                "claim_id": claim_id,
                "statement": statement,
                "disposition": disposition,
                "citation_ids": citation_ids,
            }
        ],
        citations=citations,
        source_snapshot_ids=[source.source_id for source in brief.sources],
        source_catalog_hash=_catalog_hash(brief),
        detected_issues=detected_issues,
        lineage_complete=True,
    )
    return handoff.model_dump(mode="json")


def build_invalid_handoff(
    variant: str,
    input_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    invalid = build_handoff(variant, input_data, fixture_preset)
    invalid.pop("citations")
    return invalid


def build_output(
    variant: str,
    input_data: dict[str, Any],
    handoff_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    preset = _selected_preset(fixture_preset)
    if variant not in {"baseline", "hardened"}:
        raise ValueError(f"Unknown Content Machine variant: {variant}")
    brief = _validated_input(input_data)
    handoff = ContentDraftHandoffV1.model_validate(handoff_data)
    sources = _source_by_id(brief)
    requested_claim_ids = {claim.claim_id for claim in brief.requested_claims}
    handoff_claim_ids = {claim.claim_id for claim in handoff.claims}
    expected_source_ids = [source.source_id for source in brief.sources]
    if handoff.job_id != brief.job_id:
        raise ValueError("handoff job_id does not match the validated input")
    if handoff_claim_ids != requested_claim_ids:
        raise ValueError("handoff claims must exactly match the requested claim IDs")
    if handoff.source_snapshot_ids != expected_source_ids:
        raise ValueError("handoff source snapshot does not match the approved input catalog")
    if handoff.source_catalog_hash != _catalog_hash(brief):
        raise ValueError("handoff source catalog hash does not match the approved input")
    for citation in handoff.citations:
        source = sources.get(citation.source_id)
        if source is None:
            raise ValueError(
                f"citation source {citation.source_id} is outside the approved input catalog"
            )
        if citation.source_fingerprint != _source_fingerprint(source):
            raise ValueError(
                f"citation source {citation.source_id} failed identity verification"
            )
        if citation.excerpt != source.verified_statement:
            raise ValueError(
                f"citation excerpt for {citation.source_id} does not match the frozen source"
            )
    unsupported = [
        claim for claim in handoff.claims if claim.disposition == "unsupported"
    ]
    unsupported_ids = {claim.claim_id for claim in unsupported}
    if (
        variant == "hardened"
        and preset == "unsupported_claim"
        and unsupported_ids != requested_claim_ids
    ):
        raise ValueError(
            "hardened unsupported-claim fixture must block every requested claim ID"
        )
    if (
        variant == "hardened"
        and preset == "semantic_citation_trap"
        and handoff.detected_issues != ["citation_source_mismatch"]
    ):
        raise ValueError("hardened semantic trap must retain mismatch detection evidence")

    if unsupported:
        publication = ContentPublicationV1(
            job_id=brief.job_id,
            decision="blocked",
            headline=handoff.headline,
            body_markdown="",
            claims=[],
            citation_manifest=[],
            source_catalog_hash=_catalog_hash(brief),
            blocked_claim_ids=[claim.claim_id for claim in unsupported],
            review_reasons=[
                {
                    "code": "unsupported_claim",
                    "claim_id": claim.claim_id,
                    "detail": (
                        "No approved source supports this claim; publication requires "
                        "source review."
                    ),
                }
                for claim in unsupported
            ],
            containment_actions=[
                {
                    "action": "withhold_publication",
                    "claim_id": claim.claim_id,
                    "next_step": "review_sources",
                }
                for claim in unsupported
            ],
        )
    else:
        citation_manifest = [
            {
                "citation_id": citation.citation_id,
                "claim_id": citation.claim_id,
                "source_id": citation.source_id,
                "source_title": sources[citation.source_id].title,
                "canonical_url": sources[citation.source_id].canonical_url,
                "published_on": sources[citation.source_id].published_on,
                "source_fingerprint": _source_fingerprint(sources[citation.source_id]),
                "excerpt": citation.excerpt,
            }
            for citation in handoff.citations
        ]
        claims = [
            {
                "claim_id": claim.claim_id,
                "statement": claim.statement,
                "citation_ids": claim.citation_ids,
            }
            for claim in handoff.claims
        ]
        published_claims = [PublishedClaimV1.model_validate(claim) for claim in claims]
        containment_actions = (
            [
                {
                    "action": "repair_citation_lineage",
                    "claim_id": brief.requested_claims[0].claim_id,
                    "rejected_source_id": brief.sources[1].source_id,
                    "approved_source_id": brief.sources[0].source_id,
                }
            ]
            if variant == "hardened"
            and preset == "semantic_citation_trap"
            and handoff.detected_issues == ["citation_source_mismatch"]
            else []
        )
        publication = ContentPublicationV1(
            job_id=brief.job_id,
            decision="publish",
            headline=handoff.headline,
            body_markdown=_render_claims(published_claims),
            claims=claims,
            citation_manifest=citation_manifest,
            source_catalog_hash=_catalog_hash(brief),
            blocked_claim_ids=[],
            review_reasons=[],
            containment_actions=containment_actions,
        )
    return publication.model_dump(mode="json")


def evaluate_output(
    variant: str,
    input_data: dict[str, Any],
    output_data: dict[str, Any],
    fixture_preset: str | None,
) -> list[QualityCheck]:
    if variant not in {"baseline", "hardened"}:
        raise ValueError(f"Unknown Content Machine variant: {variant}")
    brief = _validated_input(input_data)
    preset = _selected_preset(fixture_preset)
    try:
        output = ContentPublicationV1.model_validate(output_data)
    except ValidationError as exc:
        return [
            QualityCheck(
                check_id="typed_publication",
                title="Final output matches ContentPublicationV1",
                passed=False,
                guarantee="contract",
                explanation=f"Pydantic rejected the final publication: {exc.errors()}",
            )
        ]

    sources = _source_by_id(brief)
    requested_claim_ids = {claim.claim_id for claim in brief.requested_claims}
    expected_catalog_hash = _catalog_hash(brief)
    manifest = {
        citation.citation_id: citation for citation in output.citation_manifest
    }
    unsupported_fixture = preset == "unsupported_claim"
    expected_reasons = [
        UnsupportedClaimReasonV1(
            code="unsupported_claim",
            claim_id=claim_id,
            detail=(
                "No approved source supports this claim; publication requires source review."
            ),
        )
        for claim_id in sorted(requested_claim_ids)
    ]
    expected_withhold_actions = [
        WithholdPublicationActionV1(
            action="withhold_publication",
            claim_id=claim_id,
            next_step="review_sources",
        )
        for claim_id in sorted(requested_claim_ids)
    ]
    expected_block = (
        unsupported_fixture
        and output.decision == "blocked"
        and set(output.blocked_claim_ids) == requested_claim_ids
        and output.review_reasons == expected_reasons
        and output.containment_actions == expected_withhold_actions
        and not output.claims
        and not output.citation_manifest
        and not output.body_markdown
    )
    source_continuity = (
        output.job_id == brief.job_id
        and output.source_catalog_hash == expected_catalog_hash
    )
    manifest_identity = output.decision == "publish" and bool(output.citation_manifest)
    citations_grounded = output.decision == "publish" and bool(output.claims)
    claims_factual = output.decision == "publish" and bool(output.claims)
    for citation in output.citation_manifest:
        source = sources.get(citation.source_id)
        manifest_identity = manifest_identity and bool(
            source
            and citation.source_title == source.title
            and citation.canonical_url == source.canonical_url
            and citation.published_on == source.published_on
            and citation.source_fingerprint == _source_fingerprint(source)
            and citation.excerpt == source.verified_statement
        )
    for claim in output.claims:
        supporting_sources = [
            source
            for source in sources.values()
            if claim.claim_id in source.supports_claim_ids
            and source.verified_statement == claim.statement
        ]
        claims_factual = claims_factual and bool(supporting_sources)
        supporting_ids = {source.source_id for source in supporting_sources}
        for citation_id in claim.citation_ids:
            citation = manifest.get(citation_id)
            citations_grounded = citations_grounded and bool(
                citation and citation.source_id in supporting_ids
            )

    if output.decision == "blocked":
        # A block earns these guarantees only when it names the exact requested claim,
        # carries an actionable reason, and emits no content/citation payload.
        manifest_identity = expected_block
        citations_grounded = expected_block
        claims_factual = expected_block

    semantic_containment = (
        preset != "semantic_citation_trap"
        or variant == "baseline"
        or (
            output.decision == "publish"
            and output.containment_actions
            == [
                RepairCitationLineageActionV1(
                    action="repair_citation_lineage",
                    claim_id=brief.requested_claims[0].claim_id,
                    rejected_source_id=brief.sources[1].source_id,
                    approved_source_id=brief.sources[0].source_id,
                )
            ]
        )
    )
    body_bound = output.decision == "blocked" or output.body_markdown == _render_claims(
        output.claims
    )
    safe_publication = (
        expected_block
        if unsupported_fixture
        else (
            output.decision == "publish"
            and claims_factual
            and citations_grounded
            and manifest_identity
            and source_continuity
            and body_bound
            and semantic_containment
        )
    )
    preserved_lineage = expected_block or (
        bool(output.claims)
        and citations_grounded
        and manifest_identity
        and source_continuity
    )
    return [
        QualityCheck(
            check_id="typed_publication",
            title="Publication decision satisfies the Pydantic contract",
            passed=True,
            guarantee="contract",
            explanation=(
                "The publish/blocked invariants and citation graph are structurally valid. "
                "That green check does not establish whether a source supports the prose."
            ),
        ),
        QualityCheck(
            check_id="source_catalog_continuity",
            title="Output source identity matches the approved input catalog",
            passed=source_continuity and manifest_identity,
            guarantee="policy",
            explanation=(
                "Catalog hash, source ID, title, canonical URL, publication date, excerpt, "
                "and source fingerprint were checked against the frozen fixture."
            ),
        ),
        QualityCheck(
            check_id="citation_grounding",
            title="Every citation actually supports its attached claim",
            passed=citations_grounded,
            guarantee="citation",
            explanation=(
                "Citation IDs were joined against the frozen source catalog, and excerpts "
                "were compared with authoritative fixture text."
            ),
        ),
        QualityCheck(
            check_id="claim_factuality",
            title="Published claims match an authoritative source statement",
            passed=claims_factual,
            guarantee="factuality",
            explanation=(
                "Factuality is evaluated against fixture truth independently of Pydantic's "
                "shape validation."
            ),
        ),
        QualityCheck(
            check_id="lineage_preserved",
            title="Claim-to-source lineage survives the complete pipeline",
            passed=preserved_lineage and body_bound and semantic_containment,
            guarantee="policy",
            explanation=(
                "Published claim IDs retain a valid manifest path to a supporting source, "
                "or unsupported content is withheld."
            ),
        ),
        QualityCheck(
            check_id="publication_quality",
            title="Only grounded content reaches the publishable result",
            passed=safe_publication,
            guarantee="task_quality",
            explanation=(
                "Unsupported claims must be blocked; supported fixtures must publish with "
                "factual, grounded citations."
            ),
        ),
    ]


def _extract_output(run: RunRecord) -> ContentPublicationV1 | None:
    candidates = [
        run.outputs.get("result"),
        run.outputs.get("scenario_output"),
        run.outputs.get("output"),
        run.outputs,
    ]
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        try:
            return ContentPublicationV1.model_validate(candidate)
        except ValidationError:
            continue
    return None


def _claims_are_grounded(output: ContentPublicationV1) -> bool:
    sources = _source_by_id(ContentBriefV1.model_validate(FIXTURE_INPUT))
    manifest = {
        citation.citation_id: citation for citation in output.citation_manifest
    }
    for claim in output.claims:
        for citation_id in claim.citation_ids:
            citation = manifest.get(citation_id)
            if not citation:
                return False
            source = sources.get(citation.source_id)
            if not source:
                return False
            if (
                claim.statement != source.verified_statement
                or claim.claim_id not in source.supports_claim_ids
                or citation.source_title != source.title
                or citation.canonical_url != source.canonical_url
                or citation.published_on != source.published_on
                or citation.source_fingerprint != _source_fingerprint(source)
                or citation.excerpt != source.verified_statement
            ):
                return False
    used = {
        citation_id for claim in output.claims for citation_id in claim.citation_ids
    }
    return bool(output.claims) and used == set(manifest)


def _claims_are_factual(output: ContentPublicationV1) -> bool:
    sources = _source_by_id(ContentBriefV1.model_validate(FIXTURE_INPUT))
    return bool(output.claims) and all(
        any(
            claim.claim_id in source.supports_claim_ids
            and claim.statement == source.verified_statement
            for source in sources.values()
        )
        for claim in output.claims
    )


def _run_context(run: RunRecord, *, variant: str, preset: str) -> bool:
    return (
        run.scenario_id == definition.scenario_id
        and run.variant == variant
        and run.fixture_preset == preset
        and run.terminal_status == "succeeded"
    )


def _has_evidence(
    run: RunRecord,
    *,
    layer: str,
    status: str,
    guarantee: str | None = None,
    contract_name: str | None = None,
) -> bool:
    return any(
        item.layer == layer
        and item.status == status
        and (guarantee is None or item.guarantee == guarantee)
        and (contract_name is None or item.contract_name == contract_name)
        for item in run.pydantic_evidence
    )


def _producer_detected(run: RunRecord, issue: str) -> bool:
    return any(
        item.layer == "agent_output"
        and item.contract_name == ContentDraftHandoffV1.__name__
        and item.status in {"passed", "repaired"}
        and isinstance(item.output_snapshot, dict)
        and issue in item.output_snapshot.get("detected_issues", [])
        for item in run.pydantic_evidence
    )


def _eval_contract_repair(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    return {
        "correct_scenario_variant_and_preset": _run_context(
            run, variant="hardened", preset="contract_drift"
        ),
        "edge_rejection_was_visible": any(
            event.kind == "edge_contract_rejected" for event in run.events
        ),
        "edge_fault_was_injected": any(
            event.kind == "fault_injected" and event.node_id == "edge_validator"
            for event in run.events
        ),
        "edge_contract_repair_evidence_exists": _has_evidence(
            run,
            layer="edge_contract",
            status="repaired",
            guarantee="contract",
            contract_name=ContentDraftHandoffV1.__name__,
        ),
        "repair_returned_typed_output": output is not None,
    }


def _eval_schema_valid_citation_trap(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    return {
        "correct_scenario_variant_and_preset": _run_context(
            run, variant="baseline", preset="semantic_citation_trap"
        ),
        "schema_valid_publication_returned": bool(
            output and output.decision == "publish"
        ),
        "typed_consumer_evidence_exists": _has_evidence(
            run,
            layer="agent_output",
            status="passed",
            guarantee="contract",
            contract_name=ContentPublicationV1.__name__,
        ),
        "citation_drift_detected": bool(output and not _claims_are_grounded(output)),
        "citation_failure_evidence_exists": _has_evidence(
            run, layer="task_quality", status="failed", guarantee="citation"
        ),
    }


def _eval_schema_valid_factuality_trap(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    return {
        "correct_scenario_variant_and_preset": _run_context(
            run, variant="baseline", preset="semantic_citation_trap"
        ),
        "schema_valid_publication_returned": bool(
            output and output.decision == "publish"
        ),
        "fixture_factuality_failed": bool(output and not _claims_are_factual(output)),
        "factuality_failure_evidence_exists": _has_evidence(
            run, layer="task_quality", status="failed", guarantee="factuality"
        ),
        "task_failure_evidence_exists": _has_evidence(
            run, layer="task_quality", status="failed", guarantee="task_quality"
        ),
    }


def _eval_hardened_lineage(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    return {
        "correct_scenario_variant_and_preset": _run_context(
            run, variant="hardened", preset="semantic_citation_trap"
        ),
        "mismatch_detection_is_in_the_trace": _producer_detected(
            run, "citation_source_mismatch"
        ),
        "typed_publication_returned": bool(output and output.decision == "publish"),
        "claim_source_lineage_grounded": bool(output and _claims_are_grounded(output)),
        "containment_is_visible_in_output": bool(
            output
            and output.containment_actions
            == [
                RepairCitationLineageActionV1(
                    action="repair_citation_lineage",
                    claim_id="CLM-001",
                    rejected_source_id="SRC-202",
                    approved_source_id="SRC-101",
                )
            ]
        ),
        "task_quality_pass_evidence_exists": _has_evidence(
            run, layer="task_quality", status="passed", guarantee="task_quality"
        ),
    }


def _eval_unsupported_claim_block(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    return {
        "correct_scenario_variant_and_preset": _run_context(
            run, variant="hardened", preset="unsupported_claim"
        ),
        "unsupported_detection_is_in_the_trace": _producer_detected(
            run, "unsupported_claim"
        ),
        "typed_block_decision_returned": bool(output and output.decision == "blocked"),
        "no_publishable_body_escaped": bool(output and not output.body_markdown),
        "unsupported_claim_named": bool(output and output.blocked_claim_ids == ["CLM-001"]),
        "review_reason_is_actionable": bool(
            output
            and output.review_reasons
            == [
                UnsupportedClaimReasonV1(
                    code="unsupported_claim",
                    claim_id="CLM-001",
                    detail=(
                        "No approved source supports this claim; publication requires "
                        "source review."
                    ),
                )
            ]
            and output.containment_actions
            == [
                WithholdPublicationActionV1(
                    action="withhold_publication",
                    claim_id="CLM-001",
                    next_step="review_sources",
                )
            ]
        ),
        "non_vacuous_task_evidence_exists": _has_evidence(
            run, layer="task_quality", status="passed", guarantee="task_quality"
        ),
    }


definition = ScenarioDefinition(
    scenario_id="content-machine",
    title="The Content Machine",
    summary=(
        "Stress-test a multi-agent content pipeline where schemas preserve citation lineage, "
        "while independent evals catch source drift, unsupported prose, and factual errors."
    ),
    input_model=ContentBriefV1,
    handoff_model=ContentDraftHandoffV1,
    output_model=ContentPublicationV1,
    fixture_input=FIXTURE_INPUT,
    producer_name="Research and drafting pipeline",
    consumer_name="Grounded publication gate",
    build_handoff=build_handoff,
    build_invalid_handoff=build_invalid_handoff,
    build_output=build_output,
    evaluate_output=evaluate_output,
    edge_fault_field="citations",
    fixture_presets={
        "clean": "Publish a claim that exactly matches its approved source and excerpt.",
        "contract_drift": (
            "Remove the citation collection after agent output so edge validation must reject "
            "and repair the handoff."
        ),
        "semantic_citation_trap": (
            "Return schema-valid prose with an inflated metric and a real but unrelated source."
        ),
        "unsupported_claim": (
            "Propose a revenue claim absent from the source catalog; hardened blocks it."
        ),
    },
    pydantic_lessons=(
        "Strict input models reject coercion, extra fields, duplicate identifiers, and source "
        "references to claims outside the approved brief.",
        "Cross-model validators turn claim IDs, citation IDs, and frozen source IDs into a "
        "closed structural lineage graph at every agent handoff.",
        "A publish/blocked output contract prevents unsupported review state from being "
        "serialized as publishable content.",
        "Pydantic proves declared structure, not truth: a valid URL and citation ID can still "
        "point to a source that does not support the sentence.",
        "Citation grounding, fixture factuality, policy containment, and task quality remain "
        "separate eval guarantees so the UI never overclaims what schema validation proved.",
    ),
    eval_cases=(
        ScenarioEvalCase(
            name="content_contract_drift_repair",
            version="1.0",
            description=(
                "A missing citation collection is rejected at the edge and repaired visibly."
            ),
            variant="hardened",
            fixture_preset="contract_drift",
            evaluate=_eval_contract_repair,
        ),
        ScenarioEvalCase(
            name="content_citation_grounding_trap",
            version="1.0",
            description=(
                "Citation grounding fails when a real source is attached to an unrelated claim."
            ),
            variant="baseline",
            fixture_preset="semantic_citation_trap",
            evaluate=_eval_schema_valid_citation_trap,
        ),
        ScenarioEvalCase(
            name="content_fixture_factuality_trap",
            version="1.0",
            description=(
                "Fixture truth rejects an inflated metric that remains schema-valid."
            ),
            variant="baseline",
            fixture_preset="semantic_citation_trap",
            evaluate=_eval_schema_valid_factuality_trap,
        ),
        ScenarioEvalCase(
            name="content_hardened_lineage",
            version="1.0",
            description=(
                "The hardened pipeline preserves a factual claim-to-source path through output."
            ),
            variant="hardened",
            fixture_preset="semantic_citation_trap",
            evaluate=_eval_hardened_lineage,
        ),
        ScenarioEvalCase(
            name="content_unsupported_claim_block",
            version="1.0",
            description=(
                "An unsupported claim returns a typed block decision with no publishable body."
            ),
            variant="hardened",
            fixture_preset="unsupported_claim",
            evaluate=_eval_unsupported_claim_block,
        ),
    ),
)


__all__ = [
    "CitationEvidenceV1",
    "CitationManifestEntryV1",
    "ContentBriefV1",
    "ContentDraftHandoffV1",
    "ContentPublicationV1",
    "DraftClaimV1",
    "PublishedClaimV1",
    "SourceRecordV1",
    "definition",
]
