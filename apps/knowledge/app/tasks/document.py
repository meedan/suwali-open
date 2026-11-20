import sys
import time

from loguru import logger

from app.services.callback_service import enqueue_callback
from app.services.document import Document
from app.services.neo4j_client import Neo4jClient


async def remove_document(hub_id: int, document_id: str, callback_url: str = "") -> None:
    start_time = time.perf_counter()
    success = False
    logger.info(f"Deletion started for document_id: {document_id}")
    try:
        driver = Neo4jClient().get_driver(hub_id)
        with driver.session() as session:
            document_service = Document(session, hub_id)
            document_service.remove(document_id)
        success = True
    except Exception as e:
        logger.opt(exception=sys.exc_info()).error(f"Deletion for document_id {document_id} failed: {e}")
    finally:
        duration = time.perf_counter() - start_time
        logger.info(f"Deletion for document_id {document_id} finished in {duration:.2f} seconds. Success? {success}")
        enqueue_callback(callback_url, {"success": success, "topics": []})
