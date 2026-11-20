import sys
import time

from fastapi import APIRouter, HTTPException, status
from loguru import logger

from app.models.summarize import MAX_SUMMARIZE_CHARS, SummarizeMetadata, SummarizeRequest, SummarizeResponse
from app.services import language
from app.services.document import Document
from app.services.summarizer import Summarizer

router = APIRouter()


def _resolve_texts_from_document(payload: SummarizeRequest) -> list[str] | None:
    """Read the ingested text for payload.document_id; returns None when there's nothing to summarize."""
    text = Document.read_ingested_text(payload.hub_id, payload.document_id)

    if not text:
        logger.info(f"No text available for document {payload.document_id} in hub {payload.hub_id}, no summary")
        return None

    if len(text) > MAX_SUMMARIZE_CHARS:
        raise HTTPException(
            status_code=422,
            detail=f"Total character count ({len(text)}) exceeds maximum of 50,000 characters",
        )

    return [text]


@router.post("/", response_model=SummarizeResponse, status_code=200)
async def summarize(payload: SummarizeRequest) -> SummarizeResponse:
    start_time = time.perf_counter()

    texts: list[str] | None = payload.texts
    if not texts and payload.document_id:
        texts = _resolve_texts_from_document(payload)

    if not texts:
        return SummarizeResponse(summary="")

    texts_count = len(texts)
    total_chars = sum(len(text) for text in texts)

    logger.info(f"Summarization started: {texts_count} text(s), {total_chars} total characters")

    try:
        sample = "\n\n".join(texts)
        summary_language, confidence = await language.detect_text(sample)
        logger.info(f"Detected summarization language: {summary_language} (confidence: {confidence:.2f})")
        if not summary_language and payload.default_language:
            # Use the default language if no language was detected
            logger.info(f"No language detected, using default language: {payload.default_language}")
            summary_language = payload.default_language

        # Create summarizer and generate summary
        summarizer = Summarizer(texts, language=summary_language, markdown=True)
        summary = summarizer.run()

        # Calculate processing time
        processing_time = time.perf_counter() - start_time

        # Create metadata
        metadata = SummarizeMetadata(
            processing_time_seconds=round(processing_time, 2),
            texts_count=texts_count,
            total_characters=total_chars,
            summary_length=len(summary),
            language=summary_language,
        )

        logger.info(f"Summarization completed in {processing_time:.2f} seconds")

        return SummarizeResponse(summary=summary, metadata=metadata)

    except Exception as e:
        duration = time.perf_counter() - start_time
        logger.opt(exception=sys.exc_info()).error(f"Summarization failed after {duration:.2f} seconds: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Summarization failed: {str(e)}",
        )
