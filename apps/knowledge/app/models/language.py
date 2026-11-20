from pydantic import BaseModel


class DetectLanguageRequest(BaseModel):
    text: str
    default_language: str | None = None
    supported_languages: list[str] = []


class DetectLanguageResponse(BaseModel):
    language: str | None
