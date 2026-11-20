import re
from typing import Any
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

from app.models.chat import (
    AddContextNote,
    ChatResponse,
    ChatStatus,
    ContextNote,
    DurationKey,
    ErrorType,
    Metadata,
    RemoveContextNote,
)
from app.services.neo4j_timing import neo4j_query_timer, neo4j_stage
from app.tasks.callback import dispatch_callback
from app.tasks.chat import process_chat

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _enqueued_body(mock_queue_class: MagicMock) -> dict[str, Any]:
    """Return the callback body passed to Queue.enqueue."""
    return mock_queue_class.return_value.enqueue.call_args[0][2]  # type: ignore[no-any-return]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_success(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    mock_router_class.return_value.route = AsyncMock(
        return_value=ChatResponse(answer="The answer", metadata=Metadata(documents_count=3))
    )
    mock_config.return_value.rq_retry_max = 3

    await process_chat(
        hub_id=1,
        message_id=42,
        message="What is love?",
        callback_url="http://example.com/callback",
    )

    mock_router_class.assert_called_once()
    assert mock_router_class.call_args[0][0] == 1
    assert mock_router_class.call_args[1]["status_callback"] is not None
    mock_router_class.return_value.route.assert_called_once()

    # Final callback must be enqueued, not sent inline
    mock_queue_instance = mock_queue_class.return_value
    mock_queue_instance.enqueue.assert_called_once()
    enqueue_args = mock_queue_instance.enqueue.call_args[0]
    assert enqueue_args[0] is dispatch_callback
    assert enqueue_args[1] == "http://example.com/callback"
    body = enqueue_args[2]
    assert body["status"] == ChatStatus.COMPLETE
    assert body["payload"]["answer"] == "The answer"
    assert body["payload"]["error_type"] is None
    assert body["payload"]["topics"] == []

    # send_chat_status_sync is only for intermediate statuses, not final callbacks
    mock_send_status_sync.assert_not_called()
    mock_publish_metric.assert_called_once()
    assert mock_publish_metric.call_args[0][0] == "answer.generated"


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_includes_neo4j_duration_details_in_callback(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    async def route(_: Any) -> ChatResponse:
        with neo4j_stage(DurationKey.INITIAL_SEARCH), neo4j_query_timer():
            pass
        return ChatResponse(answer="The answer", metadata=Metadata(documents_count=3))

    mock_router_class.return_value.route = AsyncMock(side_effect=route)
    mock_config.return_value.rq_retry_max = 3

    await process_chat(hub_id=1, message_id=42, message="What is love?", callback_url="http://example.com/callback")

    timings = _enqueued_body(mock_queue_class)["payload"]["metadata"]["neo4j_duration_details"]
    assert set(timings) == {DurationKey.INITIAL_SEARCH}
    assert len(timings[DurationKey.INITIAL_SEARCH]["queries"]) == 1
    assert timings[DurationKey.INITIAL_SEARCH]["stage_ms"] is not None


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_omits_neo4j_duration_details_without_queries(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    mock_router_class.return_value.route = AsyncMock(return_value=ChatResponse(answer="Hi", metadata=Metadata()))
    mock_config.return_value.rq_retry_max = 3

    await process_chat(hub_id=1, message_id=42, message="Hello", callback_url="http://example.com/callback")

    assert _enqueued_body(mock_queue_class)["payload"]["metadata"]["neo4j_duration_details"] is None


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_chat_duration_details_metrics")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_publishes_question_type_metric(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_publish_duration_details: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    mock_router_class.return_value.route = AsyncMock(
        return_value=ChatResponse(answer="The answer", metadata=Metadata(question_type="question"))
    )
    mock_config.return_value.rq_retry_max = 3

    await process_chat(
        hub_id=1,
        message_id=42,
        message="What is love?",
        callback_url="http://example.com/callback",
    )

    assert mock_publish_metric.call_count == 2
    hub_call, question_type_call = mock_publish_metric.call_args_list
    assert hub_call.args[0] == "answer.generated"
    assert hub_call.kwargs == {"unit": "Milliseconds", "hub_id": 1}
    assert question_type_call.args[0] == "answer.generated"
    assert question_type_call.kwargs == {"unit": "Milliseconds", "question_type": "question"}
    assert mock_publish_duration_details.call_args.kwargs == {"hub_id": 1, "question_type": "question"}


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_with_error_type(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    mock_router_class.return_value.route = AsyncMock(
        return_value=ChatResponse(
            answer="Question too short",
            error_type=ErrorType.QUESTION_TOO_SHORT,
            metadata=Metadata(),
        )
    )
    mock_config.return_value.rq_retry_max = 3

    await process_chat(
        hub_id=1,
        message_id=10,
        message="Hi",
        callback_url="http://example.com/callback",
    )

    assert _enqueued_body(mock_queue_class)["payload"]["error_type"] == "QUESTION_TOO_SHORT"


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_exception_enqueues_error_callback(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    mock_router_class.return_value.route = AsyncMock(side_effect=Exception("Pipeline crashed"))
    mock_config.return_value.rq_retry_max = 3

    with pytest.raises(Exception, match="Pipeline crashed"):
        await process_chat(
            hub_id=1,
            message_id=99,
            message="What happened?",
            callback_url="http://example.com/callback",
        )

    mock_queue_instance = mock_queue_class.return_value
    mock_queue_instance.enqueue.assert_called_once()
    enqueue_args = mock_queue_instance.enqueue.call_args[0]
    assert enqueue_args[0] is dispatch_callback
    body = enqueue_args[2]
    assert body["status"] == ChatStatus.ERROR
    assert body["payload"] is None

    mock_publish_metric.assert_not_called()


@patch("app.tasks.chat.get_current_job")
@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_exception_skips_error_callback_when_retries_remain(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
    mock_get_current_job: MagicMock,
) -> None:
    """A failing attempt that RQ will retry must not report ERROR to the CMS yet —
    otherwise a successful retry would follow ERROR with COMPLETE."""
    mock_router_class.return_value.route = AsyncMock(side_effect=Exception("Pipeline crashed"))
    mock_config.return_value.rq_retry_max = 3
    mock_get_current_job.return_value.retries_left = 2

    with pytest.raises(Exception, match="Pipeline crashed"):
        await process_chat(
            hub_id=1,
            message_id=99,
            message="What happened?",
            callback_url="http://example.com/callback",
        )

    mock_queue_class.return_value.enqueue.assert_not_called()


@patch("app.tasks.chat.get_current_job")
@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_exception_enqueues_error_callback_on_final_attempt(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
    mock_get_current_job: MagicMock,
) -> None:
    mock_router_class.return_value.route = AsyncMock(side_effect=Exception("Pipeline crashed"))
    mock_config.return_value.rq_retry_max = 3
    mock_get_current_job.return_value.retries_left = 0

    with pytest.raises(Exception, match="Pipeline crashed"):
        await process_chat(
            hub_id=1,
            message_id=99,
            message="What happened?",
            callback_url="http://example.com/callback",
        )

    body = _enqueued_body(mock_queue_class)
    assert body["status"] == ChatStatus.ERROR
    assert body["payload"] is None


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_with_history_and_personalization(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    mock_router_class.return_value.route = AsyncMock(
        return_value=ChatResponse(answer="Personalized answer", metadata=Metadata())
    )
    mock_config.return_value.rq_retry_max = 3

    await process_chat(
        hub_id=2,
        message_id=7,
        message="Tell me more",
        history=[{"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi"}],
        personalization={"name": "TestBot", "tone": "journalist"},
        callback_url="http://example.com/callback",
    )

    chat_request = mock_router_class.return_value.route.call_args[0][0]
    assert chat_request.hub_id == 2
    assert chat_request.message == "Tell me more"
    assert len(chat_request.history) == 2
    assert chat_request.personalization.name == "TestBot"
    assert chat_request.personalization.tone == "journalist"


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_passes_recency_first_enabled(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    mock_router_class.return_value.route = AsyncMock(
        return_value=ChatResponse(answer="Recent answer", metadata=Metadata())
    )
    mock_config.return_value.rq_retry_max = 3

    await process_chat(
        hub_id=1,
        message_id=3,
        message="What's new?",
        callback_url="http://example.com/callback",
        recency_first_enabled=True,
    )

    chat_request = mock_router_class.return_value.route.call_args[0][0]
    assert chat_request.recency_first_enabled is True


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
@pytest.mark.parametrize("location_gate_enabled", [True, False, None])
async def test_process_chat_passes_location_gate_enabled(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
    location_gate_enabled: bool | None,
) -> None:
    mock_router_class.return_value.route = AsyncMock(return_value=ChatResponse(answer="Answer", metadata=Metadata()))
    mock_config.return_value.rq_retry_max = 3

    await process_chat(
        hub_id=1,
        message_id=3,
        message="When are the elections?",
        callback_url="http://example.com/callback",
        conversation_context=[],
        location_gate_enabled=location_gate_enabled,
    )

    chat_request = mock_router_class.return_value.route.call_args[0][0]
    assert chat_request.location_gate_enabled is location_gate_enabled


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_passes_existing_topics(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    mock_router = mock_router_class.return_value
    mock_router.route = AsyncMock(return_value=ChatResponse(answer="Answer", metadata=Metadata()))
    mock_config.return_value.rq_retry_max = 3

    await process_chat(
        hub_id=1,
        message_id=3,
        message="What about elections?",
        callback_url="http://example.com/callback",
        existing_topics=["Elections", "Climate Policy"],
    )

    chat_request = mock_router.route.call_args[0][0]
    assert chat_request.existing_topics == ["Elections", "Climate Policy"]


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_includes_topics_in_complete_callback(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    mock_router = mock_router_class.return_value
    mock_router.route = AsyncMock(
        return_value=ChatResponse(
            answer="The answer",
            metadata=Metadata(answerable=True),
            topics=["Elections", "Climate Policy"],
        )
    )
    mock_config.return_value.rq_retry_max = 3

    await process_chat(
        hub_id=1,
        message_id=4,
        message="What about elections?",
        callback_url="http://example.com/callback",
    )

    assert _enqueued_body(mock_queue_class)["payload"]["topics"] == ["Elections", "Climate Policy"]


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_notify_calls_intermediary_callback(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    """Verify the notify closure passed to RAGRouter sends intermediary callbacks inline."""
    mock_router_class.return_value.route = AsyncMock(return_value=ChatResponse(answer="Done", metadata=Metadata()))
    mock_config.return_value.rq_retry_max = 3

    await process_chat(
        hub_id=1,
        message_id=1,
        message="Test",
        callback_url="http://example.com/callback",
    )

    # Grab the status_callback closure and invoke it directly
    status_callback = mock_router_class.call_args[1]["status_callback"]
    status_callback("parsing_question", None)

    # Only the manually-invoked intermediary call goes through send_chat_status_sync;
    # the final COMPLETE callback is enqueued via Queue, not sent inline.
    assert mock_send_status_sync.call_count == 1
    assert mock_send_status_sync.call_args == call("http://example.com/callback", "parsing_question", payload=None)


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
@pytest.mark.parametrize(
    ("conversation_context", "expected"),
    [
        (None, None),  # feature off for this hub
        ([], []),  # feature on, no notes yet
        ([{"id": "1", "text": "Lives in Lagos"}], [ContextNote(id="1", text="Lives in Lagos")]),
    ],
)
async def test_process_chat_passes_conversation_context(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
    conversation_context: list[dict[str, str]] | None,
    expected: list[ContextNote] | None,
) -> None:
    mock_router = mock_router_class.return_value
    mock_router.route = AsyncMock(return_value=ChatResponse(answer="Answer", metadata=Metadata()))
    mock_config.return_value.rq_retry_max = 3

    await process_chat(
        hub_id=1,
        message_id=5,
        message="When are the elections?",
        callback_url="http://example.com/callback",
        conversation_context=conversation_context,
    )

    chat_request = mock_router.route.call_args[0][0]
    assert chat_request.conversation_context == expected


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_includes_context_updates_in_complete_callback(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    mock_router = mock_router_class.return_value
    mock_router.route = AsyncMock(
        return_value=ChatResponse(
            answer="Got it.",
            metadata=Metadata(),
            context_updates=[RemoveContextNote(id="1"), AddContextNote(text="Lives in Lagos")],
        )
    )
    mock_config.return_value.rq_retry_max = 3

    await process_chat(
        hub_id=1,
        message_id=6,
        message="I moved to Lagos",
        callback_url="http://example.com/callback",
        conversation_context=[{"id": "1", "text": "Lives in Nairobi"}],
    )

    assert _enqueued_body(mock_queue_class)["payload"]["context_updates"] == [
        {"op": "remove", "id": "1"},
        {"op": "add", "text": "Lives in Lagos"},
    ]


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_debug_adds_log_to_callback(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    mock_router_class.return_value.route = AsyncMock(return_value=ChatResponse(answer="The answer"))
    mock_config.return_value.rq_retry_max = 3

    await process_chat(hub_id=1, message_id=42, message="Hello", callback_url="http://example.com/callback", debug=True)

    log = _enqueued_body(mock_queue_class)["payload"]["log"]
    assert log[0].endswith(" Chat task started for hub: 1, message_id: 42")
    assert re.fullmatch(r"\+\d+ms Chat task completed in \d+ms for message_id: 42", log[-1])


@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.chat.publish_metric")
@patch("app.tasks.chat.send_chat_status_sync")
@patch("app.tasks.chat.RAGRouter")
async def test_process_chat_without_debug_has_no_log_in_callback(
    mock_router_class: MagicMock,
    mock_send_status_sync: MagicMock,
    mock_publish_metric: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    mock_router_class.return_value.route = AsyncMock(return_value=ChatResponse(answer="The answer"))
    mock_config.return_value.rq_retry_max = 3

    await process_chat(hub_id=1, message_id=42, message="Hello", callback_url="http://example.com/callback")

    assert "log" not in _enqueued_body(mock_queue_class)["payload"]
