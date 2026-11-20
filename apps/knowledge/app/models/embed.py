from pydantic import BaseModel

from app.models.chat import ErrorType


class EmbedTextRequest(BaseModel):
    text: str


class EmbeddingResponse(BaseModel):
    embedding: list[float] | None = None
    error_type: ErrorType | None = None
