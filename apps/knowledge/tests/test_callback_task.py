from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.tasks.callback import dispatch_callback


@patch("app.tasks.callback.httpx.post")
def test_dispatch_callback_success(mock_post: MagicMock) -> None:
    mock_post.return_value = MagicMock(status_code=200)

    dispatch_callback("http://example.com/callback", {"success": True, "topics": []})

    mock_post.assert_called_once_with(
        "http://example.com/callback",
        json={"success": True, "topics": []},
        timeout=30.0,
    )


@patch("app.tasks.callback.httpx.post")
def test_dispatch_callback_noop_without_url(mock_post: MagicMock) -> None:
    dispatch_callback("", {"success": True})
    mock_post.assert_not_called()


@patch("app.tasks.callback.httpx.post")
def test_dispatch_callback_raises_on_non_200(mock_post: MagicMock) -> None:
    mock_response = MagicMock(status_code=500)
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "500 Server Error", request=MagicMock(), response=mock_response
    )
    mock_post.return_value = mock_response

    with pytest.raises(httpx.HTTPStatusError):
        dispatch_callback("http://example.com/callback", {"success": True})


@patch("app.tasks.callback.httpx.post")
def test_dispatch_callback_raises_on_connection_error(mock_post: MagicMock) -> None:
    mock_post.side_effect = httpx.ConnectError("Connection refused")

    with pytest.raises(httpx.ConnectError):
        dispatch_callback("http://example.com/callback", {"success": True})


@patch("app.tasks.callback.httpx.post")
def test_dispatch_callback_uses_custom_timeout(mock_post: MagicMock) -> None:
    mock_post.return_value = MagicMock(status_code=200)

    dispatch_callback("http://example.com/callback", {"data": "value"}, timeout=5.0)

    mock_post.assert_called_once_with(
        "http://example.com/callback",
        json={"data": "value"},
        timeout=5.0,
    )
