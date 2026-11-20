import os
from typing import Generator
from unittest.mock import MagicMock, patch

import pytest

from app.core.config import (
    Config,
    embed_api_profile_matches_primary_embedding,
    resolved_embed_api_embedding_model_name,
    resolved_embed_api_embedding_provider,
    resolved_embed_api_vector_dimensions,
    resolved_embedding_vector_dimensions,
)
from app.core.constants import COHERE_MAX_EMBEDDING_CHARS
from app.core.errors import EmbeddingTextTooLongError
from app.core.llm_config import LLMConfig
from app.services.embedder_factory import (
    BedrockCohereIndexEmbedder,
    BedrockCohereQueryEmbedder,
    EmbedderFactory,
)


@pytest.fixture(autouse=True)
def reset_embedder_factory() -> Generator[None, None]:
    EmbedderFactory.cleanup()
    yield
    EmbedderFactory.cleanup()


def test_resolved_embedding_dimensions_defaults() -> None:
    assert (
        resolved_embedding_vector_dimensions(
            Config.model_validate(
                {
                    "openai_api_key": "k",
                    "redis_url": "redis://localhost:0",
                    "embedding_model_provider": "SBERT",
                    "embedding_vector_dimensions": None,
                }
            )
        )
        == 768
    )
    assert (
        resolved_embedding_vector_dimensions(
            Config.model_validate(
                {
                    "openai_api_key": "k",
                    "redis_url": "redis://localhost:0",
                    "embedding_model_provider": "OPENAI",
                    "embedding_vector_dimensions": None,
                }
            )
        )
        == 1536
    )
    assert (
        resolved_embedding_vector_dimensions(
            Config.model_validate(
                {
                    "openai_api_key": "k",
                    "redis_url": "redis://localhost:0",
                    "embedding_model_provider": "BEDROCK_COHERE",
                    "embedding_model_name": "cohere.embed-multilingual-v3",
                    "embedding_vector_dimensions": None,
                }
            )
        )
        == 1024
    )
    assert (
        resolved_embedding_vector_dimensions(
            Config.model_validate(
                {
                    "openai_api_key": "k",
                    "redis_url": "redis://localhost:0",
                    "embedding_model_provider": "SBERT",
                    "embedding_vector_dimensions": 512,
                }
            )
        )
        == 512
    )


@patch.dict(
    os.environ,
    {"EMBEDDING_MODEL_PROVIDER": "SBERT", "EMBEDDING_MODEL_NAME": "sentence-transformers/all-mpnet-base-v2"},
    clear=False,
)
@patch("app.services.embedder_factory.SentenceTransformerEmbeddings")
def test_sbert_same_instance_for_both_purposes(mock_st: MagicMock) -> None:
    mock_st.return_value = MagicMock()
    a = EmbedderFactory.get_embedder(purpose="index")
    b = EmbedderFactory.get_embedder(purpose="query")
    assert a is b


@patch.dict(
    os.environ,
    {"EMBEDDING_MODEL_PROVIDER": "BEDROCK_COHERE", "EMBEDDING_MODEL_NAME": "cohere.embed-multilingual-v3"},
    clear=False,
)
@patch("app.services.embedder_factory.get_bedrock_client")
@patch("app.services.embedder_factory.BedrockEmbeddings")
def test_bedrock_cohere_index_uses_embed_documents(mock_bedrock_cls: MagicMock, mock_client: MagicMock) -> None:
    mock_bedrock = MagicMock()
    mock_bedrock.embed_documents.return_value = [[0.1, 0.2, 0.3]]
    mock_bedrock_cls.return_value = mock_bedrock

    idx = EmbedderFactory.get_embedder(purpose="index")
    assert isinstance(idx, BedrockCohereIndexEmbedder)
    out = idx.embed_query("chunk text")
    assert out == [0.1, 0.2, 0.3]
    mock_bedrock.embed_documents.assert_called_once_with(["chunk text"])
    mock_bedrock.embed_query.assert_not_called()


@patch.dict(
    os.environ,
    {"EMBEDDING_MODEL_PROVIDER": "BEDROCK_COHERE", "EMBEDDING_MODEL_NAME": "cohere.embed-multilingual-v3"},
    clear=False,
)
@patch("app.services.embedder_factory.get_bedrock_client")
@patch("app.services.embedder_factory.BedrockEmbeddings")
def test_bedrock_cohere_query_uses_embed_query(mock_bedrock_cls: MagicMock, mock_client: MagicMock) -> None:
    mock_bedrock = MagicMock()
    mock_bedrock.embed_query.return_value = [0.4, 0.5]
    mock_bedrock_cls.return_value = mock_bedrock

    q = EmbedderFactory.get_embedder(purpose="query")
    assert isinstance(q, BedrockCohereQueryEmbedder)
    out = q.embed_query("user query")
    assert out == [0.4, 0.5]
    mock_bedrock.embed_query.assert_called_once_with("user query")
    mock_bedrock.embed_documents.assert_not_called()


@patch.dict(
    os.environ,
    {"EMBEDDING_MODEL_PROVIDER": "BEDROCK_COHERE", "EMBEDDING_MODEL_NAME": "cohere.embed-multilingual-v3"},
    clear=False,
)
@patch("app.services.embedder_factory.get_bedrock_client")
@patch("app.services.embedder_factory.BedrockEmbeddings")
def test_bedrock_embeddings_uses_configured_timeout(mock_bedrock_cls: MagicMock, mock_client: MagicMock) -> None:
    mock_bedrock_cls.return_value = MagicMock()

    EmbedderFactory.get_embedder(purpose="query")

    mock_client.assert_called_once_with(read_timeout_seconds=LLMConfig().llm_timeout_seconds)


@patch.dict(
    os.environ,
    {"EMBEDDING_MODEL_PROVIDER": "OPENAI", "EMBEDDING_MODEL_NAME": "text-embedding-3-small"},
    clear=False,
)
@patch("app.services.embedder_factory.OpenAIEmbeddings")
def test_openai_embeddings_uses_configured_timeout(mock_openai_embeddings: MagicMock) -> None:
    mock_openai_embeddings.return_value = MagicMock()

    EmbedderFactory.get_embedder(purpose="query")

    mock_openai_embeddings.assert_called_once_with(
        model="text-embedding-3-small", timeout=LLMConfig().llm_timeout_seconds
    )


def test_resolved_embed_api_inherits_primary_when_unset() -> None:
    c = Config.model_validate(
        {
            "openai_api_key": "k",
            "redis_url": "redis://localhost:0",
            "embedding_model_provider": "OPENAI",
            "embedding_model_name": "text-embedding-3-small",
            "embedding_vector_dimensions": None,
            "embed_api_embedding_vector_dimensions": None,
        }
    )
    assert resolved_embed_api_embedding_provider(c) == "OPENAI"
    assert resolved_embed_api_embedding_model_name(c) == "text-embedding-3-small"
    assert resolved_embed_api_vector_dimensions(c) == 1536
    assert embed_api_profile_matches_primary_embedding(c) is True


def test_resolved_embed_api_partial_override() -> None:
    c = Config.model_validate(
        {
            "openai_api_key": "k",
            "redis_url": "redis://localhost:0",
            "embedding_model_provider": "SBERT",
            "embedding_model_name": "sentence-transformers/all-mpnet-base-v2",
            "embed_api_embedding_model_name": "other/model",
        }
    )
    assert resolved_embed_api_embedding_provider(c) == "SBERT"
    assert resolved_embed_api_embedding_model_name(c) == "other/model"
    assert embed_api_profile_matches_primary_embedding(c) is False


@patch.dict(
    os.environ,
    {"EMBEDDING_MODEL_PROVIDER": "BEDROCK_COHERE", "EMBEDDING_MODEL_NAME": "cohere.embed-multilingual-v3"},
    clear=False,
)
@patch("app.services.embedder_factory.get_bedrock_client")
@patch("app.services.embedder_factory.BedrockEmbeddings")
def test_embed_api_matches_primary_bedrock_reuses_index_embedder(
    mock_bedrock_cls: MagicMock, mock_client: MagicMock
) -> None:
    mock_bedrock = MagicMock()
    mock_bedrock.embed_documents.return_value = [[0.1, 0.2]]
    mock_bedrock_cls.return_value = mock_bedrock

    idx = EmbedderFactory.get_embedder(purpose="index")
    api = EmbedderFactory.get_embed_api_embedder()
    assert api is idx
    out = api.embed_query("x")
    assert out == [0.1, 0.2]
    mock_bedrock.embed_documents.assert_called_with(["x"])


@patch.dict(
    os.environ,
    {
        "EMBEDDING_MODEL_PROVIDER": "BEDROCK_COHERE",
        "EMBEDDING_MODEL_NAME": "cohere.embed-multilingual-v3",
        "EMBED_API_EMBEDDING_MODEL_NAME": "cohere.embed-english-v3",
    },
    clear=False,
)
@patch("app.services.embedder_factory.get_bedrock_client")
@patch("app.services.embedder_factory.BedrockEmbeddings")
def test_embed_api_distinct_bedrock_model_separate_index_embedder(
    mock_bedrock_cls: MagicMock, mock_client: MagicMock
) -> None:
    mocks: list[MagicMock] = []

    def new_bedrock(*args: object, **kwargs: object) -> MagicMock:
        m = MagicMock()
        m.embed_documents.return_value = [[1.0, 2.0]]
        mocks.append(m)
        return m

    mock_bedrock_cls.side_effect = new_bedrock

    primary_idx = EmbedderFactory.get_embedder(purpose="index")
    api = EmbedderFactory.get_embed_api_embedder()
    assert primary_idx is not api
    assert isinstance(api, BedrockCohereIndexEmbedder)
    assert api.embed_query("t") == [1.0, 2.0]
    assert len(mocks) == 2
    assert mock_bedrock_cls.call_args_list[0].kwargs["model_id"] == "cohere.embed-multilingual-v3"
    assert mock_bedrock_cls.call_args_list[1].kwargs["model_id"] == "cohere.embed-english-v3"


@patch.dict(
    os.environ,
    {"EMBEDDING_MODEL_PROVIDER": "SBERT", "EMBEDDING_MODEL_NAME": "sentence-transformers/all-mpnet-base-v2"},
    clear=False,
)
@patch("app.services.embedder_factory.SentenceTransformerEmbeddings")
def test_embed_api_matches_primary_legacy_reuses_query_embedder(mock_st: MagicMock) -> None:
    mock_st.return_value = MagicMock()
    q = EmbedderFactory.get_embedder(purpose="query")
    api = EmbedderFactory.get_embed_api_embedder()
    assert api is q


class TestBedrockCohereQueryEmbedderLengthValidation:
    def test_query_embedder_accepts_text_under_limit(self) -> None:
        mock_bedrock = MagicMock()
        mock_bedrock.embed_query.return_value = [0.1, 0.2, 0.3]
        embedder = BedrockCohereQueryEmbedder(mock_bedrock)

        result = embedder.embed_query("short text")
        assert result == [0.1, 0.2, 0.3]
        mock_bedrock.embed_query.assert_called_once_with("short text")

    def test_query_embedder_rejects_text_over_limit(self) -> None:
        mock_bedrock = MagicMock()
        embedder = BedrockCohereQueryEmbedder(mock_bedrock)
        long_text = "x" * (COHERE_MAX_EMBEDDING_CHARS + 1)

        with pytest.raises(EmbeddingTextTooLongError) as exc_info:
            embedder.embed_query(long_text)

        assert "2048" in str(exc_info.value)
        assert str(COHERE_MAX_EMBEDDING_CHARS + 1) in str(exc_info.value)
        mock_bedrock.embed_query.assert_not_called()

    def test_query_embedder_accepts_text_at_exact_limit(self) -> None:
        mock_bedrock = MagicMock()
        mock_bedrock.embed_query.return_value = [0.5]
        embedder = BedrockCohereQueryEmbedder(mock_bedrock)
        text_at_limit = "x" * COHERE_MAX_EMBEDDING_CHARS

        result = embedder.embed_query(text_at_limit)
        assert result == [0.5]
        mock_bedrock.embed_query.assert_called_once()

    @pytest.mark.asyncio
    async def test_async_query_embedder_rejects_text_over_limit(self) -> None:
        mock_bedrock = MagicMock()
        embedder = BedrockCohereQueryEmbedder(mock_bedrock)
        long_text = "x" * (COHERE_MAX_EMBEDDING_CHARS + 1)

        with pytest.raises(EmbeddingTextTooLongError):
            await embedder.async_embed_query(long_text)


class TestBedrockCohereIndexEmbedderLengthValidation:
    def test_index_embedder_accepts_text_under_limit(self) -> None:
        mock_bedrock = MagicMock()
        mock_bedrock.embed_documents.return_value = [[0.1, 0.2]]
        embedder = BedrockCohereIndexEmbedder(mock_bedrock)

        result = embedder.embed_query("short chunk")
        assert result == [0.1, 0.2]
        mock_bedrock.embed_documents.assert_called_once_with(["short chunk"])

    def test_index_embedder_rejects_text_over_limit(self) -> None:
        mock_bedrock = MagicMock()
        embedder = BedrockCohereIndexEmbedder(mock_bedrock)
        long_text = "x" * (COHERE_MAX_EMBEDDING_CHARS + 1)

        with pytest.raises(EmbeddingTextTooLongError) as exc_info:
            embedder.embed_query(long_text)

        assert "2048" in str(exc_info.value)
        mock_bedrock.embed_documents.assert_not_called()
