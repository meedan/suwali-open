from typing import Union, cast
from unittest.mock import MagicMock

from requests import HTTPError, Response


def mock_get_file(
    content: Union[str, bytes] = b"test file",
    status_code: int = 200,
    apparent_encoding: str = "utf-8",
) -> Response:
    mock_response = MagicMock()
    mock_response.status_code = status_code
    mock_response.content = content
    mock_response.apparent_encoding = apparent_encoding
    if status_code >= 400:
        mock_response.raise_for_status.side_effect = HTTPError(f"{status_code} Error")
    else:
        mock_response.raise_for_status = lambda: None
    return cast(Response, mock_response)
