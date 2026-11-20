"""YAGO query executors for SPARQL and Cypher backends."""

from __future__ import annotations

import sys
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, TypedDict

import httpx
from loguru import logger


class QueryResult(TypedDict):
    predicate: str
    predicate_label: str | None
    object_value: str
    object_label: str | None


@dataclass(frozen=True)
class SPARQLConfig:
    endpoint: str
    timeout_seconds: int = 30

    def __post_init__(self) -> None:
        if not self.endpoint:
            raise ValueError("endpoint cannot be empty")
        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")


@dataclass(frozen=True)
class CypherConfig:
    uri: str
    username: str
    password: str
    timeout_seconds: int = 30

    def __post_init__(self) -> None:
        if not self.uri:
            raise ValueError("uri cannot be empty")
        if not self.username:
            raise ValueError("username cannot be empty")
        if not self.password:
            raise ValueError("password cannot be empty")
        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")


class YAGOQueryError(Exception):
    pass


class YAGOQueryExecutor(ABC):
    @abstractmethod
    def resolve_entity(self, entity_text: str) -> str | None:
        """
        Resolve free-form entity text to a canonical YAGO entity ID.

        Args:
            entity_text: The entity name as extracted from user query (e.g., "Albert Einstein")

        Returns:
            The YAGO entity ID (e.g., "Albert_Einstein") if found, None otherwise.
        """
        pass

    @abstractmethod
    def execute(self, entity_id: str, predicates: list[str]) -> list[QueryResult]:
        """
        Execute a query for the given entity and predicates.

        Args:
            entity_id: The resolved YAGO entity ID (e.g., "Albert_Einstein")
            predicates: List of predicates to query (e.g., ["schema:birthDate", "schema:birthPlace"])

        Returns:
            List of QueryResult dictionaries with normalized results.

        Raises:
            YAGOQueryError: If the query fails.
        """
        pass


class SPARQLExecutor(YAGOQueryExecutor):
    SPARQL_PREFIXES = """
PREFIX yago: <http://yago-knowledge.org/resource/>
PREFIX schema: <http://schema.org/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
"""
    YAGO_RESOURCE_PREFIX = "http://yago-knowledge.org/resource/"

    def __init__(self, endpoint: str, timeout_seconds: int = 30) -> None:
        self.endpoint = endpoint
        self.timeout_seconds = timeout_seconds

    def resolve_entity(self, entity_text: str) -> str | None:
        logger.debug(f"Resolving entity: '{entity_text}'")

        entity_id = self._search_by_exact_label(entity_text)
        if entity_id:
            return entity_id

        entity_id = self._search_by_label_contains(entity_text)
        if entity_id:
            return entity_id

        from app.services.router.extractor import EntityExtractor

        constructed_id = EntityExtractor.normalize_to_yago_id(entity_text)
        if self._entity_exists(constructed_id):
            return constructed_id

        return None

    @staticmethod
    def _escape_sparql_literal(text: str) -> str:
        """Escape a value for safe interpolation inside a SPARQL string literal.

        SPARQL has no bind-parameter mechanism for string literals over the
        query protocol, so untrusted text embedded in a query must be escaped
        the same way a quoted string literal requires per the SPARQL grammar.
        """
        return (
            text.replace("\\", "\\\\")
            .replace('"', '\\"')
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
        )

    def _search_by_exact_label(self, entity_text: str) -> str | None:
        escaped_text = self._escape_sparql_literal(entity_text)
        query = f"""{self.SPARQL_PREFIXES}
SELECT DISTINCT ?entity WHERE {{
  ?entity rdfs:label ?label .
  FILTER(LCASE(STR(?label)) = LCASE("{escaped_text}"))
}}
LIMIT 1
"""
        try:
            results = self._execute_query(query)
            if results:
                uri = results[0].get("entity", {}).get("value", "")
                return self._extract_entity_id(uri)
        except YAGOQueryError as e:
            logger.opt(exception=sys.exc_info()).warning(f"Exact label search failed: {e}")
        return None

    def _search_by_label_contains(self, entity_text: str) -> str | None:
        escaped_text = self._escape_sparql_literal(entity_text)
        query = f"""{self.SPARQL_PREFIXES}
SELECT DISTINCT ?entity ?label WHERE {{
  ?entity rdfs:label ?label .
  FILTER(LANG(?label) = "en" || LANG(?label) = "")
  FILTER(CONTAINS(LCASE(STR(?label)), LCASE("{escaped_text}")))
}}
LIMIT 5
"""
        try:
            results = self._execute_query(query)
            if results:
                for result in results:
                    label = result.get("label", {}).get("value", "")
                    if label.lower() == entity_text.lower():
                        uri = result.get("entity", {}).get("value", "")
                        return self._extract_entity_id(uri)
                # no exact match found
                uri = results[0].get("entity", {}).get("value", "")
                return self._extract_entity_id(uri)
        except YAGOQueryError as e:
            logger.opt(exception=sys.exc_info()).warning(f"Label contains search failed: {e}")
        return None

    def _entity_exists(self, entity_id: str) -> bool:
        query = f"""{self.SPARQL_PREFIXES}
ASK WHERE {{
  yago:{entity_id} ?p ?o .
}}
"""
        try:
            headers = {
                "Content-Type": "application/sparql-query",
                "Accept": "application/sparql-results+json",
            }
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.post(self.endpoint, content=query, headers=headers)
            if response.status_code == 200:
                return bool(response.json().get("boolean", False))
        except Exception as e:
            logger.opt(exception=sys.exc_info()).warning(f"Entity existence check failed: {e}")
        return False

    def _extract_entity_id(self, uri: str) -> str | None:
        if uri.startswith(self.YAGO_RESOURCE_PREFIX):
            return uri[len(self.YAGO_RESOURCE_PREFIX) :]
        return None

    def execute(self, entity_id: str, predicates: list[str]) -> list[QueryResult]:
        sparql_query = self._construct_query(entity_id, predicates)
        raw_results = self._execute_query(sparql_query)
        return self._normalize_results(raw_results)

    def _construct_query(self, entity_id: str, predicates: list[str]) -> str:
        predicate_filter = " || ".join(f"?p = {p}" for p in predicates)

        query = f"""{self.SPARQL_PREFIXES}
SELECT ?p ?pLabel ?o ?oLabel WHERE {{
  yago:{entity_id} ?p ?o .
  FILTER ({predicate_filter})
  OPTIONAL {{ ?p rdfs:label ?pLabel . FILTER(LANG(?pLabel) = "en" || LANG(?pLabel) = "") }}
  OPTIONAL {{ ?o rdfs:label ?oLabel . FILTER(LANG(?oLabel) = "en" || LANG(?oLabel) = "") }}
}}
LIMIT 50
"""
        return query

    def _execute_query(self, sparql_query: str) -> list[dict[str, Any]]:
        headers = {
            "Content-Type": "application/sparql-query",
            "Accept": "application/sparql-results+json",
        }

        start_time = time.perf_counter()

        try:
            logger.debug(f"Querying SPARQL endpoint '{self.endpoint}': '{sparql_query}'")
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.post(
                    self.endpoint,
                    content=sparql_query,
                    headers=headers,
                )

            elapsed = time.perf_counter() - start_time
            logger.debug(f"SPARQL query completed in {elapsed:.2f}s, status: {response.status_code}")

            if response.status_code == 429:
                raise YAGOQueryError("Rate limited by YAGO API. Please try again later.")

            if response.status_code == 503:
                raise YAGOQueryError("YAGO service temporarily unavailable.")

            if response.status_code >= 400:
                raise YAGOQueryError(f"YAGO API error: HTTP {response.status_code}")

            data = response.json()
            bindings: list[dict[str, Any]] = data.get("results", {}).get("bindings", [])

            return bindings

        except httpx.TimeoutException:
            raise YAGOQueryError(f"Query timed out after {self.timeout_seconds} seconds")
        except httpx.RequestError as e:
            raise YAGOQueryError(f"Network error: {e}")

    def _normalize_results(self, raw_results: list[dict[str, Any]]) -> list[QueryResult]:
        results: list[QueryResult] = []

        for binding in raw_results:
            predicate = self._extract_binding_value(binding, "p")
            if not predicate:
                continue

            object_value = self._extract_binding_value(binding, "o")
            if not object_value:
                continue

            results.append(
                QueryResult(
                    predicate=predicate,
                    predicate_label=self._extract_binding_value(binding, "pLabel"),
                    object_value=object_value,
                    object_label=self._extract_binding_value(binding, "oLabel"),
                )
            )

        return results

    def _extract_binding_value(self, binding: dict[str, Any], key: str) -> str | None:
        if key not in binding:
            return None

        value = binding[key].get("value", "")

        if value.startswith("http://"):
            value = value.split("/")[-1].replace("_", " ")

        return value if value else None


class CypherExecutor(YAGOQueryExecutor):
    YAGO_RESOURCE_PREFIX = "http://yago-knowledge.org/resource/"
    FULLTEXT_INDEX_NAME = "yago_entity_labels"

    PREDICATE_MAPPING = {
        "schema:description": "description",
        "schema:birthDate": "birthDate",
        "schema:deathDate": "deathDate",
        "schema:birthPlace": "birthPlace",
        "schema:deathPlace": "deathPlace",
        "schema:nationality": "nationality",
        "schema:occupation": "occupation",
        "schema:foundingDate": "foundingDate",
        "schema:dissolutionDate": "dissolutionDate",
        "schema:founder": "founder",
        "schema:location": "location",
        "schema:containedInPlace": "containedInPlace",
        "schema:capital": "capital",
        "schema:population": "population",
        "schema:areaTotal": "areaTotal",
        "schema:leader": "leader",
        "schema:award": "award",
        "schema:alumniOf": "alumniOf",
        "schema:memberOf": "memberOf",
        "rdfs:label": "label",
        "rdfs:comment": "comment",
    }

    PROPERTY_PREDICATES = {
        "birthDate",
        "deathDate",
        "foundingDate",
        "dissolutionDate",
        "population",
        "areaTotal",
        "label",
        "comment",
        "description",
    }

    RELATIONSHIP_PREDICATES = {
        "birthPlace",
        "deathPlace",
        "nationality",
        "occupation",
        "founder",
        "location",
        "containedInPlace",
        "capital",
        "leader",
        "award",
        "alumniOf",
        "memberOf",
    }

    def __init__(self, driver: Any, timeout_seconds: int = 30) -> None:
        self.driver = driver
        self.timeout_seconds = timeout_seconds
        self._ensure_fulltext_index()

    def _ensure_fulltext_index(self) -> None:
        query = f"""
CREATE FULLTEXT INDEX {self.FULLTEXT_INDEX_NAME} IF NOT EXISTS
FOR (n:Resource) ON EACH [n.label]
"""
        try:
            with self.driver.session() as session:
                session.run(query)
            logger.debug(f"Ensured fulltext index '{self.FULLTEXT_INDEX_NAME}' exists")
        except Exception as e:
            logger.opt(exception=sys.exc_info()).warning(f"Could not create fulltext index: {e}")

    def resolve_entity(self, entity_text: str) -> str | None:
        logger.debug(f"Resolving entity: '{entity_text}'")

        entity_id = self._search_by_fulltext(entity_text)
        if entity_id:
            return entity_id

        entity_id = self._search_by_exact_label(entity_text)
        if entity_id:
            return entity_id

        from app.services.router.extractor import EntityExtractor

        constructed_id = EntityExtractor.normalize_to_yago_id(entity_text)
        if self._entity_exists(constructed_id):
            return constructed_id

        return None

    def _search_by_fulltext(self, entity_text: str) -> str | None:
        escaped_text = self._escape_lucene_query(entity_text)
        search_query = f"{escaped_text}~"

        query = """
CALL db.index.fulltext.queryNodes($index_name, $search_text)
YIELD node, score
RETURN node.uri AS uri, node.label AS label, score
ORDER BY score DESC
LIMIT 5
"""
        try:
            with self.driver.session() as session:
                result = session.run(
                    query,
                    index_name=self.FULLTEXT_INDEX_NAME,
                    search_text=search_query,
                )
                records = [dict(record) for record in result]

            if records:
                for record in records:
                    label = record.get("label", "")
                    if label and label.lower() == entity_text.lower():
                        return self._extract_entity_id(record.get("uri", ""))
                return self._extract_entity_id(records[0].get("uri", ""))
        except Exception as e:
            logger.debug(f"Full-text search failed: {e}")
        return None

    def _escape_lucene_query(self, text: str) -> str:
        # Escape Lucene special characters: + - && || ! ( ) { } [ ] ^ " ~ * ? : \ /
        special_chars = r'+-&|!(){}[]^"~*?:\/'
        escaped = ""
        for char in text:
            if char in special_chars:
                escaped += f"\\{char}"
            else:
                escaped += char
        return escaped

    def _search_by_exact_label(self, entity_text: str) -> str | None:
        query = """
MATCH (e:Resource)
WHERE toLower(e.label) = toLower($entity_text)
RETURN e.uri AS uri
LIMIT 1
"""
        try:
            with self.driver.session() as session:
                result = session.run(query, entity_text=entity_text)
                record = result.single()
            if record:
                return self._extract_entity_id(record.get("uri", ""))
        except Exception as e:
            logger.opt(exception=sys.exc_info()).warning(f"Exact label search failed: {e}")
        return None

    def _entity_exists(self, entity_id: str) -> bool:
        entity_uri = f"{self.YAGO_RESOURCE_PREFIX}{entity_id}"
        query = """
MATCH (e:Resource {uri: $entity_uri})
RETURN COUNT(e) > 0 AS exists
"""
        try:
            with self.driver.session() as session:
                result = session.run(query, entity_uri=entity_uri)
                record = result.single()
            return record.get("exists", False) if record else False
        except Exception as e:
            logger.opt(exception=sys.exc_info()).warning(f"Entity existence check failed: {e}")
        return False

    def _extract_entity_id(self, uri: str) -> str | None:
        if uri and uri.startswith(self.YAGO_RESOURCE_PREFIX):
            return uri[len(self.YAGO_RESOURCE_PREFIX) :]
        return None

    def execute(self, entity_id: str, predicates: list[str]) -> list[QueryResult]:
        prop_keys: list[str] = []
        rel_types: list[str] = []

        for p in predicates:
            neo4j_name = self.PREDICATE_MAPPING.get(p, p.split(":")[-1])
            if neo4j_name in self.PROPERTY_PREDICATES:
                prop_keys.append(neo4j_name)
            else:
                rel_types.append(neo4j_name)

        entity_uri = f"{self.YAGO_RESOURCE_PREFIX}{entity_id}"
        cypher_query = self._construct_query(prop_keys, rel_types)
        raw_results = self._execute_query(cypher_query, entity_uri, prop_keys, rel_types)
        return self._normalize_results(raw_results)

    def _construct_query(self, prop_keys: list[str], rel_types: list[str]) -> str:
        parts: list[str] = []

        if prop_keys:
            parts.append("""
MATCH (e:Resource {uri: $entity_uri})
UNWIND $prop_keys AS propKey
WITH e, propKey, e[propKey] AS propValue
WHERE propValue IS NOT NULL
RETURN propKey AS predicate, toString(propValue) AS object_value, NULL AS object_label
""")

        if rel_types:
            parts.append("""
MATCH (e:Resource {uri: $entity_uri})-[r]->(target)
WHERE type(r) IN $rel_types
RETURN type(r) AS predicate,
       COALESCE(target.label, target.uri) AS object_value,
       target.label AS object_label
""")

        if not parts:
            return "RETURN NULL AS predicate, NULL AS object_value, NULL AS object_label LIMIT 0"

        query = " UNION ALL ".join(parts) + "\nLIMIT 50"
        return query

    def _execute_query(
        self,
        cypher_query: str,
        entity_uri: str,
        prop_keys: list[str],
        rel_types: list[str],
    ) -> list[dict[str, Any]]:
        start_time = time.perf_counter()

        try:
            logger.debug(f"Executing Cypher query for entity '{entity_uri}'")

            with self.driver.session() as session:
                result = session.run(
                    cypher_query,
                    entity_uri=entity_uri,
                    prop_keys=prop_keys,
                    rel_types=rel_types,
                )
                records = [dict(record) for record in result]

            elapsed = time.perf_counter() - start_time
            logger.debug(f"Cypher query completed in {elapsed:.2f}s, {len(records)} results")

            return records

        except Exception as e:
            elapsed = time.perf_counter() - start_time
            logger.opt(exception=sys.exc_info()).error(f"Cypher query failed after {elapsed:.2f}s: {e}")
            raise YAGOQueryError(f"Neo4j query error: {e}")

    def _normalize_results(self, raw_results: list[dict[str, Any]]) -> list[QueryResult]:
        reverse_mapping = {v: k for k, v in self.PREDICATE_MAPPING.items()}

        results: list[QueryResult] = []

        for record in raw_results:
            predicate = record.get("predicate")
            object_value = record.get("object_value")

            if not predicate or not object_value:
                continue

            sparql_predicate = reverse_mapping.get(predicate, predicate)
            object_label = record.get("object_label")

            results.append(
                QueryResult(
                    predicate=sparql_predicate,
                    predicate_label=predicate,
                    object_value=str(object_value),
                    object_label=object_label,
                )
            )

        return results


def get_yago_executor(config: SPARQLConfig | CypherConfig) -> YAGOQueryExecutor:
    if isinstance(config, SPARQLConfig):
        logger.debug(f"Using SPARQL executor with endpoint: {config.endpoint}")
        return SPARQLExecutor(endpoint=config.endpoint, timeout_seconds=config.timeout_seconds)

    elif isinstance(config, CypherConfig):
        from neo4j import GraphDatabase

        logger.debug(f"Using Cypher executor with URI: {config.uri}")
        driver = GraphDatabase.driver(config.uri, auth=(config.username, config.password))
        return CypherExecutor(driver=driver, timeout_seconds=config.timeout_seconds)

    else:
        raise ValueError(f"Unknown config type: {type(config)}. Must be SPARQLConfig or CypherConfig.")
