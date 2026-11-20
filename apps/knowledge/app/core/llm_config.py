import asyncio
import threading

import httpx
from langchain_aws import ChatBedrock
from langchain_core.language_models import LanguageModelInput
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage
from langchain_core.runnables import Runnable
from langchain_openai import ChatOpenAI
from loguru import logger
from openai import APIConnectionError, APITimeoutError
from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.bedrock import get_bedrock_client
from app.core.logging import LLMLoggingHandler

_llm_logging_handler = LLMLoggingHandler()

_LEGACY_BEDROCK_CHAT_SUPPORTED_PROVIDERS = frozenset(
    {"anthropic", "meta", "mistral", "deepseek", "writer", "openai", "qwen"}
)
# openai failures worth retrying on another provider; api errors (bad request, context length) would fail there too
TRANSIENT_OPENAI_ERRORS = (APITimeoutError, APIConnectionError)
_BEDROCK_REGION_PREFIXES = frozenset({"eu", "us", "us-gov", "apac", "sa", "amer", "global", "jp", "au"})


class _PerLoopTransport(httpx.AsyncBaseTransport):
    """An httpx transport with one connection pool per event loop.

    langchain-openai otherwise shares one process-wide pool across every ChatOpenAI instance, and
    `language._run_sync` runs coroutines on short-lived `asyncio.run` loops (sometimes on a worker thread,
    while the server loop is live). A keep-alive connection opened on a loop that has since closed then
    fails with "Event loop is closed" and the request pays a retry, so each loop gets its own pool instead.

    Pools of closed loops are dropped when the next pool is created. A WeakKeyDictionary can't do it: a pooled
    connection's asyncio transport holds its loop, so the value would keep its own key alive. A closed loop
    can't run `aclose`, so the dropped pool's sockets are closed when it is garbage collected.
    """

    def __init__(self) -> None:
        self._pools: dict[asyncio.AbstractEventLoop, httpx.AsyncHTTPTransport] = {}
        self._lock = threading.Lock()

    def _pool(self) -> httpx.AsyncHTTPTransport:
        loop = asyncio.get_running_loop()
        with self._lock:
            pool = self._pools.get(loop)
            if pool is None:
                self._pools = {lp: p for lp, p in self._pools.items() if not lp.is_closed()}
                # same limits as the openai sdk's default client
                limits = httpx.Limits(max_connections=1000, max_keepalive_connections=100)
                pool = self._pools[loop] = httpx.AsyncHTTPTransport(limits=limits)
            return pool

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        return await self._pool().handle_async_request(request)

    async def aclose(self) -> None:
        with self._lock:
            pool = self._pools.pop(asyncio.get_running_loop(), None)
        if pool is not None:
            await pool.aclose()


# follow_redirects matches the openai sdk's default client
_openai_http_async_client = httpx.AsyncClient(transport=_PerLoopTransport(), follow_redirects=True)


class LLMProfile(BaseModel):
    """Per-task LLM configuration. None values fall back to global defaults."""

    provider: str | None = None
    model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    reasoning_effort: str | None = None


class LLMConfig(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_model: str = "gpt-4o-mini"
    openai_reasoning_effort: str | None = None
    bedrock_model: str = "eu.amazon.nova-micro-v1:0"
    # retry openai calls on bedrock_model when they time out or can't connect
    llm_bedrock_fallback: bool = False
    max_tokens: int = 3000
    # Interactive-tier timeout (chat, routing, rewriting, HyDE, summarization, embeddings).
    llm_timeout_seconds: float = 60.0
    # Ingestion-tier timeout (classification, entity/topic extraction) - larger inputs need more headroom.
    llm_ingestion_timeout_seconds: float = 180.0
    # router-tier: small routing calls with a graceful fallback, kept tight so one tail-latency request can't stall the chat
    llm_router_timeout_seconds: float = 15.0
    llm_router_max_retries: int = 1

    llm_decomposer: LLMProfile = LLMProfile(temperature=0.0, max_tokens=800)
    llm_synthesizer: LLMProfile = LLMProfile(temperature=0.0)
    llm_classifier: LLMProfile = LLMProfile(temperature=0.0, max_tokens=500)
    llm_classifier_decomposer: LLMProfile = LLMProfile(temperature=0.0, max_tokens=1200)
    llm_rewriter: LLMProfile = LLMProfile(temperature=0.0)
    llm_hyde: LLMProfile = LLMProfile(temperature=0.7, max_tokens=500)
    llm_rephraser: LLMProfile = LLMProfile(
        temperature=0.5
    )  # this will possibly need tweaking to balance between not enough and too much creativity
    llm_answer_judge: LLMProfile = LLMProfile(temperature=0.0)
    llm_ingestor_classify: LLMProfile = LLMProfile(temperature=0.0, max_tokens=200)
    llm_ingestor_extract: LLMProfile = LLMProfile(temperature=0.0)
    # glossary output can be large (up to entity_glossary_max_entities entries with aliases)
    llm_ingestor_glossary: LLMProfile = LLMProfile(temperature=0.0, max_tokens=8000)
    llm_topic_extractor: LLMProfile = LLMProfile(temperature=0.0, max_tokens=300)
    llm_context_extractor: LLMProfile = LLMProfile(temperature=0.0, max_tokens=400)
    llm_retriever: LLMProfile = LLMProfile(temperature=0.0)
    llm_summarizer: LLMProfile = LLMProfile(temperature=0.0)
    llm_error_handler: LLMProfile = LLMProfile(temperature=0.3)
    llm_resource_selector: LLMProfile = LLMProfile(temperature=0.0, max_tokens=200)
    llm_sub_query_executor: LLMProfile = LLMProfile(temperature=0.0, max_tokens=500)
    llm_rag_router: LLMProfile = LLMProfile(temperature=0.0, max_tokens=500)
    llm_scenario_reply: LLMProfile = LLMProfile(temperature=0.0, max_tokens=500)
    llm_language_detector: LLMProfile = LLMProfile(temperature=0.0, max_tokens=50)
    llm_directive_judge: LLMProfile = LLMProfile(temperature=0.0, max_tokens=300)


def resolve_provider(llm_profile: LLMProfile) -> str:
    if llm_profile.provider:
        return llm_profile.provider.upper()
    from app.core.config import Config

    return Config().llm_provider.upper()


def _infer_bedrock_provider(model_id: str) -> str | None:
    model_id = model_id.strip()
    if not model_id or model_id.startswith("arn:"):
        return None

    parts = model_id.split(".", maxsplit=2)
    if not parts:
        return None

    if len(parts) > 1 and parts[0].lower() in _BEDROCK_REGION_PREFIXES:
        provider = parts[1].strip().lower()
    else:
        provider = parts[0].strip().lower()

    return provider or None


def _should_use_bedrock_converse(model_id: str) -> tuple[str | None, bool]:
    provider = _infer_bedrock_provider(model_id)
    if provider is None:
        return None, False
    return provider, provider not in _LEGACY_BEDROCK_CHAT_SUPPORTED_PROVIDERS


def resolved_openai_reasoning_effort(llm_profile: LLMProfile, llm_config: LLMConfig) -> str | None:
    if llm_profile.reasoning_effort is not None:
        return llm_profile.reasoning_effort
    return llm_config.openai_reasoning_effort


def resolved_model_name(llm_profile: LLMProfile, llm_config: LLMConfig) -> str:
    """The model id create_chat_model would use for this profile."""
    if resolve_provider(llm_profile) == "BEDROCK":
        return llm_profile.model or llm_config.bedrock_model
    return llm_profile.model or llm_config.openai_model


def create_bedrock_chat_model(
    model_id: str,
    *,
    temperature: float,
    max_tokens: int,
    timeout_seconds: float,
    max_retries: int | None = None,
) -> ChatBedrock:
    bedrock_provider, use_converse = _should_use_bedrock_converse(model_id)
    logger.debug(
        "Creating LLM: provider=BEDROCK model={} bedrock_provider={} converse={}",
        model_id,
        bedrock_provider or "unknown",
        use_converse,
    )
    return ChatBedrock(
        client=get_bedrock_client(read_timeout_seconds=timeout_seconds, max_retries=max_retries),
        model_id=model_id,
        beta_use_converse_api=use_converse,
        model_kwargs={
            "temperature": temperature,
            "max_tokens": max_tokens,
        },
        callbacks=[_llm_logging_handler],
    )


def create_chat_model(
    llm_profile: LLMProfile,
    llm_config: LLMConfig | None = None,
    *,
    timeout_seconds: float | None = None,
    max_retries: int | None = None,
    bedrock_fallback: bool = True,
) -> BaseChatModel | Runnable[LanguageModelInput, BaseMessage]:
    default = llm_config or LLMConfig()
    provider = resolve_provider(llm_profile)
    timeout = timeout_seconds if timeout_seconds is not None else default.llm_timeout_seconds

    temperature = llm_profile.temperature if llm_profile.temperature is not None else 0.0
    max_tokens = llm_profile.max_tokens or default.max_tokens

    if provider == "BEDROCK":
        return create_bedrock_chat_model(
            llm_profile.model or default.bedrock_model,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout_seconds=timeout,
            max_retries=max_retries,
        )

    model_name = llm_profile.model or default.openai_model
    logger.debug(f"Creating LLM: provider={provider} model={model_name}")

    openai_kwargs: dict[str, str | float | int] = {
        "model": model_name,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "timeout": timeout,
    }
    if max_retries is not None:
        openai_kwargs["max_retries"] = max_retries
    reasoning_effort = resolved_openai_reasoning_effort(llm_profile, default)
    if reasoning_effort is not None:
        openai_kwargs["reasoning_effort"] = reasoning_effort
    chat_model = ChatOpenAI(
        **openai_kwargs, http_async_client=_openai_http_async_client, callbacks=[_llm_logging_handler]
    )

    if not (bedrock_fallback and default.llm_bedrock_fallback):
        return chat_model
    fallback = create_bedrock_chat_model(
        default.bedrock_model,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout_seconds=timeout,
        max_retries=max_retries,
    ).with_listeners(
        on_start=lambda _run: logger.warning(
            "openai unreachable, falling back to bedrock model {}", default.bedrock_model
        )
    )
    return chat_model.with_fallbacks([fallback], exceptions_to_handle=TRANSIENT_OPENAI_ERRORS)
