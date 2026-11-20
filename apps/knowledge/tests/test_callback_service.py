from unittest.mock import MagicMock, patch

from app.services.callback_service import send_chat_status_sync


@patch("app.services.callback_service.httpx.post")
def test_send_chat_status_sync_success(mock_post: MagicMock) -> None:
    mock_post.return_value = MagicMock(status_code=200)

    send_chat_status_sync("http://example.com/callback", "parsing_question")

    mock_post.assert_called_once_with(
        "http://example.com/callback",
        json={"status": "parsing_question", "payload": None},
        timeout=5.0,
    )


@patch("app.services.callback_service.httpx.post")
def test_send_chat_status_sync_complete_uses_longer_timeout(mock_post: MagicMock) -> None:
    mock_post.return_value = MagicMock(status_code=200)

    send_chat_status_sync("http://example.com/callback", "complete", payload={"answer": "yes"})

    mock_post.assert_called_once_with(
        "http://example.com/callback",
        json={"status": "complete", "payload": {"answer": "yes"}},
        timeout=30.0,
    )


@patch("app.services.callback_service.httpx.post")
def test_send_chat_status_sync_noop_without_url(mock_post: MagicMock) -> None:
    send_chat_status_sync("", "parsing_question")
    mock_post.assert_not_called()


@patch("app.services.callback_service.time.sleep")
@patch("app.services.callback_service.httpx.post")
def test_send_chat_status_sync_retries_on_failure(mock_post: MagicMock, mock_sleep: MagicMock) -> None:
    mock_post.side_effect = [Exception("connection refused"), MagicMock(status_code=200)]

    send_chat_status_sync("http://example.com/callback", "complete", retries=2)

    assert mock_post.call_count == 2
    mock_sleep.assert_called_once_with(1)  # 2^0 = 1


@patch("app.services.callback_service.httpx.post")
def test_send_chat_status_sync_non_200_does_not_retry(mock_post: MagicMock) -> None:
    mock_post.return_value = MagicMock(status_code=404)

    send_chat_status_sync("http://example.com/callback", "parsing_question")

    # Non-200 returns immediately (no retry unless retries > 1)
    mock_post.assert_called_once()
