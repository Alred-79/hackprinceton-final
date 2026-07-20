from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints

LOWERCASE_UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
SEMVER_2_PATTERN = (
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
RFC3339_UTC_PATTERN = (
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]*[1-9])?Z$"
)
PLAIN_DECIMAL_PATTERN = r"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$"
STABLE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$"


class StrictWireDTO(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", populate_by_name=False)


def validate_canonical_uuid_string(value: str) -> str:
    parsed = UUID(value)
    if str(parsed) != value:
        raise ValueError("UUID must be lowercase canonical hyphenated text")
    return value


def validate_canonical_semver_string(value: str) -> str:
    match = re.fullmatch(SEMVER_2_PATTERN, value)
    if not match:
        raise ValueError("invalid semantic version")
    prerelease = value.split("+", 1)[0].partition("-")[2]
    if prerelease:
        for identifier in prerelease.split("."):
            if identifier.isdigit() and len(identifier) > 1 and identifier.startswith("0"):
                raise ValueError("numeric prerelease identifiers cannot have leading zeroes")
    return value


def validate_canonical_utc_string(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise ValueError("invalid RFC3339 UTC timestamp") from exc
    if parsed.tzinfo != UTC:
        raise ValueError("timestamp must use UTC Z notation")
    if canonical_timestamp(parsed) != value:
        raise ValueError("timestamp is not canonical RFC3339 UTC text")
    return value


def validate_canonical_decimal_string(value: str) -> str:
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("invalid decimal") from exc
    if not parsed.is_finite() or parsed.is_zero() and value.startswith("-"):
        raise ValueError("decimal must be finite and cannot be negative zero")
    if canonical_decimal(parsed) != value:
        raise ValueError("decimal is not canonical plain-base-10 text")
    return value


WireUUID = Annotated[
    str,
    StringConstraints(pattern=LOWERCASE_UUID_PATTERN),
    AfterValidator(validate_canonical_uuid_string),
]
WireSemVer = Annotated[
    str,
    StringConstraints(pattern=SEMVER_2_PATTERN),
    AfterValidator(validate_canonical_semver_string),
]
WireSHA256 = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
WireTimestamp = Annotated[
    str,
    StringConstraints(pattern=RFC3339_UTC_PATTERN),
    AfterValidator(validate_canonical_utc_string),
]
WireDecimal = Annotated[
    str,
    StringConstraints(pattern=PLAIN_DECIMAL_PATTERN),
    AfterValidator(validate_canonical_decimal_string),
]
StableId = Annotated[str, StringConstraints(pattern=STABLE_ID_PATTERN)]


def canonical_decimal(value: Decimal) -> str:
    if not value.is_finite():
        raise ValueError("non-finite decimal")
    if value.is_zero():
        return "0"
    rendered = format(value, "f")
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    return rendered


def canonical_timestamp(value: datetime | None = None) -> str:
    current = (value or datetime.now(UTC)).astimezone(UTC)
    base = current.strftime("%Y-%m-%dT%H:%M:%S")
    if current.microsecond:
        return f"{base}.{current.microsecond:06d}".rstrip("0") + "Z"
    return base + "Z"


def _normalize_unicode(value: Any) -> Any:
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if isinstance(value, list):
        return [_normalize_unicode(item) for item in value]
    if isinstance(value, tuple):
        return [_normalize_unicode(item) for item in value]
    if isinstance(value, dict):
        normalized: dict[str, Any] = {}
        for key, item in value.items():
            normalized_key = unicodedata.normalize("NFC", key)
            if normalized_key in normalized:
                raise ValueError("Unicode normalization produced duplicate object keys")
            normalized[normalized_key] = _normalize_unicode(item)
        return normalized
    return value


def canonical_json(value: Any) -> str:
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    return json.dumps(
        _normalize_unicode(value),
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
