from unittest.mock import AsyncMock, MagicMock, patch

from app.core.llm_config import LLMProfile
from app.models.chat import ChatRequest, ExternalResource, PersonalizationSettings
from app.services.router.models import QueryIntent
from app.services.router.prompts import SCENARIO_REPLY_RESOURCE_GROUNDING


def _router_mocks(
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
) -> MagicMock:
    mock_config.return_value.router_enable_internal_kb = False
    mock_config.return_value.router_enable_yago = False
    mock_config.return_value.router_unified_classifier_decomposer = False
    mock_config.return_value.router_use_llm_classifier = True

    mock_language.detect = AsyncMock(return_value=("en", 0.99))
    mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
    mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
    mock_language.detect_text = AsyncMock(return_value=("en", 0.99))

    mock_classifier = MagicMock()
    mock_classifier.is_non_question.return_value = False
    mock_classifier.detect_scenario_intent.return_value = None
    mock_classifier_cls.return_value = mock_classifier
    return mock_classifier


def _personalization_with_resources() -> PersonalizationSettings:
    return PersonalizationSettings(
        name="TestBot",
        tone="advocate",
        external_resources=[
            ExternalResource(title="+1 555 1234", description="Support line", scenarios=["speak_to_person"]),
            ExternalResource(
                title="https://example.org/store",
                description="Online store",
                scenarios=["purchase_subscribe"],
            ),
        ],
    )


class TestScenarioIntentRouter:
    @patch("app.services.router.rag_router.create_chat_model")
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_early_heuristic_speak_to_person_with_resources(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_language: MagicMock,
        mock_create_chat_model: MagicMock,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        mock_classifier = _router_mocks(mock_config, mock_classifier_cls, mock_language)
        mock_classifier.detect_scenario_intent.return_value = QueryIntent.SPEAK_TO_PERSON

        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(
            return_value=MagicMock(content="Of course! You can call +1 555 1234 to speak with someone.")
        )
        mock_create_chat_model.return_value = mock_llm

        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="Can I talk to a real person?",
            personalization=_personalization_with_resources(),
        )
        router = RAGRouter(hub_id=1)
        response = await router.route(chat)

        assert response.error_type is None
        assert response.metadata is not None
        assert response.metadata.router_intent == "speak_to_person"
        assert response.metadata.temporal_type == "none"
        assert response.metadata.synthesis_type is None
        assert response.metadata.question_type == "speak_to_person"
        assert "+1 555 1234" in response.answer
        mock_classifier.classify.assert_not_called()

    @patch("app.services.router.rag_router.create_chat_model")
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_early_heuristic_purchase_subscribe_services_inquiry(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_language: MagicMock,
        mock_create_chat_model: MagicMock,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        mock_classifier = _router_mocks(mock_config, mock_classifier_cls, mock_language)
        mock_classifier.detect_scenario_intent.return_value = QueryIntent.PURCHASE_SUBSCRIBE

        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(
            return_value=MagicMock(content="Learn more at https://example.org/store about our services.")
        )
        mock_create_chat_model.return_value = mock_llm

        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="Can I know more about your services?",
            personalization=_personalization_with_resources(),
        )
        router = RAGRouter(hub_id=1)
        response = await router.route(chat)

        assert response.metadata is not None
        assert response.metadata.router_intent == "purchase_subscribe"
        assert response.metadata.temporal_type == "none"
        assert response.metadata.question_type == "purchase_subscribe"
        assert "https://example.org/store" in response.answer
        mock_classifier.classify.assert_not_called()

    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_try_handle_returns_none_without_resources(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        mock_config.return_value.router_enable_internal_kb = False
        mock_config.return_value.router_enable_yago = False

        chat = ChatRequest(hub_id=1, message_id=1, message="Can I talk to a real person?")
        router = RAGRouter(hub_id=1)
        result = await router._try_handle_scenario_intent(chat, QueryIntent.SPEAK_TO_PERSON, "en", 0.0, {})

        assert result is None

    @patch("app.services.router.rag_router.create_chat_model")
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_post_classification_speak_to_person_with_resources(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_language: MagicMock,
        mock_create_chat_model: MagicMock,
    ) -> None:
        from app.services.router.models import ClassificationResult
        from app.services.router.rag_router import RAGRouter

        mock_classifier = _router_mocks(mock_config, mock_classifier_cls, mock_language)
        mock_classifier.detect_scenario_intent.return_value = None
        mock_classifier.classify = AsyncMock(
            return_value=ClassificationResult(
                intent=QueryIntent.SPEAK_TO_PERSON,
                routes=[],
                used_llm=True,
                reasoning="LLM detected human contact request",
            )
        )

        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=MagicMock(content="You can reach us at +1 555 1234."))
        mock_create_chat_model.return_value = mock_llm

        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="I need to reach someone on your team",
            personalization=_personalization_with_resources(),
        )
        router = RAGRouter(hub_id=1)
        response = await router.route(chat)

        assert response.metadata is not None
        assert response.metadata.router_intent == "speak_to_person"
        assert "+1 555 1234" in response.answer
        mock_classifier.classify.assert_called_once()

    @patch("app.services.router.rag_router.create_chat_model")
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_scenario_llm_failure_includes_resource_titles(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_language: MagicMock,
        mock_create_chat_model: MagicMock,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        mock_classifier = _router_mocks(mock_config, mock_classifier_cls, mock_language)
        mock_classifier.detect_scenario_intent.return_value = QueryIntent.PURCHASE_SUBSCRIBE
        mock_create_chat_model.side_effect = RuntimeError("LLM unavailable")

        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="I want to buy your stuff",
            personalization=_personalization_with_resources(),
        )
        router = RAGRouter(hub_id=1)
        response = await router.route(chat)

        assert "https://example.org/store" in response.answer

    @patch("app.services.router.rag_router.create_chat_model")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_scenario_reply_uses_grounding_prompt_and_scenario_llm_profile(
        self,
        mock_llm_config_cls: MagicMock,
        mock_config: MagicMock,
        mock_create_chat_model: MagicMock,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        scenario_profile = LLMProfile(temperature=0.0, max_tokens=500)
        mock_llm_config = MagicMock()
        mock_llm_config.llm_scenario_reply = scenario_profile
        mock_llm_config_cls.return_value = mock_llm_config

        captured_messages: list[tuple[str, str]] = []

        async def capture_invoke(messages: list[tuple[str, str]]) -> MagicMock:
            captured_messages.extend(messages)
            return MagicMock(content="You can reach us at hello@example.org.")

        mock_llm = MagicMock()
        mock_llm.ainvoke = capture_invoke
        mock_create_chat_model.return_value = mock_llm

        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="Can I talk to a human?",
            personalization=PersonalizationSettings(
                hub_name="Meedan",
                external_resources=[
                    ExternalResource(title="hello@example.org", scenarios=["speak_to_person"]),
                ],
            ),
        )
        router = RAGRouter(hub_id=1)
        handling = router._SCENARIO_HANDLING[QueryIntent.SPEAK_TO_PERSON]
        resources = [ExternalResource(title="hello@example.org", scenarios=["speak_to_person"])]

        await router._generate_scenario_reply(chat, handling, resources, "en")

        mock_create_chat_model.assert_called_once_with(scenario_profile, mock_llm_config)
        system_prompt = captured_messages[0][1]
        assert SCENARIO_REPLY_RESOURCE_GROUNDING in system_prompt
        assert "Do not use training data" in system_prompt
