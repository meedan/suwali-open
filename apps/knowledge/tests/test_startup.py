from unittest.mock import MagicMock, patch

from fastapi import FastAPI

from app.main import lifespan


@patch("app.main.neo4j_pool")
async def test_lifespan_startup_and_shutdown_called(
    mock_neo4j_pool: MagicMock,
) -> None:
    app = FastAPI()

    async with lifespan(app):
        # During the lifespan context, we don't expect any specific startup calls
        # since the pool manager uses lazy loading
        pass

    # After lifespan ends, close_all_connections should be called
    mock_neo4j_pool.close_all_connections.assert_called_once()
