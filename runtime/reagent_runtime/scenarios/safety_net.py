from __future__ import annotations

from hashlib import sha256
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from ..models import RunRecord
from .base import QualityCheck, ScenarioDefinition, ScenarioEvalCase


def _safe_fixture_reference(value: str) -> str:
    prefix = "fixture://documents/"
    if not value.startswith(prefix):
        raise ValueError("file_ref must use the fixture://documents/ allowlist")
    path = value.removeprefix(prefix)
    if not path or ".." in path.split("/") or "//" in path:
        raise ValueError("file_ref contains an unsafe path")
    return value


class StrictContract(BaseModel):
    """Scenario contracts reject coercion and undeclared fields."""

    model_config = ConfigDict(extra="forbid", strict=True)


class SafetyNetInputV1(StrictContract):
    request_id: str = Field(min_length=8, max_length=64)
    file_ref: str = Field(min_length=1, max_length=256)
    summary_mode: Literal["executive", "detailed"] = "executive"
    max_bytes: int = Field(default=262_144, ge=1_024, le=1_048_576)

    @field_validator("file_ref")
    @classmethod
    def fixture_reference_is_safe(cls, value: str) -> str:
        return _safe_fixture_reference(value)


class FileReadSuccessV1(StrictContract):
    status: Literal["ok"]
    content: str = Field(min_length=1)
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    bytes_read: int = Field(gt=0)
    complete: Literal[True]

    @model_validator(mode="after")
    def content_metadata_matches_bytes(self) -> FileReadSuccessV1:
        encoded = self.content.encode()
        if self.bytes_read != len(encoded):
            raise ValueError("bytes_read must equal the UTF-8 encoded content length")
        if self.content_sha256 != sha256(encoded).hexdigest():
            raise ValueError("content_sha256 must equal SHA256(content)")
        return self


class FileReadFailureV1(StrictContract):
    status: Literal["error"]
    error_code: Literal["corrupt_partial", "not_found", "permission_denied", "io_error"]
    message: str = Field(min_length=1)
    retryable: bool
    partial_content: str | None = None
    bytes_read: int = Field(ge=0)
    complete: Literal[False]

    @model_validator(mode="after")
    def partial_failure_has_partial_evidence(self) -> FileReadFailureV1:
        if self.error_code == "corrupt_partial":
            if not self.partial_content or self.bytes_read == 0:
                raise ValueError(
                    "corrupt_partial requires partial_content and a positive bytes_read"
                )
            if self.bytes_read != len(self.partial_content.encode()):
                raise ValueError(
                    "bytes_read must equal the UTF-8 encoded partial_content length"
                )
        elif self.partial_content is not None:
            raise ValueError("partial_content is only valid for corrupt_partial")
        return self


FileReadOutcomeV1 = Annotated[
    FileReadSuccessV1 | FileReadFailureV1,
    Field(discriminator="status"),
]


class SafetyNetHandoffV1(StrictContract):
    request_id: str = Field(min_length=8, max_length=64)
    file_ref: str
    read: FileReadOutcomeV1
    route: Literal["process", "fallback"]
    tool_attempt: int = Field(ge=1, le=3)

    @field_validator("file_ref")
    @classmethod
    def handoff_reference_remains_safe(cls, value: str) -> str:
        return _safe_fixture_reference(value)

    @model_validator(mode="after")
    def route_matches_validated_tool_status(self) -> SafetyNetHandoffV1:
        expected = "process" if self.read.status == "ok" else "fallback"
        if self.route != expected:
            raise ValueError(f"route must be {expected!r} when read status is {self.read.status!r}")
        return self


class CompleteDocumentSummaryV1(StrictContract):
    outcome: Literal["complete"]
    summary: str = Field(min_length=24)
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    source_bytes: int = Field(gt=0)
    fallback_used: Literal[False]
    warnings: list[str] = Field(default_factory=list, max_length=3)


class GracefulDocumentFallbackV1(StrictContract):
    outcome: Literal["degraded"]
    user_message: str = Field(min_length=24)
    error_code: Literal["corrupt_partial", "not_found", "permission_denied", "io_error"]
    retry_recommended: bool
    partial_data_discarded: bool
    source_bytes_observed: int = Field(ge=0)
    fallback_used: Literal[True]
    warnings: list[str] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def corrupt_content_is_never_silently_consumed(self) -> GracefulDocumentFallbackV1:
        if self.error_code == "corrupt_partial" and not self.partial_data_discarded:
            raise ValueError("corrupt partial content must be discarded or explicitly quarantined")
        return self


DocumentResultV1 = Annotated[
    CompleteDocumentSummaryV1 | GracefulDocumentFallbackV1,
    Field(discriminator="outcome"),
]


class SafetyNetOutputV1(StrictContract):
    request_id: str = Field(min_length=8, max_length=64)
    file_ref: str
    result: DocumentResultV1

    @field_validator("file_ref")
    @classmethod
    def output_reference_remains_safe(cls, value: str) -> str:
        return _safe_fixture_reference(value)


CLEAN_CONTENT = (
    "Q3 operational risk review: supplier concentration is elevated. "
    "The recommended mitigation is to qualify a second logistics vendor before renewal."
)
PARTIAL_CONTENT = "Q3 operational risk review: supplier concentration is eleva"
EXECUTIVE_SUMMARY = (
    "The document reports elevated supplier concentration and recommends "
    "qualifying a second logistics vendor before renewal."
)
DETAILED_SUMMARY = (
    "The Q3 operational risk review identifies elevated supplier concentration as the "
    "primary exposure. It recommends qualifying a second logistics vendor before renewal "
    "to reduce concentration risk."
)
DEFAULT_PRESET = "corrupt_partial"


def _hash_content(content: str) -> str:
    return sha256(content.encode()).hexdigest()


def _selected_preset(preset: str | None) -> str:
    selected = preset or DEFAULT_PRESET
    if selected not in {
        "clean_read",
        "contract_drift",
        "corrupt_partial",
        "missing_file",
    }:
        raise ValueError(f"Unknown Safety Net fixture preset: {selected}")
    return selected


def _validated_input(input_data: dict[str, Any]) -> SafetyNetInputV1:
    return SafetyNetInputV1.model_validate(input_data)


def build_handoff(
    variant: str,
    input_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    request = _validated_input(input_data)
    preset = _selected_preset(fixture_preset)
    if variant not in {"baseline", "hardened"}:
        raise ValueError(f"Unknown Safety Net variant: {variant}")

    if preset in {"clean_read", "contract_drift"}:
        read: dict[str, Any] = {
            "status": "ok",
            "content": CLEAN_CONTENT,
            "content_sha256": _hash_content(CLEAN_CONTENT),
            "bytes_read": len(CLEAN_CONTENT.encode()),
            "complete": True,
        }
    elif preset == "missing_file":
        read = {
            "status": "error",
            "error_code": "not_found",
            "message": "The fixture file does not exist.",
            "retryable": False,
            "partial_content": None,
            "bytes_read": 0,
            "complete": False,
        }
    elif variant == "baseline":
        # This is intentionally schema-valid. The weak baseline trusts a success-shaped
        # producer response and cannot infer from a checksum that the file was truncated.
        read = {
            "status": "ok",
            "content": PARTIAL_CONTENT,
            "content_sha256": _hash_content(PARTIAL_CONTENT),
            "bytes_read": len(PARTIAL_CONTENT.encode()),
            "complete": True,
        }
    else:
        read = {
            "status": "error",
            "error_code": "corrupt_partial",
            "message": "The file reader returned truncated content.",
            "retryable": True,
            "partial_content": PARTIAL_CONTENT,
            "bytes_read": len(PARTIAL_CONTENT.encode()),
            "complete": False,
        }

    handoff = SafetyNetHandoffV1(
        request_id=request.request_id,
        file_ref=request.file_ref,
        read=read,
        route="process" if read["status"] == "ok" else "fallback",
        tool_attempt=1,
    )
    return handoff.model_dump(mode="json")


def build_invalid_handoff(
    variant: str,
    input_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    invalid = build_handoff(variant, input_data, fixture_preset)
    invalid.pop("read")
    return invalid


def build_output(
    variant: str,
    input_data: dict[str, Any],
    handoff_data: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    del variant, fixture_preset
    request = _validated_input(input_data)
    handoff = SafetyNetHandoffV1.model_validate(handoff_data)
    if handoff.request_id != request.request_id:
        raise ValueError("handoff request_id does not match the validated input")
    if handoff.file_ref != request.file_ref:
        raise ValueError("handoff file_ref does not match the validated input")
    if handoff.read.bytes_read > request.max_bytes:
        raise ValueError(
            f"handoff bytes_read={handoff.read.bytes_read} exceeds max_bytes={request.max_bytes}"
        )

    if isinstance(handoff.read, FileReadSuccessV1):
        result: dict[str, Any] = {
            "outcome": "complete",
            "summary": (
                EXECUTIVE_SUMMARY
                if request.summary_mode == "executive"
                else DETAILED_SUMMARY
            ),
            "source_sha256": handoff.read.content_sha256,
            "source_bytes": handoff.read.bytes_read,
            "fallback_used": False,
            "warnings": [],
        }
    else:
        result = {
            "outcome": "degraded",
            "user_message": (
                "No document summary was generated because the source could not be read "
                "completely. Retry with a verified file."
            ),
            "error_code": handoff.read.error_code,
            "retry_recommended": handoff.read.retryable,
            "partial_data_discarded": handoff.read.partial_content is not None,
            "source_bytes_observed": handoff.read.bytes_read,
            "fallback_used": True,
            "warnings": [
                "Partial or unavailable source data was blocked before document processing."
            ],
        }

    output = SafetyNetOutputV1(
        request_id=request.request_id,
        file_ref=request.file_ref,
        result=result,
    )
    return output.model_dump(mode="json")


def evaluate_output(
    variant: str,
    input_data: dict[str, Any],
    output_data: dict[str, Any],
    fixture_preset: str | None,
) -> list[QualityCheck]:
    request = _validated_input(input_data)
    preset = _selected_preset(fixture_preset)
    try:
        output = SafetyNetOutputV1.model_validate(output_data)
    except ValidationError as exc:
        return [
            QualityCheck(
                check_id="typed_output",
                title="Final output matches SafetyNetOutputV1",
                passed=False,
                guarantee="contract",
                explanation=f"Pydantic rejected the final result: {exc.errors()}",
            )
        ]

    result = output.result
    is_clean_fixture = preset in {"clean_read", "contract_drift"}
    degraded = isinstance(result, GracefulDocumentFallbackV1)
    observed_bytes = (
        result.source_bytes
        if isinstance(result, CompleteDocumentSummaryV1)
        else result.source_bytes_observed
    )
    byte_budget_passed = observed_bytes <= request.max_bytes
    continuity_passed = (
        output.request_id == request.request_id and output.file_ref == request.file_ref
    )
    if is_clean_fixture:
        expected_summary = (
            EXECUTIVE_SUMMARY
            if request.summary_mode == "executive"
            else DETAILED_SUMMARY
        )
        fixture_semantics_passed = bool(
            isinstance(result, CompleteDocumentSummaryV1)
            and result.summary == expected_summary
            and result.source_sha256 == _hash_content(CLEAN_CONTENT)
            and result.source_bytes == len(CLEAN_CONTENT.encode())
            and byte_budget_passed
            and not result.fallback_used
            and not result.warnings
        )
        expected_behavior = (
            "complete summary grounded to the clean fixture checksum, byte count, and "
            f"{request.summary_mode} summary"
        )
    elif preset == "corrupt_partial":
        fixture_semantics_passed = bool(
            isinstance(result, GracefulDocumentFallbackV1)
            and result.error_code == "corrupt_partial"
            and result.partial_data_discarded
            and result.source_bytes_observed == len(PARTIAL_CONTENT.encode())
            and byte_budget_passed
            and result.retry_recommended
            and result.fallback_used
            and bool(result.warnings)
            and "No document summary" in result.user_message
        )
        expected_behavior = (
            "corrupt_partial fallback with quarantined partial bytes and a retry path"
        )
    else:
        fixture_semantics_passed = bool(
            isinstance(result, GracefulDocumentFallbackV1)
            and result.error_code == "not_found"
            and not result.partial_data_discarded
            and result.source_bytes_observed == 0
            and byte_budget_passed
            and not result.retry_recommended
            and result.fallback_used
            and bool(result.warnings)
            and "No document summary" in result.user_message
        )
        expected_behavior = "not_found fallback with no partial bytes and no retry claim"

    typed_explanation = (
        "Pydantic accepted the discriminated final-result union. "
        "Contract validity alone does not prove that a producer labeled source "
        "completeness honestly."
    )
    checks = [
        QualityCheck(
            check_id="typed_output",
            title="Final output matches SafetyNetOutputV1",
            passed=True,
            guarantee="contract",
            explanation=typed_explanation,
        ),
        QualityCheck(
            check_id="request_continuity",
            title="Request identity survives both handoffs",
            passed=continuity_passed,
            guarantee="contract",
            explanation=(
                "request_id and file_ref match the validated scenario input."
                if continuity_passed
                else "The output belongs to a different request or file reference."
            ),
        ),
        QualityCheck(
            check_id="fixture_semantics",
            title="Result is grounded to the selected deterministic fixture",
            passed=fixture_semantics_passed,
            guarantee="task_quality",
            explanation=(
                f"Observed the expected {expected_behavior}."
                if fixture_semantics_passed
                else f"Expected {expected_behavior}; the schema-valid result does not match it."
            ),
        ),
        QualityCheck(
            check_id="read_within_requested_limit",
            title="Observed file bytes respect the validated request budget",
            passed=byte_budget_passed,
            guarantee="policy",
            explanation=(
                f"Observed {observed_bytes} bytes within max_bytes={request.max_bytes}."
                if byte_budget_passed
                else (
                    f"Observed {observed_bytes} bytes exceeds max_bytes={request.max_bytes}; "
                    "the result must not continue."
                )
            ),
        ),
        QualityCheck(
            check_id="failure_routed_at_source",
            title="File status selects the expected processing branch",
            passed=(is_clean_fixture and not degraded)
            or (not is_clean_fixture and degraded and fixture_semantics_passed),
            guarantee="policy",
            explanation=(
                "The selected preset produced the exact validated branch behavior."
                if fixture_semantics_passed
                else "The branch or its typed recovery semantics do not match the preset."
            ),
        ),
        QualityCheck(
            check_id="partial_not_mislabeled",
            title="Partial source is not presented as complete",
            passed=preset != "corrupt_partial" or fixture_semantics_passed,
            guarantee="task_quality",
            explanation=(
                "Corrupted bytes were quarantined under the corrupt_partial failure code."
                if preset == "corrupt_partial" and fixture_semantics_passed
                else (
                    "The schema-valid result does not prove that the partial fixture was "
                    "identified and quarantined."
                    if preset == "corrupt_partial"
                    else "This fixture does not contain partial data."
                )
            ),
        ),
    ]
    if variant == "baseline" and preset == "corrupt_partial":
        # Keep the paired-demo intent visible even if callers only inspect check text.
        assert checks[0].passed and not checks[2].passed
    return checks


def _extract_output(run: RunRecord) -> SafetyNetOutputV1 | None:
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
            return SafetyNetOutputV1.model_validate(candidate)
        except ValidationError:
            continue
    return None


def _extract_input(run: RunRecord) -> SafetyNetInputV1 | None:
    try:
        return SafetyNetInputV1.model_validate(run.input)
    except ValidationError:
        return None


def _run_continuity(
    run: RunRecord,
    output: SafetyNetOutputV1 | None,
) -> bool:
    request = _extract_input(run)
    return bool(
        request
        and output
        and output.request_id == request.request_id
        and output.file_ref == request.file_ref
    )


def _eval_clean_summary(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    request = _extract_input(run)
    complete = output.result if output else None
    expected_summary = (
        EXECUTIVE_SUMMARY
        if request and request.summary_mode == "executive"
        else DETAILED_SUMMARY
    )
    return {
        "run_succeeded": run.terminal_status == "succeeded",
        "typed_output_returned": output is not None,
        "request_identity_preserved": _run_continuity(run, output),
        "complete_summary_is_fixture_grounded": bool(
            isinstance(complete, CompleteDocumentSummaryV1)
            and complete.summary == expected_summary
            and complete.source_sha256 == _hash_content(CLEAN_CONTENT)
            and complete.source_bytes == len(CLEAN_CONTENT.encode())
            and bool(request and complete.source_bytes <= request.max_bytes)
        ),
        "fallback_not_used": bool(
            isinstance(complete, CompleteDocumentSummaryV1)
            and not complete.fallback_used
            and not complete.warnings
        ),
    }


def _eval_baseline_partial_escape(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    request = _extract_input(run)
    complete = output.result if output else None
    return {
        "request_identity_preserved": _run_continuity(run, output),
        "schema_accepted_false_complete": bool(
            output and isinstance(complete, CompleteDocumentSummaryV1)
        ),
        "partial_fixture_escaped": bool(
            isinstance(complete, CompleteDocumentSummaryV1)
            and complete.source_sha256 == _hash_content(PARTIAL_CONTENT)
            and complete.source_bytes == len(PARTIAL_CONTENT.encode())
            and bool(request and complete.source_bytes <= request.max_bytes)
        ),
        "fallback_was_bypassed": bool(
            isinstance(complete, CompleteDocumentSummaryV1) and not complete.fallback_used
        ),
    }


def _eval_hardened_partial_fallback(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    request = _extract_input(run)
    fallback = output.result if output else None
    return {
        "request_identity_preserved": _run_continuity(run, output),
        "typed_degraded_result": bool(
            output and isinstance(fallback, GracefulDocumentFallbackV1)
        ),
        "partial_data_discarded": bool(
            isinstance(fallback, GracefulDocumentFallbackV1)
            and fallback.partial_data_discarded
            and fallback.source_bytes_observed == len(PARTIAL_CONTENT.encode())
            and bool(request and fallback.source_bytes_observed <= request.max_bytes)
        ),
        "corruption_is_explicit": bool(
            isinstance(fallback, GracefulDocumentFallbackV1)
            and fallback.error_code == "corrupt_partial"
        ),
        "retry_path_explained": bool(
            isinstance(fallback, GracefulDocumentFallbackV1)
            and fallback.retry_recommended
            and bool(fallback.warnings)
            and "No document summary" in fallback.user_message
        ),
    }


def _eval_missing_file_fallback(run: RunRecord) -> dict[str, bool]:
    output = _extract_output(run)
    fallback = output.result if output else None
    return {
        "request_identity_preserved": _run_continuity(run, output),
        "typed_degraded_result": bool(
            output and isinstance(fallback, GracefulDocumentFallbackV1)
        ),
        "not_found_is_explicit": bool(
            isinstance(fallback, GracefulDocumentFallbackV1)
            and fallback.error_code == "not_found"
        ),
        "no_partial_content_claimed": bool(
            isinstance(fallback, GracefulDocumentFallbackV1)
            and not fallback.partial_data_discarded
            and fallback.source_bytes_observed == 0
        ),
        "non_retryable_fixture_preserved": bool(
            isinstance(fallback, GracefulDocumentFallbackV1)
            and not fallback.retry_recommended
        ),
        "fallback_is_explicit": bool(
            isinstance(fallback, GracefulDocumentFallbackV1)
            and fallback.fallback_used
            and bool(fallback.warnings)
            and "No document summary" in fallback.user_message
        ),
    }


def _eval_contract_drift_repair(run: RunRecord) -> dict[str, bool]:
    edge_rejections = [
        event for event in run.events if event.kind == "edge_contract_rejected"
    ]
    edge_repairs = [
        item
        for item in run.pydantic_evidence
        if item.node_id == "edge_validator"
        and item.layer == "edge_contract"
        and item.status == "repaired"
    ]
    return {
        "run_succeeded": run.terminal_status == "succeeded",
        "exactly_one_edge_rejection": len(edge_rejections) == 1,
        "type_adapter_enforced_boundary": bool(
            len(edge_rejections) == 1
            and edge_rejections[0].metadata.get("enforcement_layer")
            == "pydantic_type_adapter"
            and edge_rejections[0].metadata.get("bounded_revision") is True
        ),
        "edge_repair_has_validation_evidence": bool(
            len(edge_repairs) == 1 and edge_repairs[0].validation_errors
        ),
        "repaired_output_is_still_grounded": all(_eval_clean_summary(run).values()),
    }


definition = ScenarioDefinition(
    scenario_id="safety-net",
    title="The Safety Net",
    summary=(
        "Contain unreliable file reads at the tool boundary with discriminated Pydantic "
        "contracts and an explicit degraded-output path."
    ),
    input_model=SafetyNetInputV1,
    handoff_model=SafetyNetHandoffV1,
    output_model=SafetyNetOutputV1,
    fixture_input={
        "request_id": "docreq-2026-0001",
        "file_ref": "fixture://documents/q3-operational-risk.txt",
        "summary_mode": "executive",
        "max_bytes": 262_144,
    },
    producer_name="File reader",
    consumer_name="Document summarizer / fallback responder",
    build_handoff=build_handoff,
    build_invalid_handoff=build_invalid_handoff,
    build_output=build_output,
    evaluate_output=evaluate_output,
    edge_fault_field="read",
    fixture_presets={
        "corrupt_partial": (
            "The file returns plausible but truncated bytes. Baseline trusts a false success "
            "label; hardened routes to fallback."
        ),
        "clean_read": "A complete fixture file follows the normal typed summarization path.",
        "contract_drift": (
            "A complete read is mutated after the producer returns; the edge TypeAdapter "
            "rejects and repairs the missing read outcome."
        ),
        "missing_file": "A deterministic not-found result produces a non-retryable fallback.",
    },
    pydantic_lessons=(
        "Strict input contracts forbid coercion, extra fields, unsafe paths, and oversized reads.",
        (
            "A discriminated FileReadSuccessV1 | FileReadFailureV1 union makes failure state "
            "explicit and drives the LangGraph route at the tool boundary."
        ),
        (
            "Pydantic validates declared structure, not external truth: the baseline's false "
            "complete=true payload is schema-valid but fails task-quality evaluation."
        ),
        (
            "The final discriminated union prevents degraded responses from masquerading as "
            "complete summaries, honors the requested summary mode, and requires an "
            "actionable fallback explanation."
        ),
        (
            "Post-producer contract drift is checked by an edge TypeAdapter, separately from "
            "Pydantic AI output retries inside an agent run."
        ),
    ),
    eval_cases=(
        ScenarioEvalCase(
            name="clean_document_summary",
            version="1.0",
            description="A complete read returns a typed summary without invoking fallback.",
            variant="hardened",
            fixture_preset="clean_read",
            evaluate=_eval_clean_summary,
        ),
        ScenarioEvalCase(
            name="baseline_partial_data_escape",
            version="1.0",
            description=(
                "Proves a schema-valid false completeness label can escape a weak baseline."
            ),
            variant="baseline",
            fixture_preset="corrupt_partial",
            evaluate=_eval_baseline_partial_escape,
        ),
        ScenarioEvalCase(
            name="hardened_partial_data_fallback",
            version="1.0",
            description=(
                "A typed corrupt-partial result routes before summarization and degrades safely."
            ),
            variant="hardened",
            fixture_preset="corrupt_partial",
            evaluate=_eval_hardened_partial_fallback,
        ),
        ScenarioEvalCase(
            name="missing_file_fallback",
            version="1.0",
            description="A missing file returns a typed, explicit, non-retryable fallback.",
            variant="hardened",
            fixture_preset="missing_file",
            evaluate=_eval_missing_file_fallback,
        ),
        ScenarioEvalCase(
            name="safety_net_contract_drift_repair",
            version="1.0",
            description=(
                "A post-output missing read outcome is rejected and repaired by the edge "
                "Pydantic TypeAdapter."
            ),
            variant="hardened",
            fixture_preset="contract_drift",
            evaluate=_eval_contract_drift_repair,
        ),
    ),
)


__all__ = [
    "CompleteDocumentSummaryV1",
    "FileReadFailureV1",
    "FileReadSuccessV1",
    "GracefulDocumentFallbackV1",
    "SafetyNetHandoffV1",
    "SafetyNetInputV1",
    "SafetyNetOutputV1",
    "definition",
]
