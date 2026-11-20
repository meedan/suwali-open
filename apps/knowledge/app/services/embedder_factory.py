import asyncio
import gc
import os
import time
from typing import Literal

from langchain_aws import BedrockEmbeddings
from loguru import logger
from neo4j_graphrag.embeddings.base import Embedder
from neo4j_graphrag.embeddings.openai import OpenAIEmbeddings
from neo4j_graphrag.embeddings.sentence_transformers import (
    SentenceTransformerEmbeddings,
)

from app.core.bedrock import get_bedrock_client
from app.core.config import (
    Config,
    embed_api_profile_matches_primary_embedding,
    resolved_embed_api_embedding_model_name,
    resolved_embed_api_embedding_provider,
)
from app.core.constants import COHERE_MAX_EMBEDDING_CHARS
from app.core.errors import EmbeddingTextTooLongError
from app.core.llm_config import LLMConfig


def _create_bedrock_embeddings(model_id: str) -> BedrockEmbeddings:
    start = time.perf_counter()
    logger.info(f"Using BEDROCK_COHERE model {model_id} for embedding")
    client = BedrockEmbeddings(
        client=get_bedrock_client(read_timeout_seconds=LLMConfig().llm_timeout_seconds),
        model_id=model_id,
    )
    duration = time.perf_counter() - start
    logger.info(f"Bedrock embedding client initialized in {duration:.2f} seconds")
    return client


def _create_legacy_embedder(
    *,
    app_base: str,
    embedding_model_provider: Literal["SBERT", "OPENAI", "BEDROCK_COHERE"],
    embedding_model_name: str,
) -> Embedder:
    models_dir = f"{app_base}/.models"
    os.makedirs(models_dir, exist_ok=True)
    sentence_transformer_config = {
        "device": "cpu",
        "trust_remote_code": False,
        "cache_folder": models_dir,
        "local_files_only": True,
        # avoid sporadic errors:
        # > Cannot copy out of meta tensor; no data! Please use torch.nn.Module.to_empty()
        # > instead of torch.nn.Module.to() when moving module from meta to a different device.
        # results in 2x ram usage for a short period during model load
        # see https://github.com/huggingface/transformers/issues/33326
        "model_kwargs": {"low_cpu_mem_usage": False},
    }
    model_name = embedding_model_name
    logger.info(f"Using {embedding_model_provider} model {model_name} for embedding")
    if embedding_model_provider == "OPENAI":
        return OpenAIEmbeddings(model=model_name, timeout=LLMConfig().llm_timeout_seconds)
    return SentenceTransformerEmbeddings(model=model_name, rate_limit_handler=None, **sentence_transformer_config)


def _validate_cohere_text_length(text: str) -> None:
    if len(text) > COHERE_MAX_EMBEDDING_CHARS:
        raise EmbeddingTextTooLongError(
            f"Text exceeds Cohere limit of {COHERE_MAX_EMBEDDING_CHARS} characters (got {len(text)})"
        )


class BedrockCohereIndexEmbedder(Embedder):
    """Chunk/index path: Cohere expects input_type=search_document; neo4j-graphrag calls embed_query on chunks."""

    def __init__(self, bedrock: BedrockEmbeddings) -> None:
        super().__init__()
        self._bedrock = bedrock

    def embed_query(self, text: str) -> list[float]:
        _validate_cohere_text_length(text)
        return self._bedrock.embed_documents([text])[0]

    async def async_embed_query(self, text: str) -> list[float]:
        return await asyncio.to_thread(self.embed_query, text)


class BedrockCohereQueryEmbedder(Embedder):
    """Query / HyDE path: Cohere expects input_type=search_query."""

    def __init__(self, bedrock: BedrockEmbeddings) -> None:
        super().__init__()
        self._bedrock = bedrock

    def embed_query(self, text: str) -> list[float]:
        _validate_cohere_text_length(text)
        return self._bedrock.embed_query(text)

    async def async_embed_query(self, text: str) -> list[float]:
        _validate_cohere_text_length(text)
        return await self._bedrock.aembed_query(text)


LegacyKey = tuple[str, str]


class EmbedderFactory:
    _bedrock_by_model_id: dict[str, BedrockEmbeddings] = {}
    _bedrock_index_embedder_by_model_id: dict[str, BedrockCohereIndexEmbedder] = {}
    _bedrock_query_embedder_by_model_id: dict[str, BedrockCohereQueryEmbedder] = {}
    _legacy_by_key: dict[LegacyKey, Embedder] = {}

    @classmethod
    def _get_bedrock_embeddings(cls, model_id: str) -> BedrockEmbeddings:
        if model_id not in cls._bedrock_by_model_id:
            cls._bedrock_by_model_id[model_id] = _create_bedrock_embeddings(model_id)
        return cls._bedrock_by_model_id[model_id]

    @classmethod
    def _get_bedrock_index_embedder_for_model(cls, model_id: str) -> Embedder:
        if model_id not in cls._bedrock_index_embedder_by_model_id:
            bedrock = cls._get_bedrock_embeddings(model_id)
            cls._bedrock_index_embedder_by_model_id[model_id] = BedrockCohereIndexEmbedder(bedrock)
            logger.debug("Cohere document embedder initialized")
        return cls._bedrock_index_embedder_by_model_id[model_id]

    @classmethod
    def _get_bedrock_query_embedder_for_model(cls, model_id: str) -> Embedder:
        if model_id not in cls._bedrock_query_embedder_by_model_id:
            bedrock = cls._get_bedrock_embeddings(model_id)
            cls._bedrock_query_embedder_by_model_id[model_id] = BedrockCohereQueryEmbedder(bedrock)
            logger.debug("Cohere query embedder initialized")
        return cls._bedrock_query_embedder_by_model_id[model_id]

    @classmethod
    def _get_legacy_embedder_for_key(
        cls,
        config: Config,
        *,
        provider: Literal["SBERT", "OPENAI", "BEDROCK_COHERE"],
        model_name: str,
    ) -> Embedder:
        key: LegacyKey = (provider, model_name)
        if key not in cls._legacy_by_key:
            cls._legacy_by_key[key] = _create_legacy_embedder(
                app_base=config.app_base,
                embedding_model_provider=provider,
                embedding_model_name=model_name,
            )
        return cls._legacy_by_key[key]

    @classmethod
    def get_embedder(cls, *, purpose: Literal["index", "query"] = "query") -> Embedder:
        start_time = time.perf_counter()
        config = Config()

        if config.embedding_model_provider == "BEDROCK_COHERE":
            logger.debug("Initializing Cohere embedder")
            model_id = config.embedding_model_name
            if purpose == "index":
                return cls._get_bedrock_index_embedder_for_model(model_id)
            return cls._get_bedrock_query_embedder_for_model(model_id)

        embedder = cls._get_legacy_embedder_for_key(
            config,
            provider=config.embedding_model_provider,
            model_name=config.embedding_model_name,
        )
        duration = time.perf_counter() - start_time
        logger.info(f"Embedder {type(embedder).__name__} loaded in {duration:.2f} seconds")
        return embedder

    @classmethod
    def get_embed_api_embedder(cls) -> Embedder:
        config = Config()
        if embed_api_profile_matches_primary_embedding(config):
            if config.embedding_model_provider == "BEDROCK_COHERE":
                return cls.get_embedder(purpose="index")
            return cls.get_embedder(purpose="query")

        api_provider = resolved_embed_api_embedding_provider(config)
        api_name = resolved_embed_api_embedding_model_name(config)
        if api_provider == "BEDROCK_COHERE":
            return cls._get_bedrock_index_embedder_for_model(api_name)
        return cls._get_legacy_embedder_for_key(config, provider=api_provider, model_name=api_name)

    @classmethod
    def cleanup(cls) -> None:
        for legacy in cls._legacy_by_key.values():
            if hasattr(legacy, "model"):
                if hasattr(legacy.model, "cpu"):
                    legacy.model.cpu()

                if hasattr(legacy.model, "_modules"):
                    legacy.model._modules.clear()

        cls._bedrock_by_model_id.clear()
        cls._bedrock_index_embedder_by_model_id.clear()
        cls._bedrock_query_embedder_by_model_id.clear()
        cls._legacy_by_key.clear()
        gc.collect()
