from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.core.cohere_semchunk_tokenizer import hf_tokenizer_repo_for_bedrock_cohere_embed
from app.core.config import Config
from app.core.constants import COHERE_MAX_EMBEDDING_CHARS
from app.core.errors import EmbeddingTextTooLongError
from app.services.embedder_factory import BedrockCohereIndexEmbedder
from app.services.semchunk_splitter_adapter import SemchunkTextSplitterAdapter

FIXTURE = Path(__file__).parent / "data" / "markitdown-pdf-kasur-style.txt"
COHERE_EMBED_MODEL = "cohere.embed-multilingual-v3"

CHUNK_CONFIGS = [
    pytest.param(500, 100, id="prod-like"),
    pytest.param(
        Config.model_fields["chunk_size"].get_default(),
        Config.model_fields["chunk_overlap"].get_default(),
        id="config-default",
    ),
    pytest.param(Config().chunk_size, Config().chunk_overlap, id="env-configured"),
]


def _hf_cache_dir() -> Path:
    return Path(__file__).resolve().parents[1] / ".models"


def _cohere_semchunk_splitter(chunk_size: int, chunk_overlap: int) -> SemchunkTextSplitterAdapter:
    hf_repo = hf_tokenizer_repo_for_bedrock_cohere_embed(COHERE_EMBED_MODEL)
    assert hf_repo is not None
    return SemchunkTextSplitterAdapter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        tokenizer_provider="HUGGINGFACE",
        model_name=hf_repo,
        hf_cache_dir=str(_hf_cache_dir()),
        max_chunk_chars=COHERE_MAX_EMBEDDING_CHARS,
    )


@pytest.mark.parametrize("chunk_size, chunk_overlap", CHUNK_CONFIGS)
def test_markitdown_pdf_fixture_chunks_fit_cohere_char_limit(chunk_size: int, chunk_overlap: int) -> None:
    text = FIXTURE.read_text(encoding="utf-8")
    chunks = _cohere_semchunk_splitter(chunk_size, chunk_overlap).split_text(text)
    assert chunks, "fixture should produce at least one chunk"

    oversize = [(index, len(chunk)) for index, chunk in enumerate(chunks) if len(chunk) > COHERE_MAX_EMBEDDING_CHARS]
    assert not oversize, (
        f"chunks must be <= {COHERE_MAX_EMBEDDING_CHARS} chars for Cohere embed; oversize chunk(s): {oversize}"
    )


@pytest.mark.parametrize("chunk_size, chunk_overlap", CHUNK_CONFIGS)
def test_markitdown_pdf_fixture_chunks_pass_bedrock_cohere_validation(chunk_size: int, chunk_overlap: int) -> None:
    text = FIXTURE.read_text(encoding="utf-8")
    chunks = _cohere_semchunk_splitter(chunk_size, chunk_overlap).split_text(text)
    embedder = BedrockCohereIndexEmbedder(bedrock=MagicMock())

    for index, chunk in enumerate(chunks):
        try:
            embedder.embed_query(chunk)
        except EmbeddingTextTooLongError as exc:
            pytest.fail(f"chunk {index} ({len(chunk)} chars) failed Cohere validation: {exc}")
