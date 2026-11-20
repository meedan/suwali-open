import time

from fastapi import APIRouter, Depends, Response, status
from loguru import logger
from neo4j_graphrag.embeddings.base import Embedder

from app.core.cohere_embedding_limits import cohere_max_chars_for_chunk_config
from app.core.config import Config
from app.core.errors import EmbeddingTextTooLongError
from app.models.chat import ErrorType
from app.models.embed import EmbeddingResponse, EmbedTextRequest
from app.services.embedder_factory import EmbedderFactory

router = APIRouter()


def _get_embed_api_embedder() -> Embedder:
    return EmbedderFactory.get_embed_api_embedder()


def _get_max_text_length() -> int:
    config = Config()
    return cohere_max_chars_for_chunk_config(config.chunk_size)


@router.post("/")
async def embed_text(
    payload: EmbedTextRequest, response: Response, embedder: Embedder = Depends(_get_embed_api_embedder)
) -> EmbeddingResponse:
    max_length = _get_max_text_length()
    if len(payload.text) > max_length:
        logger.warning(f"Embed request rejected: text too long ({len(payload.text)} > {max_length} chars)")
        response.status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
        return EmbeddingResponse(error_type=ErrorType.QUESTION_TOO_LONG)

    try:
        start_time = time.perf_counter()
        embedding = embedder.embed_query(payload.text)
        elapsed_sec = time.perf_counter() - start_time
        logger.debug(f"Embedding completed in {elapsed_sec} seconds")
        return EmbeddingResponse(embedding=embedding)
    except EmbeddingTextTooLongError as e:
        logger.warning(f"Embed request failed: {e}")
        response.status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
        return EmbeddingResponse(error_type=ErrorType.QUESTION_TOO_LONG)
