from unittest.mock import AsyncMock, MagicMock, patch

from app.models.chat import ChatRequest, ErrorType, Message, PersonalizationSettings, Role
from app.services.language._llm import DetectionContext
from app.services.router.models import ClassificationResult, KnowledgeSource, QueryIntent, RouteDecision
from app.services.router.rag_router import CLASSIFIER_LANGUAGE_CONFIDENCE, _classifier_language


def _chat(supported_languages: list[str] | None = None) -> ChatRequest:
    personalization = (
        PersonalizationSettings(supported_languages=supported_languages) if supported_languages is not None else None
    )
    return ChatRequest(hub_id=1, message_id=1, message="test", personalization=personalization)


def _classification(message_language: str | None) -> ClassificationResult:
    return ClassificationResult(intent=QueryIntent.QUESTION, routes=[], message_language=message_language)


class TestClassifierLanguageOverride:
    def test_corrects_in_set_proper_noun_misfire(self) -> None:
        # the nicaragua trap: detector confidently claims spanish for an english message
        assert _classifier_language(_chat(["en", "es"]), _classification("en"), "es") == "en"

    def test_agreement_returns_none(self) -> None:
        assert _classifier_language(_chat(["en", "es"]), _classification("es"), "es") is None

    def test_no_verdict_returns_none(self) -> None:
        assert _classifier_language(_chat(["en", "es"]), _classification(None), "es") is None

    def test_out_of_hub_set_verdict_blocked(self) -> None:
        # the guarani trap inverted: the llm itself names a language the hub refuses to serve
        assert _classifier_language(_chat(["en", "es"]), _classification("gn"), "es") is None

    def test_unrestricted_hub_accepts_any_code(self) -> None:
        assert _classifier_language(_chat(None), _classification("de"), "en") == "de"

    def test_empty_supported_list_treated_as_unrestricted(self) -> None:
        assert _classifier_language(_chat([]), _classification("de"), "en") == "de"

    def test_fills_missing_provisional_detection(self) -> None:
        # romanized hindi: statistical detectors return nothing, the classifier still knows
        assert _classifier_language(_chat(["hi", "en"]), _classification("hi"), None) == "hi"

    def test_confidence_constant_matches_llm_confidence(self) -> None:
        from app.services.language._llm import LLM_CONFIDENCE

        assert CLASSIFIER_LANGUAGE_CONFIDENCE == LLM_CONFIDENCE


def _router_mocks(
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_errors: MagicMock,
) -> MagicMock:
    mock_config.return_value.router_enable_internal_kb = False
    mock_config.return_value.router_enable_yago = False
    mock_config.return_value.router_unified_classifier_decomposer = False
    mock_config.return_value.router_use_llm_classifier = True
    mock_config.return_value.router_enable_decomposition = False
    mock_config.return_value.topic_extraction_enabled = False

    mock_errors.validate_chat_message.return_value = None
    mock_errors.get_error_message.return_value = "no answer available"

    mock_classifier = MagicMock()
    mock_classifier.is_non_question.return_value = False
    mock_classifier.detect_scenario_intent.return_value = None
    mock_classifier_cls.return_value = mock_classifier
    return mock_classifier


class TestPreflightLanguageContext:
    """The preflight verdict can refuse the user outright, so it gets the history as a tiebreaker."""

    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_detector_receives_prior_user_turns(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_errors: MagicMock,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        _router_mocks(mock_config, mock_classifier_cls, MagicMock(), mock_errors)
        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="Como saber onde devo votar?",
            history=[
                Message(role=Role.USER, content="qual a ordem de votação?"),
                Message(role=Role.ASSISTANT, content="Você está inscrito em São Paulo."),
            ],
            personalization=PersonalizationSettings(default_language="pt", supported_languages=["pt"]),
        )

        with patch("app.services.language.detect_message", new=AsyncMock(return_value=("pt", 0.95))) as mock_detect:
            result = await RAGRouter(hub_id=1)._preflight(chat, 0.0, {})

        assert mock_detect.call_args.args[1] == DetectionContext(
            history=("qual a ordem de votação?",), default_language="pt", supported_languages=("pt",)
        )
        assert result.early_response is None
        assert result.lang == "pt"


class TestRouteAppliesClassifierLanguage:
    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_in_set_misdetection_corrected_in_metadata(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_language: MagicMock,
        mock_errors: MagicMock,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        mock_classifier = _router_mocks(mock_config, mock_classifier_cls, mock_language, mock_errors)
        # detector confidently misreads the english toponym question as spanish
        mock_language.detect = AsyncMock(return_value=("es", 0.97))
        mock_language.detect_message = AsyncMock(return_value=("es", 0.97))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("es", 0.97))
        mock_classifier.classify = AsyncMock(
            return_value=ClassificationResult(
                intent=QueryIntent.QUESTION,
                routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.5, priority=0)],
                used_llm=True,
                message_language="en",
            )
        )

        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="Is Nicaragua safe to travel to right now?",
            personalization=PersonalizationSettings(supported_languages=["en", "es"]),
        )
        response = await RAGRouter(hub_id=1).route(chat)

        assert response.error_type == ErrorType.NO_ANSWER_AVAILABLE
        assert response.metadata is not None
        assert response.metadata.language == "en"
        assert response.metadata.retriever_detected_lang == "en"
        # the fallback message must be requested in the corrected language too
        assert mock_errors.get_error_message.call_args.args[1] == "en"

    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_out_of_hub_set_verdict_keeps_provisional(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_language: MagicMock,
        mock_errors: MagicMock,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        mock_classifier = _router_mocks(mock_config, mock_classifier_cls, mock_language, mock_errors)
        mock_language.detect = AsyncMock(return_value=("es", 0.97))
        mock_language.detect_message = AsyncMock(return_value=("es", 0.97))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("es", 0.97))
        mock_classifier.classify = AsyncMock(
            return_value=ClassificationResult(
                intent=QueryIntent.QUESTION,
                routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.5, priority=0)],
                used_llm=True,
                message_language="gn",
            )
        )

        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="¿Paraguay ha ayudado a Cuba?",
            personalization=PersonalizationSettings(supported_languages=["en", "es"]),
        )
        response = await RAGRouter(hub_id=1).route(chat)

        assert response.metadata is not None
        assert response.metadata.language == "es"
        assert response.metadata.retriever_detected_lang == "es"


class TestScriptTrustGuard:
    """The script verdict may only survive alongside a validated language verdict: models garble
    the language field, and a surviving script over a fallback language would demand
    transliterating the hub default. Latn never survives at all: it is the script the prompts
    already assume, and an explicit rule for it reshapes every english and romanized prompt
    for zero information. Asserted through the resolution log line, the observable this
    rule feeds."""

    async def _route_and_capture(
        self,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_language: MagicMock,
        mock_errors: MagicMock,
        classification: ClassificationResult,
    ) -> str:
        from loguru import logger

        from app.services.router.rag_router import RAGRouter

        mock_classifier = _router_mocks(mock_config, mock_classifier_cls, mock_language, mock_errors)
        mock_language.detect = AsyncMock(return_value=("hi", 0.97))
        mock_language.detect_message = AsyncMock(return_value=("hi", 0.97))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("hi", 0.97))
        mock_classifier.classify = AsyncMock(return_value=classification)

        chat = ChatRequest(hub_id=1, message_id=1, message="kya hua?")
        messages: list[str] = []
        sink_id = logger.add(messages.append, level="INFO")
        try:
            await RAGRouter(hub_id=1).route(chat)
        finally:
            logger.remove(sink_id)
        return next(m for m in messages if "Reply language resolved" in m)

    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_non_latin_script_survives_with_language_verdict(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_language: MagicMock,
        mock_errors: MagicMock,
    ) -> None:
        resolved = await self._route_and_capture(
            mock_config,
            mock_classifier_cls,
            mock_language,
            mock_errors,
            ClassificationResult(
                intent=QueryIntent.QUESTION,
                routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.5, priority=0)],
                used_llm=True,
                message_language="hi",
                message_script="Deva",
            ),
        )
        assert "script='Deva'" in resolved

    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_latin_script_never_propagates(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_language: MagicMock,
        mock_errors: MagicMock,
    ) -> None:
        # romanized hindi stays covered by the heuristic hindi/hinglish rules
        resolved = await self._route_and_capture(
            mock_config,
            mock_classifier_cls,
            mock_language,
            mock_errors,
            ClassificationResult(
                intent=QueryIntent.QUESTION,
                routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.5, priority=0)],
                used_llm=True,
                message_language="hi",
                message_script="Latn",
            ),
        )
        assert "script=None" in resolved

    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_script_dropped_without_language_verdict(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_language: MagicMock,
        mock_errors: MagicMock,
    ) -> None:
        # a script paired with a garbled (parsed-to-None) language verdict must not leak
        resolved = await self._route_and_capture(
            mock_config,
            mock_classifier_cls,
            mock_language,
            mock_errors,
            ClassificationResult(
                intent=QueryIntent.QUESTION,
                routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.5, priority=0)],
                used_llm=True,
                message_language=None,
                message_script="Deva",
            ),
        )
        assert "script=None" in resolved
