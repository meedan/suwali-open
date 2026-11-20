from unittest.mock import AsyncMock, patch

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda

from app.core.config import Config
from app.core.llm_config import LLMConfig
from app.services.topic_extractor import TopicExtractor

_LONG_TEXT = "The general election results were announced today across the country. " * 5


def _extractor(config: Config | None = None) -> TopicExtractor:
    return TopicExtractor(config=config or Config(), llm_config=LLMConfig())


async def test_extract_normalizes_and_dedupes() -> None:
    extractor = _extractor()
    with patch.object(
        TopicExtractor, "_extract_with_llm", return_value=["Elections", "elections", "  Climate Policy ", ""]
    ):
        result = await extractor.extract(_LONG_TEXT, [], content_language="en")

    assert result == ["Elections", "Climate Policy"]


async def test_extract_truncates_to_max_count() -> None:
    extractor = _extractor(Config().model_copy(update={"topic_extraction_max_count": 2}))
    with patch.object(TopicExtractor, "_extract_with_llm", return_value=["A", "B", "C", "D"]):
        result = await extractor.extract(_LONG_TEXT, [], content_language="en")

    assert result == ["A", "B"]


async def test_extract_returns_empty_for_short_text() -> None:
    extractor = _extractor()
    with patch.object(TopicExtractor, "_extract_with_llm") as mock_llm:
        result = await extractor.extract("short", [])

    assert result == []
    mock_llm.assert_not_called()


async def test_extract_allows_text_at_min_length() -> None:
    extractor = _extractor()
    with patch.object(TopicExtractor, "_extract_with_llm", return_value=["Elections"]) as mock_llm:
        result = await extractor.extract("Who won the election?", [], content_language="en")

    assert result == ["Elections"]
    mock_llm.assert_called_once()


async def test_extract_returns_empty_on_llm_error() -> None:
    extractor = _extractor()
    with patch.object(TopicExtractor, "_extract_with_llm", side_effect=RuntimeError("boom")):
        result = await extractor.extract(_LONG_TEXT, [], content_language="en")

    assert result == []


def test_select_candidate_topics_caps_and_dedupes() -> None:
    extractor = _extractor(Config().model_copy(update={"topic_extraction_max_existing": 2}))

    candidates = extractor._select_candidate_topics(["Elections", "elections", "Climate", "Economy"])

    assert candidates == ["Elections", "Climate"]


def test_select_candidate_topics_keeps_all_languages() -> None:
    extractor = _extractor()

    candidates = extractor._select_candidate_topics(["Eleições", "Elections", "Élections"])

    assert candidates == ["Eleições", "Elections", "Élections"]


async def test_extract_passes_capped_candidates_to_llm() -> None:
    extractor = _extractor(Config().model_copy(update={"topic_extraction_max_existing": 1}))
    with patch.object(TopicExtractor, "_extract_with_llm", return_value=["Elections"]) as mock_llm:
        await extractor.extract(_LONG_TEXT, ["United States", "Climate Policy"], content_language="en")

    _, candidate_topics, content_language = mock_llm.call_args[0]
    assert candidate_topics == ["United States"]
    assert content_language == "en"


async def test_extract_uses_provided_content_language() -> None:
    extractor = _extractor()
    with (
        patch("app.services.topic_extractor.detect_text", new_callable=AsyncMock) as mock_detect_text,
        patch.object(TopicExtractor, "_extract_with_llm", return_value=["Eleições"]) as mock_llm,
    ):
        await extractor.extract("Texto em português sobre eleições municipais.", [], content_language="pt")

    mock_detect_text.assert_not_called()
    _, _, content_language = mock_llm.call_args[0]
    assert content_language == "pt"


async def test_extract_builds_prompt_with_existing_topics_and_reuses_name() -> None:
    captured: dict[str, str] = {}

    def fake_model(prompt_value: object) -> AIMessage:
        captured["prompt"] = prompt_value.to_string()  # type: ignore[attr-defined]
        return AIMessage(content='{"topics": ["United States", "Elections"]}')

    extractor = _extractor()
    with patch("app.services.topic_extractor.create_chat_model", return_value=RunnableLambda(fake_model)):
        result = await extractor.extract(_LONG_TEXT, ["United States", "Climate Policy"], content_language="en")

    assert result == ["United States", "Elections"]
    assert "United States" in captured["prompt"]
    assert "Climate Policy" in captured["prompt"]


async def test_extract_prompt_includes_content_language_block() -> None:
    captured: dict[str, str] = {}

    def fake_model(prompt_value: object) -> AIMessage:
        captured["prompt"] = prompt_value.to_string()  # type: ignore[attr-defined]
        return AIMessage(content='{"topics": ["Futebol"]}')

    extractor = _extractor()
    with patch("app.services.topic_extractor.create_chat_model", return_value=RunnableLambda(fake_model)):
        await extractor.extract(_LONG_TEXT, [], content_language="pt")

    assert "## Content language" in captured["prompt"]
    assert "Português (pt)" in captured["prompt"]


async def test_extract_prompt_omits_content_language_block_when_unknown() -> None:
    captured: dict[str, str] = {}

    def fake_model(prompt_value: object) -> AIMessage:
        captured["prompt"] = prompt_value.to_string()  # type: ignore[attr-defined]
        return AIMessage(content='{"topics": ["Elections"]}')

    extractor = _extractor()
    with (
        patch("app.services.topic_extractor.detect_text", new_callable=AsyncMock, return_value=(None, 0.0)),
        patch("app.services.topic_extractor.create_chat_model", return_value=RunnableLambda(fake_model)),
    ):
        await extractor.extract(_LONG_TEXT, [])

    assert "## Content language" not in captured["prompt"]


def test_extract_with_llm_uses_ingestion_timeout() -> None:
    llm_config = LLMConfig()
    extractor = TopicExtractor(config=Config(), llm_config=llm_config)

    with patch("app.services.topic_extractor.create_chat_model") as mock_create_chat_model:
        mock_create_chat_model.return_value = RunnableLambda(lambda _: AIMessage(content='{"topics": ["Elections"]}'))
        extractor._extract_with_llm(_LONG_TEXT, [])

    mock_create_chat_model.assert_called_once_with(
        llm_config.llm_topic_extractor,
        llm_config,
        timeout_seconds=llm_config.llm_ingestion_timeout_seconds,
    )


async def test_extract_prompt_includes_conditional_reuse_instruction() -> None:
    captured: dict[str, str] = {}

    def fake_model(prompt_value: object) -> AIMessage:
        captured["prompt"] = prompt_value.to_string()  # type: ignore[attr-defined]
        return AIMessage(content='{"topics": ["Elections"]}')

    extractor = _extractor()
    with patch("app.services.topic_extractor.create_chat_model", return_value=RunnableLambda(fake_model)):
        await extractor.extract(_LONG_TEXT, [], content_language="en")

    assert "If a topic name is in the same language as the content" in captured["prompt"]
    assert "including accents and diacritics" in captured["prompt"]
    assert "Eleições" in captured["prompt"]
    assert "Élections" in captured["prompt"]
