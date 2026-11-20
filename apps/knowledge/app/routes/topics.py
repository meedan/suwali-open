from fastapi import APIRouter
from loguru import logger

from app.core.config import Config
from app.core.llm_config import LLMConfig
from app.models.topics import ExtractTopicsRequest, ExtractTopicsResponse
from app.services.document import Document
from app.services.topic_extractor import TopicExtractor

router = APIRouter()


@router.post("/", response_model=ExtractTopicsResponse)
async def extract_topics(payload: ExtractTopicsRequest) -> ExtractTopicsResponse:
    """Extract topics without (re-)ingesting a document.

    Cheaper than /document/ (a single LLM call, no graph rebuild). Text comes from the
    request when provided, otherwise from the document's already-ingested chunks in Neo4j.
    Added to backfill topics onto documents ingested before the topics feature shipped.
    """
    text = payload.text
    if not text and payload.document_id:
        text = Document.read_ingested_text(payload.hub_id, payload.document_id)

    if not text:
        logger.info(
            f"No text available for document {payload.document_id} in hub {payload.hub_id}, returning no topics"
        )
        return ExtractTopicsResponse(topics=[])

    # extract() is best-effort and returns [] on LLM failures.
    topics = await TopicExtractor(config=Config(), llm_config=LLMConfig()).extract(text, payload.existing_topics)
    return ExtractTopicsResponse(topics=topics)
