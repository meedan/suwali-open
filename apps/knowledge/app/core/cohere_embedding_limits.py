from app.core.constants import COHERE_MAX_EMBEDDING_CHARS

CHARS_PER_TOKEN_ESTIMATE = 5


def cohere_max_chars_for_chunk_config(chunk_size: int) -> int:
    return min(chunk_size * CHARS_PER_TOKEN_ESTIMATE, COHERE_MAX_EMBEDDING_CHARS)
