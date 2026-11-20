from typing import Literal

from pydantic import BaseModel
from rq.job import JobStatus

from app.core.constants import DEFAULT_PRIORITY_TIER, DocumentType


class IndexDocumentRequest(BaseModel):
    hub_id: int
    document_id: str
    file_url: str
    text: str
    original_url: str = ""
    title: str = ""
    published_at: str = ""
    callback_url: str = ""
    priority_tier: int = DEFAULT_PRIORITY_TIER
    existing_topics: list[str] = []  # hub's canonical topics, offered to the extractor for reuse
    text_is_markdown: bool = False  # caller-asserted: `text` is authored Markdown (ignored when file_url is set)
    document_type: DocumentType | Literal[""] = ""  # CMS class (document / notebook / contribution)
    summary: str = ""  # written by a hub member to add context, prepended to the text (also when file_url is set)


class UpdateTopicsRequest(BaseModel):
    hub_id: int
    document_id: str
    topics: list[str]  # the document's full topic set; replaces whatever is stored


class JobStatusResponse(BaseModel):
    id: str
    status: JobStatus


class DeleteRequest(BaseModel):
    hub_id: int
    document_id: str
    callback_url: str = ""


class DeleteResponse(BaseModel):
    deleted: bool


class UpdateTopicsResponse(BaseModel):
    updated: bool
    error: str | None = None
