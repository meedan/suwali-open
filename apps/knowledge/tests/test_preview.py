from unittest.mock import MagicMock, patch

from app.models.chat import ChatRequest, PersonalizationSettings
from app.services.preview import (
    PreviewRetriever,
    _get_scenario_context,
    _get_scenario_question,
    generate_preview_response,
)


def test_get_scenario_question_role_description() -> None:
    question = _get_scenario_question("role_description")
    assert "help" in question.lower()


def test_get_scenario_question_unanswerable() -> None:
    question = _get_scenario_question("unanswerable_question")
    assert "not in your knowledge base" in question.lower()


def test_get_scenario_question_error() -> None:
    question = _get_scenario_question("error_occurred")
    assert "help" in question.lower()


def test_get_scenario_question_default() -> None:
    question = _get_scenario_question("unknown")
    assert question == "Hello"


def test_get_scenario_context_role_description() -> None:
    context = _get_scenario_context("role_description")
    assert "=== text ===" in context
    assert "=== kg_rels ===" in context
    assert "assistance" in context.lower()


def test_get_scenario_context_unanswerable() -> None:
    context = _get_scenario_context("unanswerable_question")
    assert "=== text ===" in context
    assert "No relevant information" in context


def test_get_scenario_context_error() -> None:
    context = _get_scenario_context("error_occurred")
    assert "=== text ===" in context
    assert "error" in context.lower()


@patch("app.services.preview.PreviewRetriever")
def test_generate_preview_response(mock_preview_retriever_class: MagicMock) -> None:
    mock_retriever = MagicMock()
    mock_result = MagicMock()
    mock_result.answer = "I'm TestBot. I help users."
    mock_retriever.graph_rag.search.return_value = mock_result
    mock_preview_retriever_class.return_value = mock_retriever

    personalization = PersonalizationSettings(name="TestBot", tone="journalist")

    result = generate_preview_response("role_description", personalization)

    assert "TestBot" in result
    mock_preview_retriever_class.assert_called_once()
    mock_retriever.graph_rag.search.assert_called_once()


@patch("app.services.preview.PreviewRetriever")
def test_generate_preview_response_with_external_resources(mock_preview_retriever_class: MagicMock) -> None:
    mock_retriever = MagicMock()
    mock_result = MagicMock()
    mock_result.answer = "Check https://example.com/guide for more info."
    mock_retriever.graph_rag.search.return_value = mock_result
    mock_preview_retriever_class.return_value = mock_retriever

    from app.models.chat import ExternalResource

    personalization = PersonalizationSettings(
        name="HelpBot",
        tone="advocate",
        external_resources=[
            ExternalResource(
                title="https://example.com/guide", description="User guide", scenarios=["role_description"]
            )
        ],
    )

    result = generate_preview_response("role_description", personalization)

    assert "https://example.com/guide" in result
    mock_preview_retriever_class.assert_called_once()


def test_get_scenario_question_first_message() -> None:
    question = _get_scenario_question("first_message")
    assert "new here" in question.lower()


def test_get_scenario_context_first_message() -> None:
    context = _get_scenario_context("first_message")
    assert "=== text ===" in context
    assert "Welcome" in context


def test_get_scenario_context_conversation_closed() -> None:
    context = _get_scenario_context("conversation_closed", "pt")
    assert "closing message" in context
    assert "include ALL of them" in context
    assert "If none are listed, do not mention resources" in context
    assert "MUST be written in pt language" in context


def test_get_scenario_context_conversation_closed_thanks_only_with_resources() -> None:
    without = _get_scenario_context("conversation_closed")
    with_resources = _get_scenario_context("conversation_closed", has_resources=True, listed_resource_count=1)
    assert "Thanks for chatting" not in without
    assert "this conversation has closed" in without
    assert "Thanks for chatting" in with_resources
    assert "this conversation has closed" not in with_resources


def test_get_scenario_context_conversation_closed_lists_three_or_more_resources() -> None:
    few = _get_scenario_context("conversation_closed", has_resources=True, listed_resource_count=2)
    many = _get_scenario_context("conversation_closed", has_resources=True, listed_resource_count=3)
    assert "woven naturally into a sentence" in few
    assert "final paragraph of its own" in few
    assert "woven naturally" not in many
    assert "share the same or nearly the same description form a group" in many
    assert 'each resource on its own line starting with "- "' in many


@patch("app.services.preview.PreviewRetriever")
def test_generate_preview_response_first_message(mock_preview_retriever_class: MagicMock) -> None:
    mock_retriever = MagicMock()
    mock_result = MagicMock()
    mock_result.answer = "Welcome. TestBot is here to help you with questions for Test Org."
    mock_retriever.graph_rag.search.return_value = mock_result
    mock_preview_retriever_class.return_value = mock_retriever

    personalization = PersonalizationSettings(name="TestBot", tone="journalist", hub_name="Test Org")

    result = generate_preview_response("first_message", personalization)

    assert "Welcome" in result
    mock_preview_retriever_class.assert_called_once()
    mock_retriever.graph_rag.search.assert_called_once()


@patch("app.services.preview.PreviewRetriever")
def test_generate_preview_response_speak_to_person_includes_resource(mock_preview_retriever_class: MagicMock) -> None:
    mock_retriever = MagicMock()
    mock_result = MagicMock()
    mock_result.answer = "You can contact us at support@example.org."
    mock_retriever.graph_rag.search.return_value = mock_result
    mock_preview_retriever_class.return_value = mock_retriever

    from app.models.chat import ExternalResource

    personalization = PersonalizationSettings(
        name="HelpBot",
        external_resources=[
            ExternalResource(title="support@example.org", scenarios=["speak_to_person"]),
        ],
    )

    result = generate_preview_response("speak_to_person", personalization)
    assert "support@example.org" in result
    mock_preview_retriever_class.assert_called_once()


@patch("app.services.preview.PreviewRetriever")
def test_generate_preview_response_purchase_subscribe_includes_resource(
    mock_preview_retriever_class: MagicMock,
) -> None:
    mock_retriever = MagicMock()
    mock_result = MagicMock()
    mock_result.answer = "Visit https://example.com/subscribe to subscribe."
    mock_retriever.graph_rag.search.return_value = mock_result
    mock_preview_retriever_class.return_value = mock_retriever

    from app.models.chat import ExternalResource

    personalization = PersonalizationSettings(
        name="HelpBot",
        external_resources=[
            ExternalResource(title="https://example.com/subscribe", scenarios=["purchase_subscribe"]),
        ],
    )

    result = generate_preview_response("purchase_subscribe", personalization)
    assert "https://example.com/subscribe" in result
    mock_preview_retriever_class.assert_called_once()


@patch("app.services.preview.PreviewRetriever")
def test_generate_preview_response_filters_resources_to_selected_scenario(
    mock_preview_retriever_class: MagicMock,
) -> None:
    mock_retriever = MagicMock()
    mock_result = MagicMock()
    mock_result.answer = "Please contact support@example.org"
    mock_retriever.graph_rag.search.return_value = mock_result
    mock_preview_retriever_class.return_value = mock_retriever

    from app.models.chat import ExternalResource

    role_resource = ExternalResource(title="https://example.com/role", scenarios=["role_description"])
    speak_resource = ExternalResource(title="support@example.org", scenarios=["speak_to_person"])

    personalization = PersonalizationSettings(
        external_resources=[role_resource, speak_resource],
    )

    generate_preview_response("speak_to_person", personalization)

    args, _ = mock_preview_retriever_class.call_args
    chat_request = args[0]
    assert chat_request.personalization is not None
    assert chat_request.personalization.external_resources == [speak_resource]


@patch("app.services.preview.PreviewRetriever")
@patch("app.services.preview.errors.get_error_message")
def test_generate_preview_response_unanswerable_surfaces_resources(
    mock_get_error_message: MagicMock, mock_preview_retriever_class: MagicMock
) -> None:
    """Unanswerable scenario must mirror real chat: resources surfaced via the error path,
    not the grounded RAG prompt (which would refuse and drop them)."""
    from app.models.chat import ErrorType, ExternalResource

    mock_get_error_message.return_value = "I couldn't find an answer. Contact https://help.example.com for support."

    resource = ExternalResource(
        title="https://help.example.com", description="General help", scenarios=["unanswerable_question"]
    )
    personalization = PersonalizationSettings(name="HelpBot", external_resources=[resource])

    result = generate_preview_response("unanswerable_question", personalization)

    assert "https://help.example.com" in result
    # the grounded RAG retriever must not be used for this scenario
    mock_preview_retriever_class.assert_not_called()
    mock_get_error_message.assert_called_once()
    args, kwargs = mock_get_error_message.call_args
    assert args[0] == ErrorType.NO_ANSWER_AVAILABLE
    assert kwargs["external_resources"] == [resource]
    assert kwargs["force_all_resources"] is False


@patch("app.services.preview.PreviewRetriever")
@patch("app.services.preview.errors.get_error_message")
def test_generate_preview_response_error_surfaces_resources(
    mock_get_error_message: MagicMock, mock_preview_retriever_class: MagicMock
) -> None:
    """Error scenario must mirror real chat: resources surfaced via the error path
    (force_all_resources=True), not the grounded RAG prompt."""
    from app.models.chat import ErrorType, ExternalResource

    mock_get_error_message.return_value = "Something went wrong. Contact https://help.example.com for support."

    resource = ExternalResource(title="https://help.example.com", description="Support", scenarios=["error_occurred"])
    personalization = PersonalizationSettings(name="HelpBot", external_resources=[resource])

    result = generate_preview_response("error_occurred", personalization)

    assert "https://help.example.com" in result
    mock_preview_retriever_class.assert_not_called()
    mock_get_error_message.assert_called_once()
    args, kwargs = mock_get_error_message.call_args
    assert args[0] == ErrorType.INTERNAL_ERROR
    assert kwargs["external_resources"] == [resource]
    assert "force_all_resources" not in kwargs or kwargs["force_all_resources"] is True


@patch("app.services.preview.language.detect")
def test_preview_retriever_init_has_llm_config(mock_detect: MagicMock) -> None:
    """Test that PreviewRetriever initializes llm_config required by _init_graph_rag."""
    mock_detect.return_value = ("en", 0.99)

    chat = ChatRequest(hub_id=0, message_id=0, message="test")
    retriever = PreviewRetriever(chat, "role_description")

    assert retriever.llm_config is not None
    assert retriever.graph_rag is not None


def test_preview_retriever_persona_prompt_includes_resources() -> None:
    from app.models.chat import ExternalResource

    chat = ChatRequest(
        hub_id=0,
        message_id=0,
        message="hi",
        personalization=PersonalizationSettings(
            name="HelpBot",
            external_resources=[ExternalResource(title="support@example.org", scenarios=["speak_to_person"])],
        ),
    )
    retriever = PreviewRetriever.__new__(PreviewRetriever)
    retriever.chat = chat

    persona = PreviewRetriever._persona_prompt(retriever)

    assert "support@example.org" in persona
    assert "External Resources:" in persona
