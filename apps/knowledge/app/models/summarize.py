from typing import Self

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_SUMMARIZE_CHARS = 50000


class SummarizeRequest(BaseModel):
    texts: list[str] = Field(
        default=[],
        description="List of texts to summarize (max 100 items, 50K chars total)",
        min_length=1,
        max_length=100,
    )
    hub_id: int = Field(default=0, description="Required with document_id, to scope the Neo4j read")
    document_id: str = Field(
        default="", description="When texts is empty, the already-ingested chunk text for this id is used"
    )
    default_language: str | None = Field(
        default=None,
        description="ISO 639-1 language code to write the summary in. If omitted, the language is detected from the texts.",
    )

    @field_validator("texts")
    @classmethod
    def validate_texts(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("texts list cannot be empty")

        # Check total character count across all texts
        total_chars = sum(len(text) for text in v)
        if total_chars > MAX_SUMMARIZE_CHARS:
            raise ValueError(f"Total character count ({total_chars}) exceeds maximum of 50,000 characters")

        # Check that no individual text is empty
        if any(not text.strip() for text in v):
            raise ValueError("texts list cannot contain empty strings")

        return v

    @model_validator(mode="after")
    def validate_document_id_requires_hub_id(self) -> Self:
        if self.document_id and not self.hub_id:
            raise ValueError("hub_id is required when document_id is set")
        return self


class SummarizeMetadata(BaseModel):
    processing_time_seconds: float | None = None
    texts_count: int | None = None
    total_characters: int | None = None
    summary_length: int | None = None
    language: str | None = None


class SummarizeResponse(BaseModel):
    summary: str
    metadata: SummarizeMetadata | None = None
