from unittest.mock import AsyncMock, patch

from app.core.config import Config
from app.core.constants import HINDI_SCRIPT_RULES
from app.models.chat import ChatRequest, Message, PersonalizationSettings, Role
from app.services.language import (
    LANGUAGE_CONTEXT_MESSAGE_CHARS,
    LANGUAGE_DETECTION_CHAR_LIMIT,
    detect,
    detect_from_history,
    detect_message,
    detect_text,
    detection_context,
    reply_language_instructions,
)
from app.services.language._llm import (
    _INSTRUCTIONS,
    LLM_CONFIDENCE,
    DetectionContext,
    _format_context,
    detect_language_llm,
)


def _chat(
    message: str,
    history: list[Message] | None = None,
    default_language: str | None = None,
    supported_languages: list[str] | None = None,
) -> ChatRequest:
    personalization = None
    if default_language is not None or supported_languages is not None:
        personalization = PersonalizationSettings(
            default_language=default_language,
            supported_languages=supported_languages,
        )
    return ChatRequest(hub_id=1, message_id=1, message=message, history=history, personalization=personalization)


class TestDetectMessage:
    async def test_empty_returns_none(self) -> None:
        with patch("app.services.language.detect_language_llm", new_callable=AsyncMock) as m:
            assert await detect_message("") is None
            assert await detect_message("   ") is None
        m.assert_not_called()

    async def test_punctuation_and_emoji_skip_llm(self) -> None:
        with patch("app.services.language.detect_language_llm", new_callable=AsyncMock) as m:
            assert await detect_message("👍 123 !!!") is None
            assert await detect_message("!!! ... ???") is None
            assert await detect_message("123456") is None
        m.assert_not_called()

    async def test_short_message_calls_llm(self) -> None:
        with patch(
            "app.services.language.detect_language_llm",
            new_callable=AsyncMock,
            return_value=("pt", LLM_CONFIDENCE),
        ) as m:
            assert await detect_message("Oi") == ("pt", LLM_CONFIDENCE)
        m.assert_called_once_with("Oi", None)

    async def test_strips_whitespace(self) -> None:
        with patch(
            "app.services.language.detect_language_llm",
            new_callable=AsyncMock,
            return_value=("en", LLM_CONFIDENCE),
        ) as m:
            await detect_message("  Hello world  ")
        m.assert_called_once_with("Hello world", None)


class TestDetect:
    async def test_current_message_wins_over_history(self) -> None:
        chat = _chat(
            "Cómo mantenerse segura durante la ola de calor?",
            [Message(role=Role.USER, content="One of the cooling centers broke down this morning")],
        )
        with patch("app.services.language.detect_language_llm", new_callable=AsyncMock) as m:

            async def _side_effect(text: str, context: DetectionContext | None = None) -> tuple[str, float]:
                return ("es", LLM_CONFIDENCE) if "calor" in text else ("en", LLM_CONFIDENCE)

            m.side_effect = _side_effect
            lang, confidence = await detect(chat)
        assert lang == "es"
        assert confidence == LLM_CONFIDENCE
        assert m.call_count == 1

    async def test_history_used_when_current_has_no_letters(self) -> None:
        chat = _chat(
            "👍❤️",
            [Message(role=Role.USER, content="Esta es una pregunta en español sobre algo importante")],
        )
        with patch(
            "app.services.language.detect_language_llm",
            new_callable=AsyncMock,
            return_value=("es", LLM_CONFIDENCE),
        ):
            lang, confidence = await detect(chat)
        assert lang == "es"
        assert confidence == LLM_CONFIDENCE

    async def test_history_used_when_current_returns_unknown(self) -> None:
        chat = _chat(
            "zzzzz",
            [Message(role=Role.USER, content="This is an English message in the history")],
        )
        with patch("app.services.language.detect_language_llm", new_callable=AsyncMock) as m:

            async def _side_effect(text: str, context: DetectionContext | None = None) -> tuple[str, float] | None:
                return None if text == "zzzzz" else ("en", LLM_CONFIDENCE)

            m.side_effect = _side_effect
            lang, _ = await detect(chat)
        assert lang == "en"

    async def test_skips_assistant_history(self) -> None:
        chat = _chat(
            "👍",
            [
                Message(role=Role.USER, content="This is an old message in English"),
                Message(role=Role.ASSISTANT, content="Esta es una respuesta en español reciente"),
            ],
        )
        with patch(
            "app.services.language.detect_language_llm",
            new_callable=AsyncMock,
            return_value=("en", LLM_CONFIDENCE),
        ) as m:
            lang, _ = await detect(chat)
        assert lang == "en"
        m.assert_called_once_with("This is an old message in English", None)

    async def test_newest_user_history_wins(self) -> None:
        chat = _chat(
            "?",
            [
                Message(role=Role.USER, content="This is an English message at the start"),
                Message(role=Role.ASSISTANT, content="Esta es una respuesta en español"),
                Message(role=Role.USER, content="هذه رسالة باللغة العربية"),
            ],
        )
        with patch("app.services.language.detect_language_llm", new_callable=AsyncMock) as m:

            async def _side_effect(text: str, context: DetectionContext | None = None) -> tuple[str, float]:
                return ("ar", LLM_CONFIDENCE) if "هذه" in text else ("en", LLM_CONFIDENCE)

            m.side_effect = _side_effect
            lang, _ = await detect(chat)
        assert lang == "ar"

    async def test_returns_none_when_nothing_detectable(self) -> None:
        chat = _chat("👍", [Message(role=Role.USER, content="!!!"), Message(role=Role.ASSISTANT, content="hola")])
        with patch("app.services.language.detect_language_llm", new_callable=AsyncMock) as m:
            lang, confidence = await detect(chat)
        assert lang is None
        assert confidence == 0.0
        m.assert_not_called()

    async def test_returns_none_when_llm_returns_none_and_no_history(self) -> None:
        with patch("app.services.language.detect_language_llm", new_callable=AsyncMock, return_value=None):
            lang, confidence = await detect(_chat("ok", []))
        assert lang is None
        assert confidence == 0.0

    async def test_none_and_empty_history_match_for_emoji(self) -> None:
        with patch("app.services.language.detect_language_llm", new_callable=AsyncMock) as m:
            assert await detect(_chat("👍", None)) == await detect(_chat("👍", []))
        m.assert_not_called()

    async def test_history_window_only_recent_user_messages(self) -> None:
        old_messages = [Message(role=Role.USER, content=f"old english {i}") for i in range(10)]
        recent = [Message(role=Role.USER, content="Necesito ayuda con algo importante ahora mismo")]
        chat = _chat("👍", old_messages + recent)
        with patch(
            "app.services.language.detect_language_llm",
            new_callable=AsyncMock,
            return_value=("es", LLM_CONFIDENCE),
        ) as m:
            lang, _ = await detect(chat)
        assert lang == "es"
        m.assert_called_once_with("Necesito ayuda con algo importante ahora mismo", None)


class TestDetectionContext:
    def test_empty_without_history_or_personalization(self) -> None:
        assert detection_context(_chat("Como saber onde devo votar?")) == DetectionContext()
        assert detection_context(_chat("Como saber onde devo votar?", [])) == DetectionContext()

    def test_excludes_assistant_turns(self) -> None:
        chat = _chat(
            "Como saber onde devo votar?",
            [
                Message(role=Role.USER, content="qual a ordem de votação?"),
                Message(role=Role.ASSISTANT, content="Você está inscrito em São Paulo."),
            ],
        )
        assert detection_context(chat).history == ("qual a ordem de votação?",)

    def test_keeps_only_the_most_recent_turns(self) -> None:
        chat = _chat("?", [Message(role=Role.USER, content=f"mensagem {i}") for i in range(6)])
        assert detection_context(chat).history == ("mensagem 3", "mensagem 4", "mensagem 5")

    def test_truncates_long_turns(self) -> None:
        chat = _chat("?", [Message(role=Role.USER, content="a" * (LANGUAGE_CONTEXT_MESSAGE_CHARS + 50))])
        assert detection_context(chat).history == ("a" * LANGUAGE_CONTEXT_MESSAGE_CHARS,)

    def test_skips_blank_turns(self) -> None:
        chat = _chat(
            "?",
            [Message(role=Role.USER, content="   "), Message(role=Role.USER, content="oi tudo bem")],
        )
        assert detection_context(chat).history == ("oi tudo bem",)

    def test_carries_the_hub_default_language(self) -> None:
        assert detection_context(_chat("?", default_language="pt")).default_language == "pt"

    def test_carries_supported_languages(self) -> None:
        chat = _chat("?", default_language="pt", supported_languages=["pt", "en"])
        assert detection_context(chat).supported_languages == ("pt", "en")

    def test_supported_languages_empty_without_personalization(self) -> None:
        assert detection_context(_chat("?")).supported_languages == ()

    def test_default_language_none_without_personalization(self) -> None:
        assert detection_context(_chat("?")).default_language is None


class TestDetectPassesContext:
    async def test_current_message_gets_history_and_default_language(self) -> None:
        chat = _chat(
            "Como saber onde devo votar?",
            [
                Message(role=Role.USER, content="qual a ordem de votação?"),
                Message(role=Role.ASSISTANT, content="Você está inscrito em São Paulo."),
            ],
            default_language="pt",
        )
        with patch(
            "app.services.language.detect_language_llm",
            new_callable=AsyncMock,
            return_value=("pt", LLM_CONFIDENCE),
        ) as m:
            lang, _ = await detect(chat)
        assert lang == "pt"
        m.assert_called_once_with(
            "Como saber onde devo votar?",
            DetectionContext(history=("qual a ordem de votação?",), default_language="pt"),
        )

    async def test_current_message_gets_supported_languages(self) -> None:
        chat = _chat("ola", default_language="pt", supported_languages=["pt", "en"])
        with patch(
            "app.services.language.detect_language_llm",
            new_callable=AsyncMock,
            return_value=("pt", LLM_CONFIDENCE),
        ) as m:
            await detect(chat)
        m.assert_called_once_with(
            "ola",
            DetectionContext(default_language="pt", supported_languages=("pt", "en")),
        )


class TestContextPrompt:
    def test_omitted_without_signals(self) -> None:
        assert _format_context(None) == ""
        assert _format_context(DetectionContext()) == ""

    def test_lists_the_turns(self) -> None:
        block = _format_context(DetectionContext(history=("qual a ordem de votação?", "e a biometria?")))
        assert "- qual a ordem de votação?" in block
        assert "- e a biometria?" in block

    def test_names_the_default_language(self) -> None:
        assert "pt" in _format_context(DetectionContext(default_language="pt"))

    def test_lists_supported_languages_and_marks_the_default(self) -> None:
        block = _format_context(DetectionContext(default_language="pt", supported_languages=("pt", "en")))
        assert "pt (default)" in block
        assert "en" in block

    def test_ranks_history_above_hub_languages(self) -> None:
        block = _format_context(DetectionContext(default_language="pt")).lower()
        assert "prefer the earlier messages" in block
        assert "over the chatbot's languages" in block

    def test_hub_languages_are_the_grounding_signal_without_history(self) -> None:
        block = _format_context(DetectionContext(supported_languages=("pt", "en")))
        assert "no earlier messages" in block
        assert "typo" in block

    def test_frames_context_as_a_tiebreaker_not_a_filter(self) -> None:
        # a mid-conversation switch, or a user writing in a language the hub refuses, must still win
        assert "ignore all of it" in _format_context(DetectionContext(default_language="pt"))

    def test_instructions_cover_accents_and_related_languages(self) -> None:
        assert "accents" in _INSTRUCTIONS.lower()
        assert "Portuguese" in _INSTRUCTIONS


class TestDetectFromHistory:
    async def test_empty_history(self) -> None:
        assert await detect_from_history(_chat("x", None)) == (None, 0.0)
        assert await detect_from_history(_chat("x", [])) == (None, 0.0)


class TestDetectText:
    async def test_delegates_to_detect_message(self) -> None:
        with patch(
            "app.services.language.detect_language_llm",
            new_callable=AsyncMock,
            return_value=("fr", LLM_CONFIDENCE),
        ):
            assert await detect_text("Bonjour le monde") == ("fr", LLM_CONFIDENCE)

    async def test_returns_none_tuple_when_undetectable(self) -> None:
        with patch("app.services.language.detect_language_llm", new_callable=AsyncMock) as m:
            assert await detect_text("!!!") == (None, 0.0)
        m.assert_not_called()

    async def test_truncates_before_llm(self) -> None:
        with patch(
            "app.services.language.detect_language_llm",
            new_callable=AsyncMock,
            return_value=("en", LLM_CONFIDENCE),
        ) as m:
            await detect_text("e" * (LANGUAGE_DETECTION_CHAR_LIMIT + 50))
        m.assert_called_once()
        assert len(m.call_args[0][0]) == LANGUAGE_DETECTION_CHAR_LIMIT


class TestDetectLanguageLlm:
    async def test_returns_out_of_set_verdict(self) -> None:
        with patch("app.services.language._llm._classify", new_callable=AsyncMock, return_value="si"):
            assert await detect_language_llm("සිංහල පණිවිඩයක්") == ("si", LLM_CONFIDENCE)

    async def test_returns_verdict(self) -> None:
        with patch("app.services.language._llm._classify", new_callable=AsyncMock, return_value="es"):
            assert await detect_language_llm("algún texto") == ("es", LLM_CONFIDENCE)

    async def test_handles_unknown(self) -> None:
        with patch("app.services.language._llm._classify", new_callable=AsyncMock, return_value="unknown"):
            assert await detect_language_llm("???") is None

    async def test_rejects_invalid_code(self) -> None:
        for bad in ["spanish", "e", "es-MX", "the language is spanish"]:
            with patch("app.services.language._llm._classify", new_callable=AsyncMock, return_value=bad):
                assert await detect_language_llm("algún texto") is None

    async def test_swallows_errors(self) -> None:
        with patch("app.services.language._llm._classify", new_callable=AsyncMock, side_effect=RuntimeError("boom")):
            assert await detect_language_llm("algún texto") is None


class TestReplyScriptInstruction:
    """A resolved script replaces the hindi/hinglish heuristics in lightweight prompts:
    "hi" alone cannot express romanized hindi, so the script travels as its own line."""

    def test_resolved_script_emits_explicit_script_line(self) -> None:
        lines = reply_language_instructions("ur", "Arab")
        joined = "\n".join(lines)
        assert "ISO 15924 code: Arab" in joined
        assert "Do NOT transliterate" in joined

    def test_resolved_script_replaces_hindi_heuristics(self) -> None:
        joined = "\n".join(reply_language_instructions("hi", "Deva"))
        assert "ISO 15924 code: Deva" in joined
        assert HINDI_SCRIPT_RULES not in joined

    def test_hindi_without_script_keeps_heuristics(self) -> None:
        joined = "\n".join(reply_language_instructions("hi"))
        assert HINDI_SCRIPT_RULES in joined

    def test_script_without_language_emits_nothing(self) -> None:
        # with no reply language there is nothing for a script to qualify
        assert reply_language_instructions(None, "Deva") == []


class TestSupportedLanguagesConfig:
    def test_invalid_language_code_logs_warning(self) -> None:
        with patch("app.core.config.logger") as mock_logger:
            with patch.dict("os.environ", {"SUPPORTED_LANGUAGES": '["en", "xx"]'}):
                config = Config()
                assert "en" in config.supported_languages
                assert "xx" in config.supported_languages
                mock_logger.warning.assert_called_once()
                assert "xx" in str(mock_logger.warning.call_args)
