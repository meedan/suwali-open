import sys
from threading import Lock
from typing import Optional

from loguru import logger
from neo4j import Driver, GraphDatabase, Session
from neo4j.exceptions import ClientError, TransientError
from neo4j_graphrag.indexes import (
    create_fulltext_index,
    create_vector_index,
    drop_index_if_exists,
    retrieve_fulltext_index_info,
    retrieve_vector_index_info,
)

from app.core.config import Config, Neo4jConfig, resolved_embedding_vector_dimensions
from app.services.neo4j_timing import instrument_driver

# Connection pool settings to prevent stale connection errors base on
# https://support.neo4j.com/s/article/1500001173021-How-to-handle-Session-Expired-Errors-while-connecting-to-Neo4j-Aura
MAX_CONNECTION_LIFETIME = (
    50 * 60
)  # 50 minutes - the maximum duration in seconds that the driver will keep a connection for before being removed from the pool
CONNECTION_TIMEOUT = 30  # 30 seconds - timeout for establishing new connections
CONNECTION_ACQUISITION_TIMEOUT = 60  # 60 seconds - timeout when acquiring from pool
MAX_CONNECTION_POOL_SIZE = 50  # Maximum connections per driver
LIVENESS_CHECK_TIMEOUT = 30  # 30 seconds to avoid ALB timeouts on AWS when connections are idle but still valid

# Raised to the loser when concurrent workers race on CREATE INDEX ... IF NOT EXISTS
EQUIVALENT_SCHEMA_RULE_EXISTS = "Neo.ClientError.Schema.EquivalentSchemaRuleAlreadyExists"
# Raised to the loser when concurrent workers deadlock on the label lock while creating a new schema rule
DEADLOCK_DETECTED = "Neo.TransientError.Transaction.DeadlockDetected"


class Neo4jPoolManager:
    _instance: Optional["Neo4jPoolManager"] = None
    _lock = Lock()
    _initialized = False

    def __new__(cls) -> "Neo4jPoolManager":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False

        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return

        self.config = Config()
        self._drivers: dict[int, Driver] = {}
        self._driver_lock = Lock()
        self._initialized = True
        logger.info("Neo4j Pool Manager initialized")

    def get_driver(self, hub_id: int) -> Driver:
        with self._driver_lock:
            if hub_id in self._drivers:
                try:
                    return self._drivers[hub_id]
                except Exception as e:
                    logger.opt(exception=sys.exc_info()).warning(
                        f"Driver for hub_id {hub_id} is no longer valid: {e}. Creating new one."
                    )
                    try:
                        self._drivers[hub_id].close()
                    except Exception as close_err:
                        logger.opt(exception=sys.exc_info()).warning(
                            f"Error closing stale driver for hub_id {hub_id}: {close_err}"
                        )
                    del self._drivers[hub_id]

            neo4j_config = self._get_neo4j_config_for_hub(hub_id)
            logger.info(f"Creating new Neo4j connection for hub_id {hub_id} to {neo4j_config.uri}")

            try:
                driver = GraphDatabase.driver(
                    neo4j_config.uri,
                    auth=(str(neo4j_config.username), str(neo4j_config.password)),
                    max_connection_lifetime=MAX_CONNECTION_LIFETIME,
                    connection_timeout=CONNECTION_TIMEOUT,
                    connection_acquisition_timeout=CONNECTION_ACQUISITION_TIMEOUT,
                    max_connection_pool_size=MAX_CONNECTION_POOL_SIZE,
                    liveness_check_timeout=LIVENESS_CHECK_TIMEOUT,
                )
                instrument_driver(driver)
                driver.verify_connectivity()
                try:
                    self._ensure_indexes_for_hub(driver, hub_id)
                except Exception as e:
                    # An equivalent index already exists error may appear when running RQ listeners on AuraDB Free
                    # instances, as they may attempt to create the same index simultaneously. Log the error and
                    # continue, as the index should already exist.
                    logger.opt(exception=sys.exc_info()).warning(f"Error ensuring indexes for hub_id {hub_id}: {e}")

                self._drivers[hub_id] = driver
                logger.info(f"Successfully created and cached driver for hub_id {hub_id}")

                return driver

            except Exception as e:
                logger.opt(exception=sys.exc_info()).error(f"Failed to create Neo4j driver for hub_id {hub_id}: {e}")
                raise

    def ensure_indexes_for_hub(self, hub_id: int) -> None:
        """Recreate the vector/fulltext/range indexes for a hub.

        Unlike ``get_driver``, this always (re)runs index creation, even when a driver
        for the hub is already cached. Used to recover when an index was dropped or
        never created (e.g. a fresh Neo4j database) while the driver stayed alive.
        """
        driver = self.get_driver(hub_id)
        self._ensure_indexes_for_hub(driver, hub_id)

    def _get_neo4j_config_for_hub(self, hub_id: int) -> Neo4jConfig:
        if not (isinstance(hub_id, int) and hub_id > 0):
            raise ValueError("hub_id must be a positive integer")

        config = Config()

        if config.neo4j_hub_config:
            neo4j_config = config.neo4j_hub_config.get(hub_id)
            if neo4j_config:
                if not neo4j_config.uri:
                    raise ValueError(f"URI must be set for hub_id {hub_id}")
                if not neo4j_config.username:
                    raise ValueError(f"Username must be set for hub_id {hub_id}")
                if not neo4j_config.password:
                    raise ValueError(f"Password must be set for hub_id {hub_id}")
                return neo4j_config

        logger.info(f"No hub-specific Neo4j configuration found for hub_id {hub_id}, falling back to default")
        if not config.neo4j_hub_default_config:
            raise ValueError(
                f"No Neo4j configuration found for hub_id {hub_id} and NEO4J_HUB_DEFAULT_CONFIG is not set"
            )
        return config.neo4j_hub_default_config

    def _ensure_indexes_for_hub(self, driver: Driver, hub_id: int) -> None:
        dimensions = resolved_embedding_vector_dimensions(self.config)
        chunk_label = f"Chunk_{hub_id}"

        try:
            vector_index_name = f"text_vectors_{hub_id}"
            filterable_properties = ["published_at"]
            existing_vector_index = retrieve_vector_index_info(
                driver,
                index_name=vector_index_name,
                label_or_type=chunk_label,
                embedding_property="embedding",
            )
            if existing_vector_index is not None:
                # `properties` lists the embedding property first, followed by any
                # filterable properties declared via the index's WITH clause.
                current_filterable_properties = [
                    p for p in existing_vector_index.get("properties") or [] if p != "embedding"
                ]
                if not set(filterable_properties).issubset(current_filterable_properties):
                    logger.info(
                        f"Recreating vector index '{vector_index_name}' to add "
                        f"filterable_properties {filterable_properties}"
                    )
                    drop_index_if_exists(driver, vector_index_name)
                    existing_vector_index = None

            if existing_vector_index is None:
                create_vector_index(
                    driver,
                    name=vector_index_name,
                    label=chunk_label,
                    embedding_property="embedding",
                    dimensions=dimensions,
                    similarity_fn="cosine",
                    filterable_properties=filterable_properties,
                )
        except Exception as e:
            # Just a warning because an equivalent index already exists error may appear when running RQ listeners on AuraDB
            logger.opt(exception=sys.exc_info()).warning(
                f"Error ensuring vector index for hub_id {hub_id}: {e}. This may be due to concurrent index creation."
            )

        try:
            fulltext_index_name = f"text_fulltext_index_{hub_id}"
            if (
                retrieve_fulltext_index_info(
                    driver,
                    index_name=fulltext_index_name,
                    label_or_type=chunk_label,
                    text_properties=["text"],
                )
                is None
            ):
                create_fulltext_index(
                    driver,
                    name=fulltext_index_name,
                    label=chunk_label,
                    node_properties=["text"],
                )
        except Exception as e:
            # Just a warning because an equivalent index already exists error may appear when running RQ listeners on AuraDB
            logger.opt(exception=sys.exc_info()).warning(
                f"Error ensuring fulltext index for hub_id {hub_id}: {e}. This may be due to concurrent index creation."
            )

        with driver.session() as session:
            index_query = (
                f"CREATE INDEX document_id_index_{hub_id} IF NOT EXISTS FOR (d:Document_{hub_id}) ON (d.document_id)"
            )
            self._run_schema_statement(session, index_query, f"index on Document_{hub_id}.document_id")

            # Also indexes Topic.name, so a topic filter can start from the topic instead of scanning documents
            topic_name_constraint_query = (
                f"CREATE CONSTRAINT topic_name_unique_{hub_id} IF NOT EXISTS "
                f"FOR (t:Topic_{hub_id}) REQUIRE t.name IS UNIQUE"
            )
            self._run_schema_statement(session, topic_name_constraint_query, f"constraint on Topic_{hub_id}.name")

            # Range index backing the recency-first pre-filter on chunk.published_at
            published_at_index_query = (
                f"CREATE INDEX chunk_published_at_index_{hub_id} IF NOT EXISTS "
                f"FOR (c:Chunk_{hub_id}) ON (c.published_at)"
            )
            self._run_schema_statement(session, published_at_index_query, f"index on Chunk_{hub_id}.published_at")

            # Range index backing the recency-first pre-filter's prioritized-chunk bypass
            priority_tier_index_query = (
                f"CREATE INDEX chunk_priority_tier_index_{hub_id} IF NOT EXISTS "
                f"FOR (c:Chunk_{hub_id}) ON (c.priority_tier)"
            )
            self._run_schema_statement(session, priority_tier_index_query, f"index on Chunk_{hub_id}.priority_tier")

    @staticmethod
    def _run_schema_statement(session: Session, query: str, description: str) -> None:
        try:
            try:
                # consume() so a failure surfaces here rather than on the next statement or session close
                session.run(query).consume()
            except TransientError as e:
                # Concurrent creation can also deadlock on the label lock; the winner creates the rule, so retry once
                if e.code != DEADLOCK_DETECTED:
                    raise
                logger.info(f"Retrying {description} after a deadlock with another worker")
                session.run(query).consume()
        except ClientError as e:
            # IF NOT EXISTS does not cover concurrent creation: when workers race, the loser gets this
            # error even though the index now exists
            if e.code != EQUIVALENT_SCHEMA_RULE_EXISTS:
                raise
            logger.info(f"{description} was created concurrently by another worker")
        else:
            logger.info(f"Ensured {description}")

    def invalidate_driver(self, hub_id: int) -> None:
        """Remove a cached driver so the next ``get_driver`` call creates a fresh one."""
        with self._driver_lock:
            driver = self._drivers.pop(hub_id, None)
        if driver is not None:
            try:
                driver.close()
            except Exception as e:
                logger.warning(f"Error closing invalidated driver for hub_id {hub_id}: {e}")
            logger.info(f"Invalidated Neo4j driver for hub_id {hub_id}")

    def close_hub_connection(self, hub_id: int) -> None:
        if hub_id not in self._drivers:
            logger.warning(f"No active connection found for hub_id {hub_id}")
            return

        try:
            self._drivers[hub_id].close()
            logger.info(f"Closed connection for hub_id {hub_id}")
        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"Error closing connection for hub_id {hub_id}: {e}")
        finally:
            del self._drivers[hub_id]

    def close_all_connections(self) -> None:
        for hub_id in list(self._drivers.keys()):
            self.close_hub_connection(hub_id)
        logger.info("All Neo4j connections closed")


neo4j_pool = Neo4jPoolManager()
