"""YAGO knowledge graph handler for entity-based factual queries."""

from __future__ import annotations

import re
import sys
from typing import Any, cast

from loguru import logger

from app.core.config import Config
from app.services.router.extractor import EntityExtractor, ExtractedEntity, get_entity_extractor
from app.services.router.handler import KnowledgeHandler
from app.services.router.models import HandlerResult, KnowledgeSource, QueryContext
from app.services.router.yago_executor import (
    CypherConfig,
    QueryResult,
    SPARQLConfig,
    YAGOQueryError,
    YAGOQueryExecutor,
    get_yago_executor,
)

# for YAGO queries (both SPARQL and Cypher)
INTERESTING_PREDICATES = [
    "schema:description",
    "schema:birthDate",
    "schema:deathDate",
    "schema:birthPlace",
    "schema:deathPlace",
    "schema:nationality",
    "schema:occupation",
    "schema:foundingDate",
    "schema:dissolutionDate",
    "schema:founder",
    "schema:location",
    "schema:containedInPlace",
    "schema:capital",
    "schema:population",
    "schema:areaTotal",
    "schema:leader",
    "schema:award",
    "schema:alumniOf",
    "schema:memberOf",
    "rdfs:label",
    "rdfs:comment",
]


def _create_yago_executor(config: Config) -> YAGOQueryExecutor:
    """Create the appropriate YAGO executor based on configuration."""
    executor_config: SPARQLConfig | CypherConfig

    if config.yago_query_backend == "sparql":
        if not config.yago_sparql_endpoint:
            raise ValueError("yago_sparql_endpoint is required for SPARQL backend")
        executor_config = SPARQLConfig(
            endpoint=config.yago_sparql_endpoint,
            timeout_seconds=config.yago_timeout_seconds,
        )
    elif config.yago_query_backend == "cypher":
        if not all([config.yago_neo4j_uri, config.yago_neo4j_username, config.yago_neo4j_password]):
            raise ValueError(
                "YAGO Cypher backend requires yago_neo4j_uri, yago_neo4j_username, "
                "and yago_neo4j_password to be configured"
            )
        executor_config = CypherConfig(
            uri=cast(str, config.yago_neo4j_uri),
            username=cast(str, config.yago_neo4j_username),
            password=cast(str, config.yago_neo4j_password),
            timeout_seconds=config.yago_timeout_seconds,
        )
    else:
        raise ValueError(f"Unknown YAGO backend: {config.yago_query_backend}. Must be 'sparql' or 'cypher'.")

    return get_yago_executor(executor_config)


class YAGOHandler(KnowledgeHandler):
    """
    Enricher for YAGO knowledge graph. Returns facts in context_snippets
    to enhance retrieval, not a final answer.
    """

    def __init__(
        self,
        extractor: EntityExtractor | None = None,
        executor: YAGOQueryExecutor | None = None,
    ) -> None:
        self.config = Config()
        self._extractor = extractor
        self._executor = executor

    @property
    def extractor(self) -> EntityExtractor:
        if self._extractor is None:
            self._extractor = get_entity_extractor(self.config.yago_entity_extractor)
        return self._extractor

    @property
    def executor(self) -> YAGOQueryExecutor:
        if self._executor is None:
            self._executor = _create_yago_executor(self.config)
        return self._executor

    @property
    def source(self) -> KnowledgeSource:
        return KnowledgeSource.YAGO

    def is_enabled(self) -> bool:
        return getattr(self.config, "router_enable_yago", False)

    def _retrieve(self, query: str, context: QueryContext, **kwargs: Any) -> HandlerResult:
        logger.info(f"YAGOHandler enriching query: {query[:100]}")

        entities = self.extractor.extract(query, context)

        if not entities:
            logger.warning("No entities extracted from query")
            return HandlerResult(
                source=self.source,
                success=False,
                error="Could not identify any entities in the query",
                metadata={
                    "extraction_method": self.config.yago_entity_extractor,
                    "query_backend": self.config.yago_query_backend,
                },
            )

        primary_entity = entities[0]
        logger.info(f"Primary entity extracted: '{primary_entity.text}'")

        try:
            resolved_id = self.executor.resolve_entity(primary_entity.text)
        except YAGOQueryError as e:
            logger.opt(exception=sys.exc_info()).error(f"Entity resolution failed: {e}")
            return HandlerResult(
                source=self.source,
                success=False,
                error=str(e),
                metadata={
                    "entity_text": primary_entity.text,
                    "extraction_method": self.config.yago_entity_extractor,
                    "query_backend": self.config.yago_query_backend,
                },
            )

        if not resolved_id:
            logger.info(f"Could not resolve entity: '{primary_entity.text}'")
            return HandlerResult(
                source=self.source,
                success=False,
                error=f"Could not find '{primary_entity.text}' in YAGO",
                metadata={
                    "entity_text": primary_entity.text,
                    "extraction_method": self.config.yago_entity_extractor,
                    "query_backend": self.config.yago_query_backend,
                },
            )

        logger.info(f"Resolved entity: '{primary_entity.text}' -> {resolved_id}")

        try:
            results = self.executor.execute(resolved_id, INTERESTING_PREDICATES)
        except YAGOQueryError as e:
            logger.opt(exception=sys.exc_info()).error(f"YAGO query execution failed: {e}")
            return HandlerResult(
                source=self.source,
                success=False,
                error=str(e),
                metadata={
                    "entity_text": primary_entity.text,
                    "resolved_entity": resolved_id,
                    "extraction_method": self.config.yago_entity_extractor,
                    "query_backend": self.config.yago_query_backend,
                },
            )

        if not results:
            logger.info(f"No results found for entity: {resolved_id}")
            return HandlerResult(
                source=self.source,
                success=False,
                error=f"No information found for '{primary_entity.text}' in YAGO",
                metadata={
                    "entity_text": primary_entity.text,
                    "resolved_entity": resolved_id,
                    "extraction_method": self.config.yago_entity_extractor,
                    "query_backend": self.config.yago_query_backend,
                },
            )

        context_snippets = self._extract_facts(results, primary_entity)

        logger.info(f"YAGO enrichment: {len(context_snippets)} facts extracted for {primary_entity.text}")

        return HandlerResult(
            source=self.source,
            success=True,
            answer=None,  # no answer, just extra context
            confidence=min(0.85, primary_entity.confidence + 0.1),
            context_snippets=context_snippets,
            metadata={
                "entity_text": primary_entity.text,
                "resolved_entity": resolved_id,
                "entity_type": primary_entity.entity_type,
                "extraction_method": self.config.yago_entity_extractor,
                "query_backend": self.config.yago_query_backend,
                "facts_retrieved": len(context_snippets),
                "all_entities": [e.text for e in entities[:5]],
            },
        )

    def _extract_facts(
        self,
        results: list[QueryResult],
        entity: ExtractedEntity,
    ) -> list[str]:
        """Extract facts from query results as enrichment snippets."""
        facts: dict[str, list[str]] = {}

        for result in results:
            predicate = result["predicate"]
            pred_label = result.get("predicate_label") or predicate

            obj_value = result.get("object_label") or result["object_value"]  # prefer object_label if available

            if not obj_value or not pred_label:
                continue

            pred_name = self._humanize_predicate(pred_label)

            if pred_name not in facts:
                facts[pred_name] = []

            if obj_value not in facts[pred_name]:
                facts[pred_name].append(obj_value)

        if not facts:
            return []

        priority_order = [
            "description",
            "birth date",
            "death date",
            "birth place",
            "nationality",
            "occupation",
            "founding date",
            "location",
            "capital",
            "population",
        ]

        context_snippets: list[str] = []
        added_preds: set[str] = set()

        for priority_pred in priority_order:
            for pred, values in facts.items():
                if priority_pred in pred.lower() and pred not in added_preds:
                    if len(values) == 1:
                        snippet = f"{entity.text} {pred}: {values[0]}"
                    else:
                        snippet = f"{entity.text} {pred}: {', '.join(values[:3])}"
                    context_snippets.append(snippet)
                    added_preds.add(pred)
                    break

        for pred, values in facts.items():
            if pred not in added_preds and len(context_snippets) < 10:
                if len(values) == 1:
                    snippet = f"{entity.text} {pred}: {values[0]}"
                else:
                    snippet = f"{entity.text} {pred}: {', '.join(values[:3])}"
                context_snippets.append(snippet)
                added_preds.add(pred)

        return context_snippets

    def _humanize_predicate(self, predicate: str) -> str:
        if "/" in predicate:
            predicate = predicate.split("/")[-1]
        if "#" in predicate:
            predicate = predicate.split("#")[-1]

        predicate = re.sub(r"([a-z])([A-Z])", r"\1 \2", predicate)
        predicate = predicate.replace("_", " ")
        predicate = predicate.replace("schema:", "")
        predicate = predicate.replace("rdfs:", "")

        return predicate.strip().title()
