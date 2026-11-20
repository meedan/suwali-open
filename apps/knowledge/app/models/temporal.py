from __future__ import annotations

import re
from enum import StrEnum

from loguru import logger
from pydantic import BaseModel, Field, field_validator


class TemporalType(StrEnum):
    NONE = "none"
    RECENCY = "recency"
    POINT_IN_TIME = "point_in_time"


class TemporalPrecision(StrEnum):
    YEAR = "year"
    MONTH = "month"
    DAY = "day"


_YEAR_RE = re.compile(r"^\d{4}$")
_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
_REFERENCE_DATE_RE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")


class TemporalContext(BaseModel):
    type: TemporalType = TemporalType.NONE
    reference_date: str | None = Field(
        default=None,
        description='Variable-precision date: "YYYY", "YYYY-MM", or "YYYY-MM-DD". None means "now".',
    )
    recency_window_days: int | None = Field(
        default=None,
        description=(
            "When type is RECENCY: optional hard filter for the last N calendar days ending today (inclusive). "
            "1 = today only, 7 = last seven days including today, 30 ~ last month. "
            "Null = no hard window (soft recency decay only)."
        ),
    )
    confidence: float = 0.0

    @field_validator("recency_window_days")
    @classmethod
    def _clamp_window(cls, v: int | None) -> int | None:
        if v is None:
            return None
        if v < 1:
            return None
        return min(v, 366)

    @field_validator("reference_date")
    @classmethod
    def _validate_reference_date(cls, v: str | None) -> str | None:
        # llm output is untrusted and flows into a Cypher datetime() literal built by
        # string interpolation (dual_retriever._cypher_datetime_literal) - anything but
        # a plausible "YYYY" / "YYYY-MM" / "YYYY-MM-DD" shape must not leak downstream.
        if v is None:
            return None
        if not _REFERENCE_DATE_RE.match(v):
            logger.warning(f"LLM returned invalid temporal reference_date: {v!r}, discarding")
            return None
        return v

    @property
    def precision(self) -> TemporalPrecision | None:
        if not self.reference_date:
            return None
        if _YEAR_RE.match(self.reference_date):
            return TemporalPrecision.YEAR
        if _MONTH_RE.match(self.reference_date):
            return TemporalPrecision.MONTH
        return TemporalPrecision.DAY

    @property
    def reference_date_full(self) -> str | None:
        """Normalize to YYYY-MM-DD for use in Cypher ``datetime()``."""
        if not self.reference_date:
            return None
        match self.precision:
            case TemporalPrecision.YEAR:
                return f"{self.reference_date}-07-01"
            case TemporalPrecision.MONTH:
                return f"{self.reference_date}-15"
            case _:
                return self.reference_date
