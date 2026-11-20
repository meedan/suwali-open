from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.chat import ChatRequest, ChatResponse, PersonalizationSettings
from app.services.language import LANGUAGE_NAMES
from app.services.router.rag_router import RAGRouter


class TestLanguageNames:
    def test_contains_all_expected_languages(self) -> None:
        expected_codes = {"en", "ar", "es", "fr", "hi", "pt"}
        assert expected_codes == set(LANGUAGE_NAMES.keys())

    def test_names_are_native(self) -> None:
        assert LANGUAGE_NAMES["en"] == "English"
        assert LANGUAGE_NAMES["pt"] == "Português"
        assert LANGUAGE_NAMES["ar"] == "العربية"


class TestCheckUnsupportedLanguage:
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    def _make_router(self, mock_llm_config: MagicMock, mock_config: MagicMock) -> RAGRouter:
        mock_config.return_value.router_enable_internal_kb = False
        mock_config.return_value.router_enable_yago = False
        mock_config.return_value.router_parallel_execution = False
        mock_config.return_value.router_unified_classifier_decomposer = False
        return RAGRouter(hub_id=1)

    @pytest.mark.asyncio
    async def test_returns_none_when_no_supported_languages_configured(self) -> None:
        router = self._make_router()
        chat = ChatRequest(hub_id=1, message_id=1, message="Hello", history=None)
        result = await router._check_unsupported_language(chat, "de", 0.0, {})
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_supported_languages_is_empty(self) -> None:
        router = self._make_router()
        personalization = PersonalizationSettings(supported_languages=[])
        chat = ChatRequest(hub_id=1, message_id=1, message="Hello", history=None, personalization=personalization)
        result = await router._check_unsupported_language(chat, "de", 0.0, {})
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_language_is_supported(self) -> None:
        router = self._make_router()
        personalization = PersonalizationSettings(supported_languages=["en", "pt"])
        chat = ChatRequest(hub_id=1, message_id=1, message="Hello", history=None, personalization=personalization)
        result = await router._check_unsupported_language(chat, "en", 0.0, {})
        assert result is None

    @pytest.mark.asyncio
    async def test_does_not_refuse_when_current_message_has_no_verdict(self) -> None:
        """History-only unsupported codes must not reach the gate (e.g. proper names)."""
        router = self._make_router()
        personalization = PersonalizationSettings(default_language="pt", supported_languages=["pt"])
        chat = ChatRequest(hub_id=1, message_id=1, message="Moskva", history=None, personalization=personalization)

        with patch.object(router, "_generate_unsupported_language_reply", new=AsyncMock()) as mock_reply:
            result = await router._check_unsupported_language(chat, None, 0.0, {})

        assert result is None
        mock_reply.assert_not_called()

    @pytest.mark.asyncio
    async def test_refuses_when_current_message_is_unsupported(self) -> None:
        router = self._make_router()
        personalization = PersonalizationSettings(default_language="en", supported_languages=["en"])
        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="Gdje je najbliža knjižnica?",
            history=None,
            personalization=personalization,
        )

        with patch.object(
            router, "_generate_unsupported_language_reply", new=AsyncMock(return_value="refusal")
        ) as mock_reply:
            result = await router._check_unsupported_language(chat, "hr", 0.0, {})

        assert result is not None
        assert result.answer == "refusal"
        mock_reply.assert_called_once()

    @pytest.mark.asyncio
    async def test_returns_response_when_current_message_is_unsupported_hub_language(self) -> None:
        """Spanish is system-supported but not in this hub's supported languages."""
        router = self._make_router()
        personalization = PersonalizationSettings(default_language="pt", supported_languages=["en", "pt"])
        chat = ChatRequest(
            hub_id=1, message_id=1, message="Hola, necesito ayuda", history=None, personalization=personalization
        )

        with patch.object(
            router,
            "_generate_unsupported_language_reply",
            new=AsyncMock(return_value="Este chatbot solo admite: English, Português."),
        ) as mock_reply:
            result = await router._check_unsupported_language(chat, "es", 0.0, {})

        assert result is not None
        assert isinstance(result, ChatResponse)
        assert "English" in result.answer or "Português" in result.answer
        assert result.metadata is not None
        assert result.metadata.language == "es"
        assert result.metadata.retriever_detected_lang == "es"
        assert mock_reply.call_args[0][1] == "es"

    @pytest.mark.asyncio
    async def test_returns_response_for_non_system_language(self) -> None:
        router = self._make_router()
        personalization = PersonalizationSettings(default_language="en", supported_languages=["en", "pt"])
        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="Ho bisogno di aiuto con questo",
            history=None,
            personalization=personalization,
        )

        with patch.object(
            router,
            "_generate_unsupported_language_reply",
            new=AsyncMock(return_value="Questo chatbot supporta solo: English, Português."),
        ) as mock_reply:
            result = await router._check_unsupported_language(chat, "it", 0.0, {})

        assert result is not None
        assert isinstance(result, ChatResponse)
        assert result.metadata is not None
        assert result.metadata.language == "it"
        assert result.metadata.retriever_detected_lang == "it"
        assert mock_reply.call_args[0][1] == "it"

    @pytest.mark.asyncio
    async def test_refuses_in_detected_language(self) -> None:
        router = self._make_router()
        personalization = PersonalizationSettings(supported_languages=["pt", "en"])
        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="Где находится метро рядом",
            history=None,
            personalization=personalization,
        )

        with patch.object(
            router,
            "_generate_unsupported_language_reply",
            new=AsyncMock(return_value="mock"),
        ) as mock_reply:
            result = await router._check_unsupported_language(chat, "ru", 0.0, {})

        assert result is not None
        assert result.metadata is not None
        assert result.metadata.language == "ru"
        assert result.metadata.retriever_detected_lang == "ru"
        assert mock_reply.call_args[0][1] == "ru"

    @pytest.mark.asyncio
    async def test_passes_native_language_names_to_reply_generator(self) -> None:
        router = self._make_router()
        mock_reply = AsyncMock(return_value="mock reply")
        personalization = PersonalizationSettings(default_language="pt", supported_languages=["en", "pt"])
        chat = ChatRequest(
            hub_id=1, message_id=1, message="Hola necesito ayuda ahora", history=None, personalization=personalization
        )

        with patch.object(router, "_generate_unsupported_language_reply", new=mock_reply):
            await router._check_unsupported_language(chat, "es", 0.0, {})

        call_args = mock_reply.call_args
        supported_names = call_args[0][2]  # third positional arg
        assert "English" in supported_names
        assert "Português" in supported_names
