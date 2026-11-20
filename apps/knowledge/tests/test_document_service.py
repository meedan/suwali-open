from unittest.mock import MagicMock

from app.services.document import Document


def test_remove_document_success() -> None:
    hub_id = 1
    document_id = "test_doc_123"
    mock_session = MagicMock()

    mock_result = MagicMock()
    mock_record = MagicMock()
    mock_record.__getitem__.return_value = 1  # deletedCount = 1
    mock_record.data.return_value = {"deletedCount": 1}
    mock_result.single.return_value = mock_record
    mock_session.run.return_value = mock_result

    document = Document(mock_session, hub_id)
    result = document.remove(document_id)

    assert result is True
    mock_session.run.assert_called_once()

    call_args = mock_session.run.call_args
    query = call_args[0][0]
    params = call_args[0][1]

    assert f"MATCH (d:Document_{hub_id}" in query
    assert "OPTIONAL MATCH (c:Chunk_" in query
    assert "DETACH DELETE d, c" in query
    assert "RETURN COUNT(d) AS deletedCount" in query
    assert params["document_id"] == document_id
    assert params["hub_id"] == hub_id


def test_remove_document_multiple_deletions() -> None:
    hub_id = 2
    document_id = "duplicate_doc"
    mock_session = MagicMock()

    mock_result = MagicMock()
    mock_record = MagicMock()
    mock_record.__getitem__.return_value = 3  # deletedCount = 3
    mock_record.data.return_value = {"deletedCount": 3}
    mock_result.single.return_value = mock_record
    mock_session.run.return_value = mock_result

    document = Document(mock_session, hub_id)
    result = document.remove(document_id)

    assert result is True
    mock_session.run.assert_called_once()


def test_remove_document_not_found() -> None:
    hub_id = 3
    document_id = "nonexistent_doc"
    mock_session = MagicMock()

    mock_result = MagicMock()
    mock_record = MagicMock()
    mock_record.__getitem__.return_value = 0  # deletedCount = 0
    mock_record.data.return_value = {"deletedCount": 0}
    mock_result.single.return_value = mock_record
    mock_session.run.return_value = mock_result

    document = Document(mock_session, hub_id)
    result = document.remove(document_id)

    assert result is False
    mock_session.run.assert_called_once()


def test_remove_document_no_record_returned() -> None:
    hub_id = 4
    document_id = "test_doc_456"
    mock_session = MagicMock()

    mock_result = MagicMock()
    mock_result.single.return_value = None
    mock_session.run.return_value = mock_result

    document = Document(mock_session, hub_id)
    result = document.remove(document_id)

    assert result is False
    mock_session.run.assert_called_once()


def test_remove_document_query_exception() -> None:
    hub_id = 5
    document_id = "test_doc_789"
    mock_session = MagicMock()

    mock_session.run.side_effect = Exception("Database connection failed")

    document = Document(mock_session, hub_id)
    result = document.remove(document_id)

    assert result is False
    mock_session.run.assert_called_once()


def test_remove_document_result_exception() -> None:
    hub_id = 6
    document_id = "test_doc_abc"
    mock_session = MagicMock()

    mock_result = MagicMock()
    mock_result.single.side_effect = Exception("Failed to fetch result")
    mock_session.run.return_value = mock_result

    document = Document(mock_session, hub_id)
    result = document.remove(document_id)

    assert result is False
    mock_session.run.assert_called_once()


def test_remove_document_record_access_exception() -> None:
    hub_id = 7
    document_id = "test_doc_def"
    mock_session = MagicMock()

    mock_result = MagicMock()
    mock_record = MagicMock()
    mock_record.__getitem__.side_effect = KeyError("deletedCount")
    mock_result.single.return_value = mock_record
    mock_session.run.return_value = mock_result

    document = Document(mock_session, hub_id)
    result = document.remove(document_id)

    assert result is False
    mock_session.run.assert_called_once()


def test_remove_document_preserves_hub_isolation() -> None:
    hub_id = 99
    document_id = "test_doc_isolation"
    mock_session = MagicMock()

    mock_result = MagicMock()
    mock_record = MagicMock()
    mock_record.__getitem__.return_value = 1
    mock_record.data.return_value = {"deletedCount": 1}
    mock_result.single.return_value = mock_record
    mock_session.run.return_value = mock_result

    document = Document(mock_session, hub_id)
    result = document.remove(document_id)

    assert result is True

    call_args = mock_session.run.call_args
    query = call_args[0][0]

    assert f"Document_{hub_id}" in query
    assert f"Chunk_{hub_id}" in query


def test_document_initialization() -> None:
    hub_id = 1
    mock_session = MagicMock()

    document = Document(mock_session, hub_id)
    document = Document(mock_session, hub_id)

    assert document.session == mock_session
    assert document.hub_id == hub_id


def test_remove_document_with_special_characters_in_id() -> None:
    hub_id = 8
    document_id = "doc_with_'quotes'_and_\"more\"_123"
    mock_session = MagicMock()

    mock_result = MagicMock()
    mock_record = MagicMock()
    mock_record.__getitem__.return_value = 1
    mock_record.data.return_value = {"deletedCount": 1}
    mock_result.single.return_value = mock_record
    mock_session.run.return_value = mock_result

    document = Document(mock_session, hub_id)
    result = document.remove(document_id)

    assert result is True

    call_args = mock_session.run.call_args
    params = call_args[0][1]
    assert params["document_id"] == document_id


def test_normalize_stored_topics_lowercases_trims_and_dedupes() -> None:
    from app.services.document import normalize_stored_topics

    assert normalize_stored_topics(["Elections", " Saúde Pública ", "", "elections", "  "]) == [
        "elections",
        "saúde pública",
    ]


def test_set_topics_replaces_normalized_topics_scoped_to_hub() -> None:
    mock_session = MagicMock()
    mock_record = MagicMock()
    mock_record.__getitem__.return_value = 1
    mock_session.run.return_value.single.return_value = mock_record

    result = Document(mock_session, 7).set_topics("doc1", ["Elections", "Public Health"])

    assert result is True
    query, params = mock_session.run.call_args[0]
    assert "MATCH (d:Document_7 {document_id: $document_id})" in query
    assert "OPTIONAL MATCH (d)-[r:HAS_TOPIC]->(:Topic_7)" in query
    assert "MERGE (t:Topic_7 {name: name})" in query
    assert "MERGE (d)-[:HAS_TOPIC]->(t)" in query
    assert params == {"document_id": "doc1", "topics": ["elections", "public health"]}


def test_set_topics_accepts_empty_list() -> None:
    mock_session = MagicMock()
    mock_record = MagicMock()
    mock_record.__getitem__.return_value = 1
    mock_session.run.return_value.single.return_value = mock_record

    assert Document(mock_session, 7).set_topics("doc1", []) is True
    assert mock_session.run.call_args[0][1]["topics"] == []


def test_set_topics_returns_false_when_document_missing() -> None:
    mock_session = MagicMock()
    mock_record = MagicMock()
    mock_record.__getitem__.return_value = 0
    mock_session.run.return_value.single.return_value = mock_record

    assert Document(mock_session, 7).set_topics("missing", ["Elections"]) is False
