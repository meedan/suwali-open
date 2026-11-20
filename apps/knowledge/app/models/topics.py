from pydantic import BaseModel


class ExtractTopicsRequest(BaseModel):
    hub_id: int
    document_id: str = ""  # when text is empty, the already-ingested chunk text for this id is used
    text: str = ""  # optional override; when provided, topics are extracted from this text directly
    existing_topics: list[str] = []  # hub's canonical topics, offered to the extractor for reuse


class ExtractTopicsResponse(BaseModel):
    topics: list[str]
