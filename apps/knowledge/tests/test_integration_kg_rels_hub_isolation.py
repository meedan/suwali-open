"""Integration tests: kg_rels must never carry another hub's relationships.

Entity nodes are shared across hubs (the KG builder's resolver merges them globally by label and
name), so an edge between two entities that both appear in hub X may have been extracted from a
hub-Y chunk and carry hub Y's text in `evidence`/`details`. The graph is seeded directly instead of
through ingestion so the cross-hub edge exists deterministically, without depending on what the
extraction LLM chooses to relate; the production retrieval Cypher from `build_retrieval_query` then
runs against it with `node`/`score` bound the way the retriever wrapper binds them.
"""

from collections.abc import Generator

import pytest
from neo4j import Driver

from app.services.dual_retriever import build_retrieval_query

pytestmark = pytest.mark.integration

# coined hubs, outside every hub the shared integration fixtures use
_HUB_X = 911
_HUB_Y = 912
_FIXTURE_FLAG = "kg_hub_isolation_fixture"

_ORG = "Quillmoor Trust"
_PLACE = "Vessridge"
_PERSON = "Odile Farran"
_HUB_X_DETAILS = "Quillmoor Trust is headquartered in Vessridge"
_HUB_Y_EVIDENCE = "Odile Farran resigned because the Quillmoor Trust froze its grants"

_EMBEDDING = [1.0, 0.0, 0.0]


def _seed_graph(driver: Driver) -> None:
    """Hub X: chunk X1 names the org and the place (with hub X's own edge), chunk X2 names the person.
    Hub Y: one chunk naming the org and the person, with a hub-Y-only CAUSES edge between them.

    The org and the person both belong to hub X but never co-occur in one hub-X chunk, so the
    hub-Y edge is exactly the shape the old "connectedEntity touches some hub chunk" check let through.
    """
    query = f"""
    CREATE (dx:Document_{_HUB_X} {{document_id: 'quillmoor-x.txt', {_FIXTURE_FLAG}: true}})
    CREATE (x1:Chunk_{_HUB_X} {{text: $x1_text, embedding: $embedding, index: 0, {_FIXTURE_FLAG}: true}})
    CREATE (x2:Chunk_{_HUB_X} {{text: $x2_text, embedding: $embedding, index: 1, {_FIXTURE_FLAG}: true}})
    CREATE (x1)-[:FROM_DOCUMENT]->(dx), (x2)-[:FROM_DOCUMENT]->(dx)

    CREATE (dy:Document_{_HUB_Y} {{document_id: 'quillmoor-y.txt', {_FIXTURE_FLAG}: true}})
    CREATE (y1:Chunk_{_HUB_Y} {{text: $y1_text, embedding: $embedding, index: 0, {_FIXTURE_FLAG}: true}})
    CREATE (y1)-[:FROM_DOCUMENT]->(dy)

    CREATE (org:Organization:__Entity__:__KGBuilder__ {{name: $org, {_FIXTURE_FLAG}: true}})
    CREATE (place:Location:__Entity__:__KGBuilder__ {{name: $place, {_FIXTURE_FLAG}: true}})
    CREATE (person:Person:__Entity__:__KGBuilder__ {{name: $person, {_FIXTURE_FLAG}: true}})

    CREATE (org)-[:FROM_CHUNK]->(x1), (place)-[:FROM_CHUNK]->(x1)
    CREATE (person)-[:FROM_CHUNK]->(x2)
    CREATE (org)-[:FROM_CHUNK]->(y1), (person)-[:FROM_CHUNK]->(y1)

    CREATE (org)-[:LOCATED_IN {{details: $x_details}}]->(place)
    CREATE (org)-[:CAUSES {{modality: 'asserted', evidence: $y_evidence}}]->(person)
    """
    with driver.session() as session:
        session.run(
            query,
            x1_text=f"{_HUB_X_DETAILS}.",
            x2_text=f"{_PERSON} chairs the Vessridge library board.",
            y1_text=f"{_HUB_Y_EVIDENCE}.",
            embedding=_EMBEDDING,
            org=_ORG,
            place=_PLACE,
            person=_PERSON,
            x_details=_HUB_X_DETAILS,
            y_evidence=_HUB_Y_EVIDENCE,
        ).consume()


def _delete_graph(driver: Driver) -> None:
    with driver.session() as session:
        session.run(f"MATCH (n) WHERE n.{_FIXTURE_FLAG} = true DETACH DELETE n").consume()


@pytest.fixture
def seeded_graph(neo4j_driver: Driver) -> Generator[Driver, None, None]:
    _delete_graph(neo4j_driver)
    _seed_graph(neo4j_driver)
    yield neo4j_driver
    _delete_graph(neo4j_driver)


def _kg_rels_for_hub(driver: Driver, hub_id: int) -> str:
    """Run the production retrieval Cypher over every chunk of the hub and return its kg_rels section."""
    retrieval_query = build_retrieval_query(hub_id, 100, 200, 500, 3000)
    query = f"MATCH (node:Chunk_{hub_id}) WITH node, 1.0 AS score\n{retrieval_query}"
    with driver.session() as session:
        records = session.run(query, query_vector=_EMBEDDING).data()
    assert records, f"retrieval over the seeded hub {hub_id} must return a row"
    return "\n".join(str(record["context"]).partition("=== kg_rels ===")[2] for record in records)


def _assert_cross_hub_edge_reachable_by_old_check(driver: Driver) -> None:
    """Guard against a vacuous pass: the hub-Y edge must hang off hub-X entities exactly the way the
    pre-fix traversal accepted (start entity on a hub-X chunk, other end on some hub-X chunk)."""
    query = f"""
    MATCH (:Chunk_{_HUB_X})<-[:FROM_CHUNK]-(e)-[r:CAUSES]-(other)
    WHERE EXISTS {{ MATCH (other)-[:FROM_CHUNK]->(:Chunk_{_HUB_X}) }}
    RETURN count(r) AS c
    """
    with driver.session() as session:
        record = session.run(query).single()
    assert record is not None and record["c"] > 0, "seed must contain a hub-Y edge reachable from hub X"


def test_kg_rels_exclude_relationship_extracted_in_another_hub(seeded_graph: Driver) -> None:
    _assert_cross_hub_edge_reachable_by_old_check(seeded_graph)

    kg_rels = _kg_rels_for_hub(seeded_graph, _HUB_X)

    assert _HUB_Y_EVIDENCE not in kg_rels, f"hub {_HUB_Y}'s relationship text leaked into hub {_HUB_X}: {kg_rels!r}"
    assert "CAUSES" not in kg_rels, f"hub {_HUB_Y}'s edge leaked into hub {_HUB_X}: {kg_rels!r}"


def test_kg_rels_keep_relationship_extracted_in_the_same_hub(seeded_graph: Driver) -> None:
    kg_rels = _kg_rels_for_hub(seeded_graph, _HUB_X)

    assert f"{_ORG} - LOCATED_IN" in kg_rels, f"hub {_HUB_X}'s own edge must stay in kg_rels: {kg_rels!r}"
    assert _HUB_X_DETAILS in kg_rels


def test_kg_rels_keep_the_other_hubs_own_relationship(seeded_graph: Driver) -> None:
    """The edge is not dropped globally — hub Y, which extracted it, still sees it."""
    kg_rels = _kg_rels_for_hub(seeded_graph, _HUB_Y)

    assert _HUB_Y_EVIDENCE in kg_rels
    assert _HUB_X_DETAILS not in kg_rels
