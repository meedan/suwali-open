from unittest.mock import MagicMock, patch

import pytest

from app.core.cohere_semchunk_tokenizer import hf_tokenizer_repo_for_bedrock_cohere_embed
from app.core.config import Config
from app.core.constants import COHERE_MAX_EMBEDDING_CHARS
from app.services.text_splitter_factory import TextSplitterFactory


def test_hf_tokenizer_lookup_multilingual() -> None:
    assert (
        hf_tokenizer_repo_for_bedrock_cohere_embed("cohere.embed-multilingual-v3")
        == "Cohere/Cohere-embed-multilingual-v3.0"
    )


def test_hf_tokenizer_lookup_english() -> None:
    assert hf_tokenizer_repo_for_bedrock_cohere_embed("cohere.embed-english-v3") == "Cohere/Cohere-embed-english-v3.0"


def test_hf_tokenizer_lookup_unknown() -> None:
    assert hf_tokenizer_repo_for_bedrock_cohere_embed("cohere.embed-multilingual-v3-light") is None


def test_config_rejects_bedrock_cohere_semchunk_unknown_embed_id() -> None:
    with pytest.raises(ValueError, match="not supported for TEXT_SPLITTER=SEMCHUNK"):
        Config.model_validate(
            {
                "openai_api_key": "k",
                "redis_url": "redis://localhost:0",
                "embedding_model_provider": "BEDROCK_COHERE",
                "embedding_model_name": "cohere.embed-multilingual-v3-light",
                "text_splitter": "SEMCHUNK",
            }
        )


def test_config_rejects_bedrock_cohere_semchunk_with_semchunk_tokenizer_override() -> None:
    with pytest.raises(ValueError, match="semchunk_tokenizer_model_name must not be set"):
        Config.model_validate(
            {
                "openai_api_key": "k",
                "redis_url": "redis://localhost:0",
                "embedding_model_provider": "BEDROCK_COHERE",
                "embedding_model_name": "cohere.embed-multilingual-v3",
                "text_splitter": "SEMCHUNK",
                "semchunk_tokenizer_model_name": "some/other-model",
            }
        )


def test_config_accepts_bedrock_cohere_semchunk_supported() -> None:
    c = Config.model_validate(
        {
            "openai_api_key": "k",
            "redis_url": "redis://localhost:0",
            "embedding_model_provider": "BEDROCK_COHERE",
            "embedding_model_name": "cohere.embed-english-v3",
            "text_splitter": "SEMCHUNK",
        }
    )
    assert c.embedding_model_name == "cohere.embed-english-v3"


def test_config_rejects_bedrock_cohere_markdown_unknown_embed_id() -> None:
    with pytest.raises(ValueError, match="not supported for TEXT_SPLITTER=MARKDOWN"):
        Config.model_validate(
            {
                "openai_api_key": "k",
                "redis_url": "redis://localhost:0",
                "embedding_model_provider": "BEDROCK_COHERE",
                "embedding_model_name": "cohere.embed-multilingual-v3-light",
                "text_splitter": "MARKDOWN",
            }
        )


def test_config_accepts_bedrock_cohere_markdown_supported() -> None:
    c = Config.model_validate(
        {
            "openai_api_key": "k",
            "redis_url": "redis://localhost:0",
            "embedding_model_provider": "BEDROCK_COHERE",
            "embedding_model_name": "cohere.embed-english-v3",
            "text_splitter": "MARKDOWN",
        }
    )
    assert c.text_splitter == "MARKDOWN"


@patch("app.services.text_splitter_factory.SemchunkTextSplitterAdapter")
@patch("app.services.text_splitter_factory.Config")
def test_text_splitter_factory_bedrock_cohere_uses_cohere_hf_tokenizer(
    mock_config_cls: MagicMock, mock_adapter: MagicMock
) -> None:
    mock_adapter.return_value = MagicMock()
    mock_config = MagicMock()
    mock_config.text_splitter = "SEMCHUNK"
    mock_config.embedding_model_provider = "BEDROCK_COHERE"
    mock_config.embedding_model_name = "cohere.embed-multilingual-v3"
    mock_config.chunk_size = 300
    mock_config.chunk_overlap = 30
    mock_config.app_base = "/app/knowledge"
    mock_config_cls.return_value = mock_config

    TextSplitterFactory.get_text_splitter()

    mock_adapter.assert_called_once()
    call_kw = mock_adapter.call_args.kwargs
    assert call_kw["tokenizer_provider"] == "HUGGINGFACE"
    assert call_kw["model_name"] == "Cohere/Cohere-embed-multilingual-v3.0"
    assert call_kw["hf_cache_dir"] == "/app/knowledge/.models"
    assert call_kw["max_chunk_chars"] == COHERE_MAX_EMBEDDING_CHARS
