import asyncio
from unittest.mock import MagicMock, patch

import boto3
import httpx
import pytest
from langchain_aws import ChatBedrock
from langchain_core.language_models import LanguageModelInput
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import RunnableBinding, RunnableWithFallbacks
from langchain_openai import ChatOpenAI
from loguru import logger
from openai import APIConnectionError, APITimeoutError, BadRequestError

from app.core.llm_config import (
    LLMConfig,
    LLMProfile,
    _llm_logging_handler,
    _openai_http_async_client,
    _PerLoopTransport,
    create_chat_model,
    resolve_provider,
    resolved_openai_reasoning_effort,
)


class TestResolveProvider:
    @patch("app.core.config.Config")
    def test_uses_profile_provider_when_set(self, mock_config_class: MagicMock) -> None:
        profile = LLMProfile(provider="BEDROCK")
        assert resolve_provider(profile) == "BEDROCK"

    @patch("app.core.config.Config")
    def test_falls_back_to_global_config(self, mock_config_class: MagicMock) -> None:
        mock_config_class.return_value.llm_provider = "BEDROCK"
        profile = LLMProfile()
        assert resolve_provider(profile) == "BEDROCK"

    @patch("app.core.config.Config")
    def test_defaults_to_openai(self, mock_config_class: MagicMock) -> None:
        mock_config_class.return_value.llm_provider = "OPENAI"
        profile = LLMProfile()
        assert resolve_provider(profile) == "OPENAI"

    @patch("app.core.config.Config")
    def test_normalizes_to_uppercase(self, mock_config_class: MagicMock) -> None:
        profile = LLMProfile(provider="bedrock")
        assert resolve_provider(profile) == "BEDROCK"


class TestResolvedOpenAIReasoningEffort:
    def test_profile_overrides_global(self) -> None:
        profile = LLMProfile(reasoning_effort="high")
        config = LLMConfig(openai_reasoning_effort="low")
        assert resolved_openai_reasoning_effort(profile, config) == "high"

    def test_falls_back_to_global(self) -> None:
        profile = LLMProfile()
        config = LLMConfig(openai_reasoning_effort="low")
        assert resolved_openai_reasoning_effort(profile, config) == "low"

    def test_none_when_unset(self) -> None:
        profile = LLMProfile()
        config = LLMConfig()
        assert resolved_openai_reasoning_effort(profile, config) is None


class TestPerLoopTransport:
    def test_each_event_loop_gets_its_own_pool(self) -> None:
        transport = _PerLoopTransport()

        async def pools() -> tuple[httpx.AsyncHTTPTransport, httpx.AsyncHTTPTransport]:
            return transport._pool(), transport._pool()

        first_a, first_b = asyncio.run(pools())
        second, _ = asyncio.run(pools())
        assert first_a is first_b
        assert second is not first_a

    def test_closed_loop_connections_are_not_reused(self) -> None:
        """Two asyncio.run loops in a row: the second must not see the first loop's keep-alive connection."""
        transport = _PerLoopTransport()
        handled: list[httpx.AsyncHTTPTransport] = []

        async def fake_handle(self: httpx.AsyncHTTPTransport, request: httpx.Request) -> httpx.Response:
            handled.append(self)
            return httpx.Response(200)

        async def send() -> None:
            async with httpx.AsyncClient(transport=transport) as client:
                await client.get("https://api.openai.com/v1/models")

        with patch.object(httpx.AsyncHTTPTransport, "handle_async_request", fake_handle):
            asyncio.run(send())
            asyncio.run(send())
        assert len(handled) == 2
        assert handled[0] is not handled[1]

    def test_closed_loop_pools_are_dropped(self) -> None:
        transport = _PerLoopTransport()

        async def pool() -> None:
            # a keep-alive connection's asyncio transport references its loop the same way
            transport._pool().pinned_loop = asyncio.get_running_loop()  # type: ignore[attr-defined]

        for _ in range(5):
            asyncio.run(pool())
        assert len(transport._pools) == 1

    async def test_aclose_without_requests_is_a_noop(self) -> None:
        await _PerLoopTransport().aclose()


class TestCreateChatModel:
    @patch("app.core.llm_config.resolve_provider", return_value="OPENAI")
    def test_returns_openai_model(self, mock_resolve: MagicMock) -> None:
        profile = LLMProfile(temperature=0.5, max_tokens=100)
        config = LLMConfig(openai_model="gpt-4o-mini", max_tokens=3000, llm_bedrock_fallback=False)

        model = create_chat_model(profile, config)

        assert isinstance(model, ChatOpenAI)
        assert model.model_name == "gpt-4o-mini"
        assert model.temperature == 0.5
        assert model.max_tokens == 100
        assert model.reasoning_effort is None

    @patch("app.core.llm_config.resolve_provider", return_value="OPENAI")
    def test_openai_uses_per_loop_http_client(self, mock_resolve: MagicMock) -> None:
        config = LLMConfig(llm_bedrock_fallback=False)

        model = create_chat_model(LLMProfile(), config)

        assert isinstance(model, ChatOpenAI)
        assert model.root_async_client is not None
        assert model.root_async_client._client is _openai_http_async_client

    @patch("app.core.llm_config.resolve_provider", return_value="OPENAI")
    def test_openai_passes_reasoning_effort_from_profile(self, mock_resolve: MagicMock) -> None:
        profile = LLMProfile(reasoning_effort="low")
        config = LLMConfig(openai_model="gpt-5-mini", max_tokens=3000, llm_bedrock_fallback=False)

        model = create_chat_model(profile, config)

        assert isinstance(model, ChatOpenAI)
        assert model.reasoning_effort == "low"

    @patch("app.core.llm_config.resolve_provider", return_value="OPENAI")
    def test_openai_passes_reasoning_effort_from_global_default(self, mock_resolve: MagicMock) -> None:
        profile = LLMProfile()
        config = LLMConfig(
            openai_model="gpt-5-mini",
            max_tokens=3000,
            openai_reasoning_effort="minimal",
            llm_bedrock_fallback=False,
        )

        model = create_chat_model(profile, config)

        assert isinstance(model, ChatOpenAI)
        assert model.reasoning_effort == "minimal"

    @patch("app.core.llm_config.ChatBedrock")
    @patch("app.core.llm_config.get_bedrock_client")
    @patch("app.core.llm_config.resolve_provider", return_value="BEDROCK")
    def test_returns_bedrock_model(
        self, mock_resolve: MagicMock, mock_client: MagicMock, mock_chat_bedrock: MagicMock
    ) -> None:
        profile = LLMProfile(temperature=0.3)
        config = LLMConfig(bedrock_model="eu.amazon.nova-micro-v1:0", max_tokens=2000)

        create_chat_model(profile, config)

        mock_chat_bedrock.assert_called_once_with(
            client=mock_client.return_value,
            model_id="eu.amazon.nova-micro-v1:0",
            beta_use_converse_api=True,
            model_kwargs={"temperature": 0.3, "max_tokens": 2000},
            callbacks=[_llm_logging_handler],
        )

    @patch("app.core.llm_config.resolve_provider", return_value="OPENAI")
    def test_profile_model_overrides_default(self, mock_resolve: MagicMock) -> None:
        profile = LLMProfile(model="gpt-4o")
        config = LLMConfig(openai_model="gpt-4o-mini", max_tokens=3000, llm_bedrock_fallback=False)

        model = create_chat_model(profile, config)

        assert isinstance(model, ChatOpenAI)
        assert model.model_name == "gpt-4o"

    @patch("app.core.llm_config.ChatBedrock")
    @patch("app.core.llm_config.get_bedrock_client")
    @patch("app.core.llm_config.resolve_provider", return_value="BEDROCK")
    def test_bedrock_profile_model_overrides_default(
        self, mock_resolve: MagicMock, mock_client: MagicMock, mock_chat_bedrock: MagicMock
    ) -> None:
        profile = LLMProfile(model="eu.amazon.nova-lite-v1:0")
        config = LLMConfig(bedrock_model="eu.amazon.nova-micro-v1:0", max_tokens=3000)

        create_chat_model(profile, config)

        mock_chat_bedrock.assert_called_once_with(
            client=mock_client.return_value,
            model_id="eu.amazon.nova-lite-v1:0",
            beta_use_converse_api=True,
            model_kwargs={"temperature": 0.0, "max_tokens": 3000},
            callbacks=[_llm_logging_handler],
        )

    @patch("app.core.llm_config.resolve_provider", return_value="OPENAI")
    def test_temperature_defaults_to_zero(self, mock_resolve: MagicMock) -> None:
        profile = LLMProfile()
        config = LLMConfig(openai_model="gpt-4o-mini", max_tokens=3000, llm_bedrock_fallback=False)

        model = create_chat_model(profile, config)

        assert isinstance(model, ChatOpenAI)
        assert model.temperature == 0.0

    @patch("app.core.llm_config.ChatBedrock")
    @patch("app.core.llm_config.get_bedrock_client")
    @patch("app.core.llm_config.resolve_provider", return_value="BEDROCK")
    def test_google_gemma_model_enables_converse(
        self, mock_resolve: MagicMock, mock_client: MagicMock, mock_chat_bedrock: MagicMock
    ) -> None:
        profile = LLMProfile(model="google.gemma-3-27b-it")
        config = LLMConfig(bedrock_model="eu.amazon.nova-micro-v1:0", max_tokens=3000)

        create_chat_model(profile, config)

        mock_chat_bedrock.assert_called_once_with(
            client=mock_client.return_value,
            model_id="google.gemma-3-27b-it",
            beta_use_converse_api=True,
            model_kwargs={"temperature": 0.0, "max_tokens": 3000},
            callbacks=[_llm_logging_handler],
        )

    @patch("app.core.llm_config.ChatBedrock")
    @patch("app.core.llm_config.get_bedrock_client")
    @patch("app.core.llm_config.resolve_provider", return_value="BEDROCK")
    def test_region_prefixed_google_model_enables_converse(
        self, mock_resolve: MagicMock, mock_client: MagicMock, mock_chat_bedrock: MagicMock
    ) -> None:
        profile = LLMProfile(model="eu.google.gemma-3-27b-it")
        config = LLMConfig(bedrock_model="eu.amazon.nova-micro-v1:0", max_tokens=3000)

        create_chat_model(profile, config)

        mock_chat_bedrock.assert_called_once_with(
            client=mock_client.return_value,
            model_id="eu.google.gemma-3-27b-it",
            beta_use_converse_api=True,
            model_kwargs={"temperature": 0.0, "max_tokens": 3000},
            callbacks=[_llm_logging_handler],
        )

    @patch("app.core.llm_config.resolve_provider", return_value="OPENAI")
    def test_openai_uses_default_interactive_timeout(self, mock_resolve: MagicMock) -> None:
        profile = LLMProfile()
        config = LLMConfig(llm_timeout_seconds=60.0, llm_bedrock_fallback=False)

        model = create_chat_model(profile, config)

        assert isinstance(model, ChatOpenAI)
        assert model.request_timeout == 60.0

    @patch("app.core.llm_config.resolve_provider", return_value="OPENAI")
    def test_openai_honors_explicit_timeout_override(self, mock_resolve: MagicMock) -> None:
        profile = LLMProfile()
        config = LLMConfig(llm_timeout_seconds=60.0, llm_ingestion_timeout_seconds=180.0, llm_bedrock_fallback=False)

        model = create_chat_model(profile, config, timeout_seconds=config.llm_ingestion_timeout_seconds)

        assert isinstance(model, ChatOpenAI)
        assert model.request_timeout == 180.0

    @patch("app.core.llm_config.resolve_provider", return_value="OPENAI")
    def test_openai_router_tier_timeout_and_retries(self, mock_resolve: MagicMock) -> None:
        config = LLMConfig(llm_bedrock_fallback=False)

        model = create_chat_model(
            config.llm_classifier_decomposer,
            config,
            timeout_seconds=config.llm_router_timeout_seconds,
            max_retries=config.llm_router_max_retries,
        )

        assert isinstance(model, ChatOpenAI)
        assert model.request_timeout == 15.0
        assert model.max_retries == 1

    @patch("app.core.llm_config.resolve_provider", return_value="OPENAI")
    def test_openai_default_retries_unchanged_without_override(self, mock_resolve: MagicMock) -> None:
        model = create_chat_model(LLMProfile(), LLMConfig(llm_bedrock_fallback=False))

        assert isinstance(model, ChatOpenAI)
        assert model.max_retries is None

    @patch("app.core.llm_config.ChatBedrock")
    @patch("app.core.llm_config.get_bedrock_client")
    @patch("app.core.llm_config.resolve_provider", return_value="BEDROCK")
    def test_bedrock_uses_default_interactive_timeout(
        self, mock_resolve: MagicMock, mock_client: MagicMock, mock_chat_bedrock: MagicMock
    ) -> None:
        profile = LLMProfile()
        config = LLMConfig(llm_timeout_seconds=60.0)

        create_chat_model(profile, config)

        mock_client.assert_called_once_with(read_timeout_seconds=60.0, max_retries=None)

    @patch("app.core.llm_config.ChatBedrock")
    @patch("app.core.llm_config.get_bedrock_client")
    @patch("app.core.llm_config.resolve_provider", return_value="BEDROCK")
    def test_bedrock_honors_explicit_timeout_override(
        self, mock_resolve: MagicMock, mock_client: MagicMock, mock_chat_bedrock: MagicMock
    ) -> None:
        profile = LLMProfile()
        config = LLMConfig(llm_ingestion_timeout_seconds=180.0)

        create_chat_model(profile, config, timeout_seconds=config.llm_ingestion_timeout_seconds)

        mock_client.assert_called_once_with(read_timeout_seconds=180.0, max_retries=None)


class TestBedrockFallback:
    @patch("app.core.llm_config.get_bedrock_client")
    @patch("app.core.llm_config.resolve_provider", return_value="OPENAI")
    def test_openai_wrapped_with_bedrock_fallback_when_enabled(
        self, mock_resolve: MagicMock, mock_client: MagicMock
    ) -> None:
        # chatbedrock validation rejects a bare MagicMock client, needs a real (offline) boto3 client
        mock_client.return_value = boto3.client(
            "bedrock-runtime", region_name="eu-west-1", aws_access_key_id="test", aws_secret_access_key="test"
        )
        profile = LLMProfile(temperature=0.5)
        config = LLMConfig(llm_bedrock_fallback=True, bedrock_model="eu.amazon.nova-micro-v1:0", max_tokens=3000)

        model = create_chat_model(profile, config)

        assert isinstance(model, RunnableWithFallbacks)
        assert isinstance(model.runnable, ChatOpenAI)
        assert model.exceptions_to_handle == (APITimeoutError, APIConnectionError)
        binding = model.fallbacks[0]
        assert isinstance(binding, RunnableBinding)
        fallback = binding.bound
        assert isinstance(fallback, ChatBedrock)
        assert fallback.model_id == "eu.amazon.nova-micro-v1:0"
        assert fallback.temperature == 0.5
        assert fallback.max_tokens == 3000

    @patch("app.core.llm_config.resolve_provider", return_value="OPENAI")
    def test_no_fallback_when_disabled(self, mock_resolve: MagicMock) -> None:
        model = create_chat_model(LLMProfile(), LLMConfig(llm_bedrock_fallback=False))

        assert isinstance(model, ChatOpenAI)

    @patch("app.core.llm_config.resolve_provider", return_value="OPENAI")
    def test_call_site_opt_out_skips_fallback(self, mock_resolve: MagicMock) -> None:
        model = create_chat_model(LLMProfile(), LLMConfig(llm_bedrock_fallback=True), bedrock_fallback=False)

        assert isinstance(model, ChatOpenAI)

    @staticmethod
    def _fallback_model() -> RunnableWithFallbacks[LanguageModelInput, BaseMessage]:
        with (
            patch("app.core.llm_config.resolve_provider", return_value="OPENAI"),
            patch("app.core.llm_config.get_bedrock_client") as mock_client,
        ):
            mock_client.return_value = boto3.client(
                "bedrock-runtime", region_name="eu-west-1", aws_access_key_id="test", aws_secret_access_key="test"
            )
            model = create_chat_model(LLMProfile(), LLMConfig(llm_bedrock_fallback=True))
        assert isinstance(model, RunnableWithFallbacks)
        return model

    def test_invoke_falls_back_to_bedrock_on_timeout(self) -> None:
        model = self._fallback_model()
        bedrock_result = ChatResult(generations=[ChatGeneration(message=AIMessage(content="bedrock answer"))])
        warnings: list[str] = []
        sink_id = logger.add(lambda message: warnings.append(str(message)), level="WARNING")

        try:
            with (
                patch.object(ChatOpenAI, "_generate", side_effect=APITimeoutError(request=MagicMock())),
                patch.object(ChatBedrock, "_generate", return_value=bedrock_result) as mock_bedrock_generate,
            ):
                response = model.invoke("hi")
        finally:
            logger.remove(sink_id)

        assert response.content == "bedrock answer"
        mock_bedrock_generate.assert_called_once()
        assert any("falling back to bedrock" in warning for warning in warnings)

    def test_invoke_does_not_fall_back_on_bad_request(self) -> None:
        model = self._fallback_model()
        request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
        bad_request = BadRequestError("bad request", response=httpx.Response(400, request=request), body=None)

        with (
            patch.object(ChatOpenAI, "_generate", side_effect=bad_request),
            patch.object(ChatBedrock, "_generate") as mock_bedrock_generate,
        ):
            with pytest.raises(BadRequestError):
                model.invoke("hi")

        mock_bedrock_generate.assert_not_called()

    @patch("app.core.llm_config.ChatBedrock")
    @patch("app.core.llm_config.get_bedrock_client")
    @patch("app.core.llm_config.resolve_provider", return_value="BEDROCK")
    def test_bedrock_provider_never_wrapped(
        self, mock_resolve: MagicMock, mock_client: MagicMock, mock_chat_bedrock: MagicMock
    ) -> None:
        create_chat_model(LLMProfile(), LLMConfig(llm_bedrock_fallback=True))

        mock_chat_bedrock.assert_called_once()
