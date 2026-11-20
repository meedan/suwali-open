import os

import nltk
from langchain_text_splitters.nltk import NLTKTextSplitter
from neo4j_graphrag.components.text_splitters.base import TextSplitter
from neo4j_graphrag.components.text_splitters.fixed_size_splitter import (
    FixedSizeSplitter,
)
from neo4j_graphrag.components.text_splitters.langchain import LangChainTextSplitterAdapter

from app.core.cohere_semchunk_tokenizer import hf_tokenizer_repo_for_bedrock_cohere_embed
from app.core.config import Config
from app.core.constants import COHERE_MAX_EMBEDDING_CHARS
from app.core.llm_config import LLMConfig
from app.services.markdown_splitter import MarkdownStructureSplitter
from app.services.semchunk_splitter_adapter import SemchunkTextSplitterAdapter

config = Config()
models_dir = f"{config.app_base}/.models"
os.makedirs(models_dir, exist_ok=True)
if models_dir not in nltk.data.path:
    nltk.data.path.append(models_dir)


class TextSplitterFactory:
    @classmethod
    def get_text_splitter(cls, text_is_markdown: bool = False) -> TextSplitter:
        config = Config()
        llm_config = LLMConfig()
        text_splitter: TextSplitter
        if config.text_splitter == "NLTK":
            nltk_splitter = NLTKTextSplitter(
                chunk_size=config.chunk_size,
                chunk_overlap=config.chunk_overlap,
            )
            text_splitter = LangChainTextSplitterAdapter(nltk_splitter)
        elif config.text_splitter == "SEMCHUNK":
            text_splitter = cls._build_semchunk_adapter(config, llm_config)
        elif config.text_splitter == "MARKDOWN":
            # the structure-aware splitter only benefits actual Markdown (MarkItDown
            # conversions); plain text falls back to the semchunk adapter it wraps
            if text_is_markdown:
                text_splitter = MarkdownStructureSplitter(
                    inner=cls._build_semchunk_adapter(config, llm_config),
                    chunk_size=config.chunk_size,
                    breadcrumbs=config.markdown_splitter_breadcrumbs,
                )
            else:
                text_splitter = cls._build_semchunk_adapter(config, llm_config)
        else:
            text_splitter = FixedSizeSplitter(
                chunk_size=config.chunk_size,
                chunk_overlap=config.chunk_overlap,
            )

        return text_splitter

    @classmethod
    def _build_semchunk_adapter(cls, config: Config, llm_config: LLMConfig) -> SemchunkTextSplitterAdapter:
        hf_cache_dir = f"{config.app_base}/.models"
        if config.embedding_model_provider == "BEDROCK_COHERE":
            cohere_hf = hf_tokenizer_repo_for_bedrock_cohere_embed(config.embedding_model_name)
            if cohere_hf is None:
                raise ValueError(
                    f"embedding_model_name {config.embedding_model_name!r} has no paired Cohere HF tokenizer for semchunk"
                )
            return SemchunkTextSplitterAdapter(
                chunk_size=config.chunk_size,
                chunk_overlap=config.chunk_overlap,
                tokenizer_provider="HUGGINGFACE",
                model_name=cohere_hf,
                hf_cache_dir=hf_cache_dir,
                max_chunk_chars=COHERE_MAX_EMBEDDING_CHARS,
            )

        # if a specific tokenizer model is not configured, default to:
        #   - the configured OpenAI model when using tiktoken as the tokenizer
        #   - the configured embedding model when using a huggingface tokenizer
        if config.semchunk_tokenizer_model_name:
            model_name = config.semchunk_tokenizer_model_name
        elif config.semchunk_tokenizer_provider == "TIKTOKEN":
            model_name = llm_config.openai_model
        else:
            model_name = config.embedding_model_name

        return SemchunkTextSplitterAdapter(
            chunk_size=config.chunk_size,
            chunk_overlap=config.chunk_overlap,
            tokenizer_provider=config.semchunk_tokenizer_provider,
            model_name=model_name,
            hf_cache_dir=hf_cache_dir if config.semchunk_tokenizer_provider == "HUGGINGFACE" else None,
        )
