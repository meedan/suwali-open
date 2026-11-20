from typing import Generator

import pytest

from app.core.bedrock import get_bedrock_client


@pytest.fixture(autouse=True)
def clear_bedrock_client_cache() -> Generator[None, None]:
    get_bedrock_client.cache_clear()
    yield
    get_bedrock_client.cache_clear()


def test_get_bedrock_client_applies_read_timeout() -> None:
    client = get_bedrock_client(read_timeout_seconds=45.0)
    assert client.meta.config.read_timeout == 45.0
    assert client.meta.config.connect_timeout == 10


def test_get_bedrock_client_caches_per_timeout_value() -> None:
    a = get_bedrock_client(read_timeout_seconds=60.0)
    b = get_bedrock_client(read_timeout_seconds=60.0)
    c = get_bedrock_client(read_timeout_seconds=180.0)

    assert a is b
    assert a is not c
    assert c.meta.config.read_timeout == 180.0


def test_get_bedrock_client_defaults_to_sixty_seconds() -> None:
    client = get_bedrock_client()
    assert client.meta.config.read_timeout == 60.0
