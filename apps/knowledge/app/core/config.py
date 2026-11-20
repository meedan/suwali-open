import json
import os
from pathlib import Path
from typing import Any, Literal, Self

from dotenv import dotenv_values
from loguru import logger
from pydantic import BaseModel, ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# fmt: off
# ISO 639-1 language codes
# it would be nicer if this was in the language module, but then we'd have circular imports...
# if more consts start to pile up here, we should extract them to a separate module in core
# that will have no dependencies of its own and so could then be imported here and elsewhere
VALID_LANGUAGE_CODES = frozenset({
    "aa", "ab", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az",
    "ba", "be", "bg", "bh", "bi", "bm", "bn", "bo", "br", "bs",
    "ca", "ce", "ch", "co", "cr", "cs", "cu", "cv", "cy",
    "da", "de", "dv", "dz",
    "ee", "el", "en", "eo", "es", "et", "eu",
    "fa", "ff", "fi", "fj", "fo", "fr", "fy",
    "ga", "gd", "gl", "gn", "gu", "gv",
    "ha", "he", "hi", "ho", "hr", "ht", "hu", "hy", "hz",
    "ia", "id", "ie", "ig", "ii", "ik", "io", "is", "it", "iu",
    "ja", "jv",
    "ka", "kg", "ki", "kj", "kk", "kl", "km", "kn", "ko", "kr", "ks", "ku", "kv", "kw", "ky",
    "la", "lb", "lg", "li", "ln", "lo", "lt", "lu", "lv",
    "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my",
    "na", "nb", "nd", "ne", "ng", "nl", "nn", "no", "nr", "nv", "ny",
    "oc", "oj", "om", "or", "os",
    "pa", "pi", "pl", "ps", "pt",
    "qu",
    "rm", "rn", "ro", "ru", "rw",
    "sa", "sc", "sd", "se", "sg", "si", "sk", "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw",
    "ta", "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt", "tw", "ty",
    "ug", "uk", "ur", "uz",
    "ve", "vi", "vo",
    "wa", "wo",
    "xh",
    "yi", "yo",
    "za", "zh", "zu",
})
# fmt: on


class Neo4jConfig(BaseModel):
    uri: str
    username: str
    password: str


def dotenv_files() -> tuple[str, ...]:
    """`.env`, plus `.env.{DEPLOY_ENV}` when DEPLOY_ENV is set; missing files are skipped by pydantic-settings."""
    deploy_env = dotenv_values(".env").get("DEPLOY_ENV") or os.getenv("DEPLOY_ENV")
    return (".env", f".env.{deploy_env}") if deploy_env else (".env",)


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file=dotenv_files(), extra="ignore")

    # Base path for the application (project root)
    app_base: str = str(Path(__file__).parent.parent.parent.resolve())

    deploy_env: str = "local"
    knowledge_api_port: int = 8000
    openai_api_key: str
    # SBERT, OPENAI, or BEDROCK_COHERE — vector length varies; see resolved_embedding_vector_dimensions()
    embedding_model_provider: Literal["SBERT", "OPENAI", "BEDROCK_COHERE"] = "SBERT"
    embedding_model_name: str = "all-mpnet-base-v2"
    # When unset, dimensions default from the provider (768 SBERT, 1536 OPENAI, 1024 BEDROCK_COHERE)
    embedding_vector_dimensions: int | None = None

    # Optional overrides for POST /embed only (clustering, CMS message embeddings). Unset fields inherit primary embedding_* above.
    embed_api_embedding_model_provider: Literal["SBERT", "OPENAI", "BEDROCK_COHERE"] | None = None
    embed_api_embedding_model_name: str | None = None
    embed_api_embedding_vector_dimensions: int | None = None

    text_splitter: Literal["NLTK", "FIXED_SIZE", "SEMCHUNK", "MARKDOWN"] = "SEMCHUNK"
    chunk_size: int = 400
    chunk_overlap: int = 40

    # pre-ingestion validation: reject documents whose extracted text exceeds this many tokens
    # (cl100k_base). default is sized from a known-good case: a 60-page text-only .docx (~35k tokens)
    # worked well in production, so 50k leaves comfortable headroom.
    max_text_ingestion_size: int = 50000

    # semchunk requires a tokenizer to perform semantic chunking
    # tiktoken tokenizer works only with OpenAI models
    # the MARKDOWN splitter also uses these settings for its inner semchunk adapter
    semchunk_tokenizer_provider: Literal["TIKTOKEN", "HUGGINGFACE"] = "TIKTOKEN"
    semchunk_tokenizer_model_name: str | None = None

    # MARKDOWN splitter: prepend the heading path (e.g. "H1 > H2") to each chunk
    markdown_splitter_breadcrumbs: bool = True

    retriever_top_k: int = 5
    retriever_document_limit: int = 100
    retriever_chunk_limit: int = 200
    retriever_relationship_limit: int = 500
    # ablation switch for A/B evals: when off, retrieval context contains only chunk
    # texts and no `=== kg_rels ===` section (and skips the entity-graph traversal)
    retriever_kg_rels_enabled: bool = True
    retriever_chunk_truncate_chars: int = 3000
    retriever_enable_rephrasing: bool = True
    retriever_enable_hyde: bool = True
    answer_judge_llm_enabled: bool = True
    retriever_enable_guardrails: bool = False
    retriever_person_entity_filter: bool = True
    retriever_relevance_gate_enabled: bool = False
    retriever_relevance_shadow_mode: bool = True

    # recency-first retrieval: search recent documents first to shrink the search space,
    # falling back to the full corpus when nothing relevant is found
    retriever_recency_first_enabled: bool = True
    retriever_recency_first_window_days: int = 30

    # dual-retriever temporal settings
    retriever_temporal_weight: float = 0.7  # α for RECENCY (0 = pure similarity, 1 = pure recency)
    retriever_temporal_decay_rate: float = 0.01  # λ for RECENCY; half-life ≈ 69 days
    retriever_temporal_weight_pit: float = 0.8  # α for POINT_IN_TIME
    retriever_temporal_decay_rate_pit: float = 0.05  # λ for POINT_IN_TIME; half-life ≈ 14 days
    retriever_temporal_top_k_multiplier: int = 4  # temporal retriever fetches top_k * N candidates

    retriever_synthesis_top_k: int = 20  # top_k for synthesis retrieval
    retriever_synthesis_recency_weight: float = 0.8  # alpha for temporal synthesis (vs 0.3 normal)
    retriever_topical_summary_top_k: int = 30  # top_k for topical-summary retrieval (broader than temporal synthesis)
    summarizer_max_input_chars: int = 50000  # max combined chars sent to the summarizer LLM

    # document-level canonical entity glossary pass before per-chunk extraction:
    # keeps entity names/labels consistent across chunks so exact-match entity
    # resolution can merge mentions (prerequisite for cross-chunk kg_rels value)
    entity_glossary_enabled: bool = True
    entity_glossary_max_entities: int = 100  # cap on glossary entries injected into the extraction prompt
    entity_glossary_max_input_chars: int = 150000  # max chars of document text sent to the glossary LLM

    # topic extraction (ingestion and chat)
    topic_extraction_enabled: bool = True
    topic_extraction_max_count: int = 5  # max topics returned per ingested document
    topic_extraction_max_existing: int = 200  # cap on existing topics injected into the prompt
    topic_extraction_max_input_chars: int = 8000  # max chars of source text sampled for extraction

    router_enable_internal_kb: bool = True  # suwali knowledge base
    router_enable_yago: bool = False
    router_use_llm_classifier: bool = True
    router_parallel_execution: bool = False  # TBD how useful
    router_enable_decomposition: bool = False  # query decomposition feature flag
    router_decomposition_max_subqueries: int = 5
    router_unified_classifier_decomposer: bool = False  # merge classification and decompositioninto a single LLM call
    yago_query_backend: Literal["sparql", "cypher"] = "cypher"
    yago_sparql_endpoint: str = "https://yago-knowledge.org/sparql/query"
    yago_timeout_seconds: int = 30
    yago_entity_extractor: Literal["heuristic", "nltk"] = "nltk"
    # Neo4j connection for YAGO (when using cypher backend)
    yago_neo4j_uri: str | None = None
    yago_neo4j_username: str | None = None
    yago_neo4j_password: str | None = None

    # OPENAI or BEDROCK - global default LLM provider (can be overridden per task via LLMProfile.provider)
    llm_provider: str = "OPENAI"
    aws_region: str = "eu-west-1"

    # Neo4j Hub Configuration (JSON format)
    neo4j_hub_config: dict[int, Neo4jConfig] | None = None
    # Neo4j Default Hub Configuration (JSON format, used as fallback when hub_id is not in neo4j_hub_config)
    neo4j_hub_default_config: Neo4jConfig | None = None
    # RQ settings
    redis_url: str
    rq_retry_max: int = 3
    rq_retry_interval: int = 360  # seconds; must exceed the ingestion lock timeout (300s)
    rq_job_timeout: int = 1800

    sentry_dsn: str | None = None

    supported_languages: list[str] = ["ar", "en", "fr", "pt", "es", "hi"]

    enable_llm_logging: bool = False  # enable logging of LLM requests and responses for debugging

    @field_validator("supported_languages", mode="before")
    @classmethod
    def parse_supported_languages(cls: Any, v: Any) -> list[str]:
        if v is None or v == "":
            return list(cls.model_fields["supported_languages"].default)

        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                return parsed if isinstance(parsed, list) else list(parsed)
            except json.JSONDecodeError as e:
                raise ValueError(f"Invalid JSON in SUPPORTED_LANGUAGES: {e}")

        if isinstance(v, list):
            return v

        raise ValueError(f"SUPPORTED_LANGUAGES must be a JSON string or list, got {type(v)}")

    @field_validator("supported_languages", mode="after")
    @classmethod
    def validate_supported_languages(cls: Any, v: list[str]) -> list[str]:
        invalid = [code for code in v if code not in VALID_LANGUAGE_CODES]
        if invalid:
            logger.warning(
                f"Unknown language codes in SUPPORTED_LANGUAGES: {invalid}. Valid codes: {sorted(VALID_LANGUAGE_CODES)}"
            )
        return v

    @field_validator("neo4j_hub_config", mode="before")
    @classmethod
    def parse_neo4j_hub_config(cls: Any, v: Any) -> dict[int, Neo4jConfig] | None:
        if v is None or v == "":
            return None

        if isinstance(v, str):
            try:
                return {int(k): Neo4jConfig(**v) for k, v in json.loads(v).items()}
            except json.JSONDecodeError as e:
                raise ValueError(f"Invalid JSON in NEO4J_HUB_CONFIG: {e}")

        if isinstance(v, dict):
            return {int(k): Neo4jConfig(**v) for k, v in v.items()}

        raise ValueError(f"NEO4J_HUB_CONFIG must be a JSON string or dict, got {type(v)}")

    @field_validator("neo4j_hub_default_config", mode="before")
    @classmethod
    def parse_neo4j_hub_default_config(cls: Any, v: Any) -> Neo4jConfig | None:
        if v is None or v == "":
            return None

        if isinstance(v, str):
            try:
                return Neo4jConfig(**json.loads(v))
            except json.JSONDecodeError as e:
                raise ValueError(f"Invalid JSON in NEO4J_HUB_DEFAULT_CONFIG: {e}")

        if isinstance(v, dict):
            return Neo4jConfig(**v)

        raise ValueError(f"NEO4J_HUB_DEFAULT_CONFIG must be a JSON string or dict, got {type(v)}")

    @field_validator("retriever_top_k", mode="after")
    @classmethod
    def validate_retriever_top_k(cls: Any, v: int) -> int:
        if v < 1:
            raise ValueError("retriever_top_k must be at least 1")
        return v

    @field_validator("chunk_overlap")
    @classmethod
    def validate_chunk_overlap(cls, v: int, info: ValidationInfo) -> int:
        chunk_size = info.data.get("chunk_size")
        if chunk_size is not None and v > chunk_size:
            raise ValueError(f"chunk_overlap ({v}) must be <= chunk_size ({chunk_size})")
        return v

    @field_validator("embedding_model_provider", mode="before")
    @classmethod
    def normalize_embedding_model_provider(cls, v: Any) -> Any:
        if isinstance(v, str):
            upper = v.upper()
            allowed = frozenset({"SBERT", "OPENAI", "BEDROCK_COHERE"})
            if upper in allowed:
                return upper
            raise ValueError(f"embedding_model_provider must be one of {sorted(allowed)}, got {v!r}")
        return v

    @field_validator("embed_api_embedding_model_provider", mode="before")
    @classmethod
    def normalize_embed_api_embedding_model_provider(cls, v: Any) -> Any:
        if v is None or v == "":
            return None
        if isinstance(v, str):
            upper = v.upper()
            allowed = frozenset({"SBERT", "OPENAI", "BEDROCK_COHERE"})
            if upper in allowed:
                return upper
            raise ValueError(f"embed_api_embedding_model_provider must be one of {sorted(allowed)}, got {v!r}")
        return v

    @field_validator("embed_api_embedding_model_name", mode="before")
    @classmethod
    def empty_embed_api_embedding_model_name_to_none(cls, v: Any) -> Any:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        return v

    @model_validator(mode="after")
    def validate_bedrock_cohere_semchunk(self) -> Self:
        # MARKDOWN embeds a semchunk adapter, so the same Cohere-paired-tokenizer rules apply
        if self.embedding_model_provider != "BEDROCK_COHERE" or self.text_splitter not in ("SEMCHUNK", "MARKDOWN"):
            return self
        from app.core.cohere_semchunk_tokenizer import (
            BEDROCK_COHERE_EMBED_MODEL_ID_TO_HF_TOKENIZER,
            hf_tokenizer_repo_for_bedrock_cohere_embed,
        )

        if hf_tokenizer_repo_for_bedrock_cohere_embed(self.embedding_model_name) is None:
            supported = sorted(BEDROCK_COHERE_EMBED_MODEL_ID_TO_HF_TOKENIZER.keys())
            raise ValueError(
                f"embedding_model_name {self.embedding_model_name!r} is not supported for "
                f"TEXT_SPLITTER={self.text_splitter} with BEDROCK_COHERE; "
                f"use one of {supported} or choose NLTK or FIXED_SIZE."
            )
        if self.semchunk_tokenizer_model_name:
            raise ValueError(
                f"semchunk_tokenizer_model_name must not be set when using BEDROCK_COHERE with {self.text_splitter} "
                "(chunking uses the Cohere Hugging Face tokenizer paired with embedding_model_name)."
            )
        return self


def resolved_embedding_vector_dimensions(config: Config) -> int:
    if config.embedding_vector_dimensions is not None:
        return config.embedding_vector_dimensions
    if config.embedding_model_provider == "OPENAI":
        return 1536
    if config.embedding_model_provider == "SBERT":
        return 768
    if config.embedding_model_provider == "BEDROCK_COHERE":
        return 1024
    raise ValueError(f"Unknown embedding_model_provider: {config.embedding_model_provider!r}")


def resolved_embed_api_embedding_provider(config: Config) -> Literal["SBERT", "OPENAI", "BEDROCK_COHERE"]:
    if config.embed_api_embedding_model_provider is not None:
        return config.embed_api_embedding_model_provider
    return config.embedding_model_provider


def resolved_embed_api_embedding_model_name(config: Config) -> str:
    if config.embed_api_embedding_model_name is not None:
        return config.embed_api_embedding_model_name
    return config.embedding_model_name


def resolved_embed_api_vector_dimensions(config: Config) -> int:
    if config.embed_api_embedding_vector_dimensions is not None:
        return config.embed_api_embedding_vector_dimensions
    if config.embedding_vector_dimensions is not None:
        return config.embedding_vector_dimensions
    p = resolved_embed_api_embedding_provider(config)
    if p == "OPENAI":
        return 1536
    if p == "SBERT":
        return 768
    if p == "BEDROCK_COHERE":
        return 1024
    raise ValueError(f"Unknown embed-api embedding provider: {p!r}")


def embed_api_profile_matches_primary_embedding(config: Config) -> bool:
    return (
        resolved_embed_api_embedding_provider(config) == config.embedding_model_provider
        and resolved_embed_api_embedding_model_name(config) == config.embedding_model_name
    )
