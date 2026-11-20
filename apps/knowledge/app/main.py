import asyncio
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from asgi_correlation_id import CorrelationIdMiddleware
from dotenv import load_dotenv
from fastapi import FastAPI
from loguru import logger

from app.core.logging import setup_logging, setup_sentry
from app.routes import chat, document, embed, health, language, preview, summarize, topics
from app.services.embedder_factory import EmbedderFactory
from app.services.neo4j_pool_manager import neo4j_pool

load_dotenv(override=True)
if deploy_env := os.getenv("DEPLOY_ENV"):
    load_dotenv(f".env.{deploy_env}", override=True)
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

env = os.getenv("DEPLOY_ENV", "local")
setup_sentry(env)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    setup_logging()

    try:
        embedder = await asyncio.to_thread(EmbedderFactory.get_embedder, purpose="query")
        await asyncio.to_thread(embedder.embed_query, "warmup")
        logger.info("Embedder warmed up at startup")
    except Exception as e:
        logger.warning(f"Embedder warmup failed (will retry on first request): {e}")

    yield

    # Shut-down
    neo4j_pool.close_all_connections()
    EmbedderFactory.cleanup()


app = FastAPI(title="Knowledge Service", lifespan=lifespan)
app.add_middleware(CorrelationIdMiddleware)


app.include_router(health.router, prefix="/health", tags=["health"])
app.include_router(document.router, prefix="/document", tags=["documents ingestion"])
app.include_router(embed.router, prefix="/embed", tags=["text embedder"])
app.include_router(chat.router, prefix="/chat", tags=["chat"])
app.include_router(preview.router, prefix="/preview", tags=["preview"])
app.include_router(summarize.router, prefix="/summarize", tags=["summarization"])
app.include_router(topics.router, prefix="/topics", tags=["topic extraction"])
app.include_router(language.router, prefix="/language", tags=["language detection"])
