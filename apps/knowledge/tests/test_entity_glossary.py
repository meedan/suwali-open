from unittest.mock import patch

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda

from app.core.config import Config
from app.core.llm_config import LLMConfig
from app.services.entity_glossary import EntityGlossaryExtractor, GlossaryEntry

_LONG_TEXT = "Misoprostol causes cramps and bleeding that empty the uterus. " * 10

_SCHEMA = "Person, Organization, Medication, Symptom\nRelationships: CAUSES, PREVENTS"


def _extractor(config: Config | None = None) -> EntityGlossaryExtractor:
    return EntityGlossaryExtractor(config=config or Config(), llm_config=LLMConfig())


def test_extract_normalizes_and_dedupes() -> None:
    raw = [
        GlossaryEntry(name="  Misoprostol ", label=" Medication ", aliases=[" miso ", "", "misoprostol"]),
        GlossaryEntry(name="misoprostol", label="Concept"),
        GlossaryEntry(name="", label="Concept"),
        GlossaryEntry(name="Mifepristone", label=""),
    ]
    with patch.object(EntityGlossaryExtractor, "_extract_with_llm", return_value=raw):
        entries = _extractor().extract(_LONG_TEXT, _SCHEMA)

    assert [(e.name, e.label) for e in entries] == [("Misoprostol", "Medication"), ("Mifepristone", "Concept")]
    # aliases are trimmed, and an alias equal to the canonical name is dropped
    assert entries[0].aliases == ["miso"]


def test_extract_preserves_person_names_as_returned() -> None:
    raw = [
        GlossaryEntry(name="Dr. Klaus Werner", label="Person"),
        GlossaryEntry(name="Professor Heinrich Baumann", label="Person", aliases=["Prof. Baumann"]),
        GlossaryEntry(name="Dr. Pepper", label="Organization"),
    ]
    with patch.object(EntityGlossaryExtractor, "_extract_with_llm", return_value=raw):
        entries = _extractor().extract(_LONG_TEXT, _SCHEMA)

    by_name = {e.name: e for e in entries}
    assert "Dr. Klaus Werner" in by_name
    assert by_name["Dr. Klaus Werner"].aliases == []
    assert "Professor Heinrich Baumann" in by_name
    assert by_name["Professor Heinrich Baumann"].aliases == ["Prof. Baumann"]
    assert "Dr. Pepper" in by_name


def test_glossary_prompt_requires_countries_and_one_shot_named_entities() -> None:
    """Coverage rules that previously caused integration-test failures."""
    from app.services import entity_glossary as mod

    assert "ALWAYS include every named country" in mod._INSTRUCTIONS
    assert "ALWAYS include named organizations, people, and institutions that appear even once" in mod._INSTRUCTIONS
    assert "honorific" not in mod._INSTRUCTIONS.lower()


def test_extract_caps_at_max_entities() -> None:
    config = Config().model_copy(update={"entity_glossary_max_entities": 2})
    raw = [GlossaryEntry(name=f"Entity {i}", label="Concept") for i in range(5)]
    with patch.object(EntityGlossaryExtractor, "_extract_with_llm", return_value=raw):
        entries = _extractor(config).extract(_LONG_TEXT, _SCHEMA)

    assert len(entries) == 2


def test_extract_skips_short_text() -> None:
    with patch.object(EntityGlossaryExtractor, "_extract_with_llm") as mock_llm:
        entries = _extractor().extract("too short", _SCHEMA)

    assert entries == []
    mock_llm.assert_not_called()


def test_validate_entries_keeps_valid_and_drops_malformed() -> None:
    data = {
        "entities": [
            {"name": "Misoprostol", "label": "Medication", "aliases": ["miso"]},
            {"name": "Mifepristone", "label": "Medication"},
            {"name": "truncat"},  # tail entry cut off before "label" when output hit the token limit
            {"label": "Concept"},  # missing name
        ]
    }
    entries = EntityGlossaryExtractor._validate_entries(data)

    assert [(e.name, e.label) for e in entries] == [("Misoprostol", "Medication"), ("Mifepristone", "Medication")]
    assert entries[0].aliases == ["miso"]


def test_validate_entries_handles_unexpected_shapes() -> None:
    assert EntityGlossaryExtractor._validate_entries(None) == []
    assert EntityGlossaryExtractor._validate_entries([]) == []
    assert EntityGlossaryExtractor._validate_entries({"entities": "not a list"}) == []


def test_extract_returns_empty_on_llm_error() -> None:
    with patch.object(EntityGlossaryExtractor, "_extract_with_llm", side_effect=RuntimeError("boom")):
        entries = _extractor().extract(_LONG_TEXT, _SCHEMA)

    assert entries == []


def test_extract_with_llm_uses_ingestion_timeout() -> None:
    llm_config = LLMConfig()
    extractor = EntityGlossaryExtractor(config=Config(), llm_config=llm_config)

    with patch("app.services.entity_glossary.create_chat_model") as mock_create_chat_model:
        mock_create_chat_model.return_value = RunnableLambda(lambda _: AIMessage(content='{"entities": []}'))
        extractor._extract_with_llm(_LONG_TEXT, _SCHEMA)

    mock_create_chat_model.assert_called_once_with(
        llm_config.llm_ingestor_glossary,
        llm_config,
        timeout_seconds=llm_config.llm_ingestion_timeout_seconds,
    )


def test_extract_truncates_input_to_max_chars() -> None:
    config = Config().model_copy(update={"entity_glossary_max_input_chars": 300})
    with patch.object(EntityGlossaryExtractor, "_extract_with_llm", return_value=[]) as mock_llm:
        _extractor(config).extract(_LONG_TEXT, _SCHEMA)

    text_sample = mock_llm.call_args[0][0]
    assert len(text_sample) == 300
