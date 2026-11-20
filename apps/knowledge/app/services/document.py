import sys

from fastapi import HTTPException
from loguru import logger
from neo4j import Session

from app.services.neo4j_client import Neo4jClient


def normalize_stored_topics(topics: list[str]) -> list[str]:
    """Lowercase, trim, drop blanks and de-duplicate, preserving order; no translation."""
    seen: set[str] = set()
    normalized: list[str] = []
    for topic in topics:
        name = topic.strip().lower()
        if name and name not in seen:
            seen.add(name)
            normalized.append(name)
    return normalized


class Document:
    def __init__(self, session: Session, hub_id: int):
        self.session = session
        self.hub_id = hub_id

    @classmethod
    def read_ingested_text(cls, hub_id: int, document_id: str) -> str:
        """Reconstruct a document's already-ingested text from its chunks in Neo4j."""
        try:
            driver = Neo4jClient().get_driver(hub_id)
            with driver.session() as session:
                return cls(session, hub_id).get_text(document_id)
        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(
                f"Failed to read chunks for document {document_id} in hub {hub_id}: {e}"
            )
            raise HTTPException(status_code=400, detail=f"Failed to read document text: {e}")

    def get_text(self, document_id: str) -> str:
        """Reconstruct a document's text from its already-ingested chunks, in chunk order."""
        result = self.session.run(
            f"""
            MATCH (c:Chunk_{self.hub_id})-[:FROM_DOCUMENT]->(d:Document_{self.hub_id} {{document_id: $document_id}})
            RETURN c.text AS text
            ORDER BY c.index
            """,
            {"document_id": document_id},
        )
        return "\n".join(record["text"] for record in result if record["text"])

    def exists(self, document_id: str) -> bool:
        result = self.session.run(
            f"""
            MATCH (d:Document_{self.hub_id} {{document_id: $document_id}})
            RETURN COUNT(d) AS count
            """,
            {"document_id": document_id},
        )
        record = result.single()
        return record is not None and int(record["count"]) > 0

    def set_topics(self, document_id: str, topics: list[str]) -> bool:
        """Replace the document's HAS_TOPIC edges; returns False when the document does not exist."""
        result = self.session.run(
            f"""
            MATCH (d:Document_{self.hub_id} {{document_id: $document_id}})
            OPTIONAL MATCH (d)-[r:HAS_TOPIC]->(:Topic_{self.hub_id})
            DELETE r
            WITH DISTINCT d
            FOREACH (name IN $topics |
                MERGE (t:Topic_{self.hub_id} {{name: name}})
                MERGE (d)-[:HAS_TOPIC]->(t)
            )
            RETURN COUNT(d) AS count
            """,
            {"document_id": document_id, "topics": normalize_stored_topics(topics)},
        )
        record = result.single()
        return record is not None and int(record["count"]) > 0

    def remove(self, document_id: str) -> bool:
        try:
            result = self.session.run(
                f"""
                MATCH (d:Document_{self.hub_id} {{document_id: $document_id}})
                OPTIONAL MATCH (c:Chunk_{self.hub_id})-[:FROM_DOCUMENT]->(d)
                DETACH DELETE d, c
                RETURN COUNT(d) AS deletedCount
                """,
                {"document_id": document_id, "hub_id": self.hub_id},
            )
            record = result.single()
            if record:
                logger.info(
                    f"Document {document_id} from hub {self.hub_id} and its chunks deleted successfully: {record.data()}"
                )
                deleted = int(record["deletedCount"]) > 0
            else:
                logger.info(f"No document found with document_id {document_id} from hub {self.hub_id}")
                deleted = False

            return deleted
        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(
                f"Error deleting document {document_id} from hub {self.hub_id}: {e}"
            )
            return False
