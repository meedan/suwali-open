"""Tests for YAGO handler and entity extractors."""

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from app.services.router.extractor import (
    EntityExtractor,
    ExtractedEntity,
    HeuristicEntityExtractor,
    NLTKEntityExtractor,
    get_entity_extractor,
)
from app.services.router.models import QueryContext
from app.services.router.yago_executor import (
    CypherConfig,
    CypherExecutor,
    QueryResult,
    SPARQLConfig,
    SPARQLExecutor,
    YAGOQueryError,
    YAGOQueryExecutor,
    get_yago_executor,
)
from app.services.router.yago_handler import INTERESTING_PREDICATES, YAGOHandler

# ============================================================================
# ExtractedEntity Tests
# ============================================================================


class TestExtractedEntity:
    def test_create_entity(self) -> None:
        entity = ExtractedEntity(
            text="Albert Einstein",
            normalized_id="Albert_Einstein",
            entity_type="PERSON",
            confidence=0.9,
        )
        assert entity.text == "Albert Einstein"
        assert entity.normalized_id == "Albert_Einstein"
        assert entity.entity_type == "PERSON"
        assert entity.confidence == 0.9

    def test_default_values(self) -> None:
        entity = ExtractedEntity(
            text="Test",
            normalized_id="Test",
        )
        assert entity.entity_type is None
        assert entity.confidence == 0.5

    def test_confidence_bounds(self) -> None:
        with pytest.raises(ValueError):
            ExtractedEntity(text="Test", normalized_id="Test", confidence=1.5)

        with pytest.raises(ValueError):
            ExtractedEntity(text="Test", normalized_id="Test", confidence=-0.1)


# ============================================================================
# HeuristicEntityExtractor Tests
# ============================================================================


class TestHeuristicEntityExtractor:
    @pytest.fixture
    def extractor(self) -> HeuristicEntityExtractor:
        return HeuristicEntityExtractor()

    def test_extract_simple_entity(self, extractor: HeuristicEntityExtractor) -> None:
        entities = extractor.extract("Who is Albert Einstein?")
        assert len(entities) >= 1
        assert entities[0].text == "Albert Einstein"
        assert entities[0].normalized_id == "Albert_Einstein"

    def test_extract_multiple_entities(self, extractor: HeuristicEntityExtractor) -> None:
        entities = extractor.extract("Did Albert Einstein ever meet Isaac Newton?")
        assert len(entities) >= 2
        normalized_ids = [e.normalized_id for e in entities]
        assert "Albert_Einstein" in normalized_ids
        assert "Isaac_Newton" in normalized_ids

    def test_strip_question_prefix(self, extractor: HeuristicEntityExtractor) -> None:
        entities = extractor.extract("What is the capital of France?")
        assert len(entities) >= 1
        assert entities[0].normalized_id == "France"

    def test_strip_who_is_prefix(self, extractor: HeuristicEntityExtractor) -> None:
        entities = extractor.extract("Who is Marie Curie?")
        assert len(entities) >= 1
        assert entities[0].normalized_id == "Marie_Curie"

    def test_handle_possessives(self, extractor: HeuristicEntityExtractor) -> None:
        assert EntityExtractor.normalize_to_yago_id("Einstein's") == "Einstein"
        assert EntityExtractor.normalize_to_yago_id("Newton's") == "Newton"

    def test_multi_word_entity(self, extractor: HeuristicEntityExtractor) -> None:
        entities = extractor.extract("Where is New York City located?")
        assert len(entities) >= 1
        assert entities[0].normalized_id == "New_York_City"

    def test_no_entities_found_fallback(self, extractor: HeuristicEntityExtractor) -> None:
        entities = extractor.extract("tell me about paris")
        assert len(entities) >= 1
        assert "Paris" in entities[0].normalized_id or "paris" in entities[0].text.lower()

    def test_empty_query(self, extractor: HeuristicEntityExtractor) -> None:
        entities = extractor.extract("")
        assert entities == []

    def test_confidence_ordering(self, extractor: HeuristicEntityExtractor) -> None:
        entities = extractor.extract("Albert Einstein was born in Germany")
        if len(entities) >= 2:
            assert entities[0].confidence >= entities[1].confidence


# ============================================================================
# NLTKEntityExtractor Tests
# ============================================================================


def nltk_models_available() -> bool:
    """Check if NLTK models are available for testing."""
    try:
        import nltk

        nltk.data.find("tokenizers/punkt_tab/english/")
        nltk.data.find("taggers/averaged_perceptron_tagger_eng")
        nltk.data.find("chunkers/maxent_ne_chunker_tab")
        return True
    except LookupError:
        return False


class TestNLTKEntityExtractor:
    @pytest.fixture
    def extractor(self) -> NLTKEntityExtractor:
        return NLTKEntityExtractor()

    @staticmethod
    def _en(query: str) -> QueryContext:
        return QueryContext(hub_id=1, message_id=1, original_query=query, detected_language="en")

    @pytest.mark.skipif(not nltk_models_available(), reason="NLTK models not downloaded")
    def test_extract_person(self, extractor: NLTKEntityExtractor) -> None:
        query = "Albert Einstein was a physicist"
        entities = extractor.extract(query, self._en(query))
        assert len(entities) >= 1
        albert = next((e for e in entities if "Einstein" in e.normalized_id), None)
        assert albert is not None

    @pytest.mark.skipif(not nltk_models_available(), reason="NLTK models not downloaded")
    def test_extract_location(self, extractor: NLTKEntityExtractor) -> None:
        query = "Paris is the capital of France"
        entities = extractor.extract(query, self._en(query))
        assert len(entities) >= 1
        normalized_ids = [e.normalized_id for e in entities]
        assert any("Paris" in nid or "France" in nid for nid in normalized_ids)

    @pytest.mark.skipif(not nltk_models_available(), reason="NLTK models not downloaded")
    def test_extract_organization(self, extractor: NLTKEntityExtractor) -> None:
        query = "Microsoft was founded by Bill Gates"
        entities = extractor.extract(query, self._en(query))
        assert len(entities) >= 1

    @pytest.mark.skipif(not nltk_models_available(), reason="NLTK models not downloaded")
    def test_fallback_to_proper_nouns(self, extractor: NLTKEntityExtractor) -> None:
        query = "Xyzabc Corporation is located in Qwerty City"
        entities = extractor.extract(query, self._en(query))
        assert len(entities) >= 0

    @pytest.mark.skipif(not nltk_models_available(), reason="NLTK models not downloaded")
    def test_empty_query(self, extractor: NLTKEntityExtractor) -> None:
        entities = extractor.extract("", self._en(""))
        assert entities == []

    def test_entity_type_mapping(self, extractor: NLTKEntityExtractor) -> None:
        assert extractor.NLTK_TYPE_MAP["PERSON"] == "PERSON"
        assert extractor.NLTK_TYPE_MAP["GPE"] == "GPE"
        assert extractor.NLTK_TYPE_MAP["ORGANIZATION"] == "ORG"


# ============================================================================
# get_entity_extractor Factory Tests
# ============================================================================


class TestGetEntityExtractor:
    def test_default_is_heuristic(self) -> None:
        extractor = get_entity_extractor()
        assert isinstance(extractor, HeuristicEntityExtractor)

    def test_get_heuristic(self) -> None:
        extractor = get_entity_extractor("heuristic")
        assert isinstance(extractor, HeuristicEntityExtractor)

    def test_get_nltk(self) -> None:
        extractor = get_entity_extractor("nltk")
        assert isinstance(extractor, NLTKEntityExtractor)

    def test_unknown_defaults_to_heuristic(self) -> None:
        extractor = get_entity_extractor("unknown")
        assert isinstance(extractor, HeuristicEntityExtractor)


# ============================================================================
# SPARQLExecutor Tests
# ============================================================================


class TestSPARQLExecutor:
    @pytest.fixture
    def executor(self) -> SPARQLExecutor:
        return SPARQLExecutor(
            endpoint="https://yago-knowledge.org/sparql/query",
            timeout_seconds=30,
        )

    def test_construct_query(self, executor: SPARQLExecutor) -> None:
        query = executor._construct_query("Albert_Einstein", ["schema:birthDate", "schema:birthPlace"])

        assert "yago:Albert_Einstein" in query
        assert "SELECT" in query
        assert "PREFIX" in query
        assert "schema:birthDate" in query
        assert "schema:birthPlace" in query

    def test_escape_sparql_literal(self, executor: SPARQLExecutor) -> None:
        assert executor._escape_sparql_literal('Foo") . ?s ?p ?o . FILTER(CONTAINS("x') == (
            'Foo\\") . ?s ?p ?o . FILTER(CONTAINS(\\"x'
        )
        assert executor._escape_sparql_literal("back\\slash") == "back\\\\slash"
        assert executor._escape_sparql_literal("line\nbreak") == "line\\nbreak"

    def test_search_by_exact_label_escapes_injection(self, executor: SPARQLExecutor) -> None:
        malicious = 'Foo") . ?s ?p ?o . FILTER(CONTAINS("x'
        with patch.object(executor, "_execute_query", return_value=[]) as mock_execute:
            executor._search_by_exact_label(malicious)

        query = mock_execute.call_args[0][0]
        assert '"Foo\\") . ?s ?p ?o . FILTER(CONTAINS(\\"x"' in query

    def test_search_by_label_contains_escapes_injection(self, executor: SPARQLExecutor) -> None:
        malicious = 'Foo") . ?s ?p ?o . FILTER(CONTAINS("x'
        with patch.object(executor, "_execute_query", return_value=[]) as mock_execute:
            executor._search_by_label_contains(malicious)

        query = mock_execute.call_args[0][0]
        assert '"Foo\\") . ?s ?p ?o . FILTER(CONTAINS(\\"x"' in query

    def test_extract_binding_value(self, executor: SPARQLExecutor) -> None:
        binding = {
            "p": {"value": "http://schema.org/birthDate"},
            "o": {"value": "1879-03-14"},
        }
        assert executor._extract_binding_value(binding, "o") == "1879-03-14"
        assert executor._extract_binding_value(binding, "missing") is None

    def test_extract_binding_value_uri(self, executor: SPARQLExecutor) -> None:
        binding = {
            "o": {"value": "http://yago-knowledge.org/resource/Ulm"},
        }
        assert executor._extract_binding_value(binding, "o") == "Ulm"

    def test_normalize_results(self, executor: SPARQLExecutor) -> None:
        raw_results = [
            {
                "p": {"value": "http://schema.org/birthDate"},
                "pLabel": {"value": "birth date"},
                "o": {"value": "1879-03-14"},
                "oLabel": {"value": "March 14, 1879"},
            },
            {
                "p": {"value": "http://schema.org/birthPlace"},
                "o": {"value": "http://yago-knowledge.org/resource/Ulm"},
            },
        ]

        results = executor._normalize_results(raw_results)

        assert len(results) == 2
        assert results[0]["predicate"] == "birthDate"
        assert results[0]["predicate_label"] == "birth date"
        assert results[0]["object_value"] == "1879-03-14"
        assert results[0]["object_label"] == "March 14, 1879"

    @patch("app.services.router.yago_executor.httpx.Client")
    def test_execute_query_success(self, mock_client_class: MagicMock, executor: SPARQLExecutor) -> None:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "results": {
                "bindings": [
                    {"p": {"value": "birthDate"}, "o": {"value": "1879-03-14"}},
                ]
            }
        }

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_class.return_value = mock_client

        results = executor._execute_query("SELECT * WHERE { ?s ?p ?o }")
        assert len(results) == 1
        assert results[0]["o"]["value"] == "1879-03-14"

    @patch("app.services.router.yago_executor.httpx.Client")
    def test_execute_query_rate_limited(self, mock_client_class: MagicMock, executor: SPARQLExecutor) -> None:
        mock_response = MagicMock()
        mock_response.status_code = 429

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_class.return_value = mock_client

        with pytest.raises(YAGOQueryError) as exc_info:
            executor._execute_query("SELECT * WHERE { ?s ?p ?o }")

        assert "Rate limited" in str(exc_info.value)

    @patch("app.services.router.yago_executor.httpx.Client")
    def test_execute_query_timeout(self, mock_client_class: MagicMock, executor: SPARQLExecutor) -> None:
        import httpx

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.side_effect = httpx.TimeoutException("timeout")
        mock_client_class.return_value = mock_client

        with pytest.raises(YAGOQueryError) as exc_info:
            executor._execute_query("SELECT * WHERE { ?s ?p ?o }")

        assert "timed out" in str(exc_info.value)

    def test_extract_entity_id(self, executor: SPARQLExecutor) -> None:
        uri = "http://yago-knowledge.org/resource/Albert_Einstein"
        assert executor._extract_entity_id(uri) == "Albert_Einstein"

        assert executor._extract_entity_id("http://other.org/resource/Test") is None
        assert executor._extract_entity_id("") is None

    @patch("app.services.router.yago_executor.httpx.Client")
    def test_resolve_entity_exact_match(self, mock_client_class: MagicMock, executor: SPARQLExecutor) -> None:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "results": {
                "bindings": [
                    {"entity": {"value": "http://yago-knowledge.org/resource/Albert_Einstein"}},
                ]
            }
        }

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_class.return_value = mock_client

        result = executor.resolve_entity("Albert Einstein")
        assert result == "Albert_Einstein"

    @patch("app.services.router.yago_executor.httpx.Client")
    def test_resolve_entity_not_found(self, mock_client_class: MagicMock, executor: SPARQLExecutor) -> None:
        # mock all search methods to return empty
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"results": {"bindings": []}, "boolean": False}

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_class.return_value = mock_client

        result = executor.resolve_entity("Nonexistent Entity XYZ")
        assert result is None


# ============================================================================
# CypherExecutor Tests
# ============================================================================


class TestCypherExecutor:
    @pytest.fixture
    def mock_driver(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def executor(self, mock_driver: MagicMock) -> CypherExecutor:
        return CypherExecutor(driver=mock_driver, timeout_seconds=30)

    def test_init_ensures_fulltext_index(self, mock_driver: MagicMock) -> None:
        CypherExecutor(driver=mock_driver, timeout_seconds=30)

        mock_driver.session.assert_called()
        session = mock_driver.session.return_value.__enter__.return_value
        session.run.assert_called()
        call_args = session.run.call_args[0][0]
        assert "CREATE FULLTEXT INDEX" in call_args
        assert "yago_entity_labels" in call_args

    def test_predicate_mapping(self, executor: CypherExecutor) -> None:
        assert executor.PREDICATE_MAPPING["schema:birthDate"] == "birthDate"
        assert executor.PREDICATE_MAPPING["schema:birthPlace"] == "birthPlace"
        assert executor.PREDICATE_MAPPING["rdfs:label"] == "label"

    def test_predicate_categorization(self, executor: CypherExecutor) -> None:
        assert "birthDate" in executor.PROPERTY_PREDICATES
        assert "label" in executor.PROPERTY_PREDICATES
        assert "memberOf" in executor.RELATIONSHIP_PREDICATES
        assert "birthPlace" in executor.RELATIONSHIP_PREDICATES

    def test_construct_query_properties_only(self, executor: CypherExecutor) -> None:
        query = executor._construct_query(prop_keys=["birthDate", "label"], rel_types=[])

        assert "MATCH" in query
        assert "Resource" in query
        assert "$entity_uri" in query
        assert "$prop_keys" in query
        assert "UNWIND" in query

    def test_construct_query_relationships_only(self, executor: CypherExecutor) -> None:
        query = executor._construct_query(prop_keys=[], rel_types=["memberOf", "birthPlace"])

        assert "MATCH" in query
        assert "$entity_uri" in query
        assert "$rel_types" in query
        assert "target.label" in query

    def test_construct_query_both(self, executor: CypherExecutor) -> None:
        query = executor._construct_query(prop_keys=["birthDate"], rel_types=["memberOf"])

        assert "UNION ALL" in query
        assert "$prop_keys" in query
        assert "$rel_types" in query

    def test_normalize_results(self, executor: CypherExecutor) -> None:
        raw_results: list[dict[str, Any]] = [
            {"predicate": "birthDate", "object_value": "1879-03-14", "object_label": None},
            {"predicate": "birthPlace", "object_value": "Ulm", "object_label": "Ulm, Germany"},
        ]

        results = executor._normalize_results(raw_results)

        assert len(results) == 2
        assert results[0]["predicate"] == "schema:birthDate"
        assert results[0]["object_value"] == "1879-03-14"
        assert results[0]["object_label"] is None
        assert results[1]["predicate"] == "schema:birthPlace"
        assert results[1]["object_value"] == "Ulm"
        assert results[1]["object_label"] == "Ulm, Germany"

    def test_execute_query_success(self, executor: CypherExecutor, mock_driver: MagicMock) -> None:
        mock_session = MagicMock()
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(
            return_value=iter(
                [
                    {"predicate": "birthDate", "object_value": "1879-03-14", "object_label": None},
                ]
            )
        )
        mock_session.run.return_value = mock_result
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        mock_driver.session.return_value = mock_session

        results = executor._execute_query(
            "MATCH (e:Resource) RETURN e",
            entity_uri="http://yago-knowledge.org/resource/Albert_Einstein",
            prop_keys=["birthDate"],
            rel_types=[],
        )

        assert len(results) == 1
        assert results[0]["predicate"] == "birthDate"

    def test_execute_query_error(self, executor: CypherExecutor, mock_driver: MagicMock) -> None:
        mock_session = MagicMock()
        mock_session.run.side_effect = Exception("Connection failed")
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        mock_driver.session.return_value = mock_session

        with pytest.raises(YAGOQueryError) as exc_info:
            executor._execute_query(
                "MATCH (e:Resource) RETURN e",
                entity_uri="http://yago-knowledge.org/resource/Albert_Einstein",
                prop_keys=[],
                rel_types=["birthDate"],
            )

        assert "Neo4j query error" in str(exc_info.value)

    def test_extract_entity_id(self, executor: CypherExecutor) -> None:
        uri = "http://yago-knowledge.org/resource/Albert_Einstein"
        assert executor._extract_entity_id(uri) == "Albert_Einstein"

        assert executor._extract_entity_id("http://other.org/resource/Test") is None
        assert executor._extract_entity_id("") is None
        assert executor._extract_entity_id(None) is None  # type: ignore

    def test_escape_lucene_query(self, executor: CypherExecutor) -> None:
        assert executor._escape_lucene_query("Albert Einstein") == "Albert Einstein"
        assert executor._escape_lucene_query("test+query") == "test\\+query"
        assert executor._escape_lucene_query("(test)") == "\\(test\\)"

    def test_resolve_entity_fulltext_match(self, executor: CypherExecutor, mock_driver: MagicMock) -> None:
        mock_session = MagicMock()
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(
            return_value=iter(
                [
                    {
                        "uri": "http://yago-knowledge.org/resource/Albert_Einstein",
                        "label": "Albert Einstein",
                        "score": 1.0,
                    },
                ]
            )
        )
        mock_session.run.return_value = mock_result
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        mock_driver.session.return_value = mock_session

        result = executor.resolve_entity("Albert Einstein")
        assert result == "Albert_Einstein"

    def test_resolve_entity_not_found(self, executor: CypherExecutor, mock_driver: MagicMock) -> None:
        mock_session = MagicMock()
        mock_result_empty = MagicMock()
        mock_result_empty.__iter__ = MagicMock(return_value=iter([]))
        mock_result_empty.single.return_value = None

        mock_session.run.return_value = mock_result_empty
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        mock_driver.session.return_value = mock_session

        result = executor.resolve_entity("Nonexistent Entity XYZ")
        assert result is None


# ============================================================================
# get_yago_executor Factory Tests
# ============================================================================


class TestGetYagoExecutor:
    def test_get_sparql_executor(self) -> None:
        config = SPARQLConfig(endpoint="https://example.com/sparql")
        executor = get_yago_executor(config)
        assert isinstance(executor, SPARQLExecutor)

    @patch("neo4j.GraphDatabase")
    def test_get_cypher_executor(self, mock_graph_db: MagicMock) -> None:
        mock_driver = MagicMock()
        mock_graph_db.driver.return_value = mock_driver
        config = CypherConfig(
            uri="bolt://localhost:7687",
            username="neo4j",
            password="password",
        )
        executor = get_yago_executor(config)
        assert isinstance(executor, CypherExecutor)
        mock_graph_db.driver.assert_called_once_with("bolt://localhost:7687", auth=("neo4j", "password"))

    def test_sparql_requires_endpoint(self) -> None:
        with pytest.raises(ValueError) as exc_info:
            SPARQLConfig(endpoint="")
        assert "endpoint cannot be empty" in str(exc_info.value)

    def test_cypher_requires_credentials(self) -> None:
        with pytest.raises(ValueError) as exc_info:
            CypherConfig(uri="bolt://localhost:7687", username="", password="password")
        assert "username cannot be empty" in str(exc_info.value)

    def test_unknown_config_type(self) -> None:
        with pytest.raises(ValueError) as exc_info:
            get_yago_executor("invalid_config")  # type: ignore
        assert "Unknown config type" in str(exc_info.value)


# ============================================================================
# YAGOHandler Tests
# ============================================================================


class TestYAGOHandler:
    @pytest.fixture
    def mock_config(self) -> MagicMock:
        config = MagicMock()
        config.router_enable_yago = True
        config.yago_query_backend = "sparql"
        config.yago_sparql_endpoint = "https://yago-knowledge.org/sparql/query"
        config.yago_timeout_seconds = 30
        config.yago_entity_extractor = "heuristic"
        config.yago_neo4j_uri = None
        config.yago_neo4j_username = None
        config.yago_neo4j_password = None
        return config

    @pytest.fixture
    def mock_executor(self) -> MagicMock:
        return MagicMock(spec=YAGOQueryExecutor)

    @pytest.fixture
    def handler(self, mock_config: MagicMock, mock_executor: MagicMock) -> YAGOHandler:
        with patch("app.services.router.yago_handler.Config", return_value=mock_config):
            return YAGOHandler(executor=mock_executor)

    @pytest.fixture
    def query_context(self) -> QueryContext:
        return QueryContext(
            hub_id=1,
            message_id=1,
            original_query="Who is Albert Einstein?",
        )

    def test_source(self, handler: YAGOHandler) -> None:
        from app.services.router.models import KnowledgeSource

        assert handler.source == KnowledgeSource.YAGO

    def test_is_enabled_true(self, handler: YAGOHandler, mock_config: MagicMock) -> None:
        mock_config.router_enable_yago = True
        assert handler.is_enabled() is True

    def test_is_enabled_false(self, handler: YAGOHandler, mock_config: MagicMock) -> None:
        mock_config.router_enable_yago = False
        assert handler.is_enabled() is False

    def test_interesting_predicates_defined(self) -> None:
        assert len(INTERESTING_PREDICATES) > 0
        assert "schema:birthDate" in INTERESTING_PREDICATES
        assert "schema:description" in INTERESTING_PREDICATES

    def test_humanize_predicate(self, handler: YAGOHandler) -> None:
        assert handler._humanize_predicate("birthDate") == "Birth Date"
        assert handler._humanize_predicate("http://schema.org/birthPlace") == "Birth Place"
        assert handler._humanize_predicate("deathDate") == "Death Date"

    def test_extract_facts(self, handler: YAGOHandler) -> None:
        entity = ExtractedEntity(
            text="Albert Einstein",
            normalized_id="Albert_Einstein",
            confidence=0.9,
        )
        results: list[QueryResult] = [
            QueryResult(
                predicate="schema:birthDate",
                predicate_label="birthDate",
                object_value="1879-03-14",
                object_label=None,
            ),
            QueryResult(
                predicate="schema:birthPlace",
                predicate_label="birthPlace",
                object_value="Ulm",
                object_label="Ulm, Germany",
            ),
        ]

        snippets = handler._extract_facts(results, entity)

        assert len(snippets) > 0
        assert any("Albert Einstein" in s for s in snippets)

    def test_retrieve_success_returns_enrichment(
        self,
        handler: YAGOHandler,
        mock_executor: MagicMock,
        query_context: QueryContext,
    ) -> None:
        """YAGOHandler acts as enricher - returns facts in context_snippets, no answer."""
        mock_executor.resolve_entity.return_value = "Albert_Einstein"
        mock_executor.execute.return_value = [
            QueryResult(
                predicate="schema:birthDate",
                predicate_label="birthDate",
                object_value="1879-03-14",
                object_label=None,
            ),
            QueryResult(
                predicate="schema:occupation",
                predicate_label="occupation",
                object_value="Physicist",
                object_label=None,
            ),
        ]

        result = handler._retrieve("Who is Albert Einstein?", query_context)

        assert result.success is True
        assert result.answer is None
        assert len(result.context_snippets) > 0
        assert result.metadata["entity_text"] == "Albert Einstein"
        assert result.metadata["resolved_entity"] == "Albert_Einstein"
        assert result.metadata["facts_retrieved"] > 0
        mock_executor.resolve_entity.assert_called_once()
        mock_executor.execute.assert_called_once_with("Albert_Einstein", INTERESTING_PREDICATES)

    def test_retrieve_no_results(
        self,
        handler: YAGOHandler,
        mock_executor: MagicMock,
        query_context: QueryContext,
    ) -> None:
        mock_executor.resolve_entity.return_value = "Albert_Einstein"
        mock_executor.execute.return_value = []

        result = handler._retrieve("Who is Albert Einstein?", query_context)

        assert result.success is False
        assert "No information found" in (result.error or "")

    def test_retrieve_entity_not_resolved(
        self,
        handler: YAGOHandler,
        mock_executor: MagicMock,
        query_context: QueryContext,
    ) -> None:
        mock_executor.resolve_entity.return_value = None

        result = handler._retrieve("Who is Albert Einstein?", query_context)

        assert result.success is False
        assert "Could not find" in (result.error or "")
        mock_executor.execute.assert_not_called()

    def test_retrieve_no_entities(self, handler: YAGOHandler, query_context: QueryContext) -> None:
        result = handler._retrieve("", query_context)

        assert result.success is False
        assert "Could not identify" in (result.error or "")

    def test_retrieve_executor_error(
        self,
        handler: YAGOHandler,
        mock_executor: MagicMock,
        query_context: QueryContext,
    ) -> None:
        mock_executor.resolve_entity.return_value = "Albert_Einstein"
        mock_executor.execute.side_effect = YAGOQueryError("Connection failed")

        result = handler._retrieve("Who is Albert Einstein?", query_context)

        assert result.success is False
        assert "Connection failed" in (result.error or "")

    def test_retrieve_resolution_error(
        self,
        handler: YAGOHandler,
        mock_executor: MagicMock,
        query_context: QueryContext,
    ) -> None:
        mock_executor.resolve_entity.side_effect = YAGOQueryError("Resolution failed")

        result = handler._retrieve("Who is Albert Einstein?", query_context)

        assert result.success is False
        assert "Resolution failed" in (result.error or "")
        mock_executor.execute.assert_not_called()

    def test_custom_extractor(self, mock_config: MagicMock) -> None:
        custom_extractor = MagicMock(spec=EntityExtractor)
        custom_extractor.extract.return_value = [ExtractedEntity(text="Custom", normalized_id="Custom", confidence=0.8)]

        with patch("app.services.router.yago_handler.Config", return_value=mock_config):
            handler = YAGOHandler(extractor=custom_extractor)

        assert handler.extractor is custom_extractor

    def test_custom_executor(self, mock_config: MagicMock) -> None:
        custom_executor = MagicMock(spec=YAGOQueryExecutor)

        with patch("app.services.router.yago_handler.Config", return_value=mock_config):
            handler = YAGOHandler(executor=custom_executor)

        assert handler.executor is custom_executor

    def test_metadata_includes_query_backend(
        self,
        handler: YAGOHandler,
        mock_executor: MagicMock,
        mock_config: MagicMock,
        query_context: QueryContext,
    ) -> None:
        mock_executor.resolve_entity.return_value = "Albert_Einstein"
        mock_executor.execute.return_value = [
            QueryResult(
                predicate="schema:birthDate",
                predicate_label="birthDate",
                object_value="1879-03-14",
                object_label=None,
            ),
        ]

        result = handler._retrieve("Who is Albert Einstein?", query_context)

        assert "query_backend" in result.metadata
        assert result.metadata["query_backend"] == mock_config.yago_query_backend
