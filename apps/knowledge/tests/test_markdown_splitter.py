from typing import cast
from unittest.mock import MagicMock, patch

import pytest

from app.services.markdown_splitter import MarkdownStructureSplitter
from app.services.semchunk_splitter_adapter import SemchunkTextSplitterAdapter
from app.services.text_splitter_factory import TextSplitterFactory


class StubInner:
    """Duck-typed stand-in for SemchunkTextSplitterAdapter: 1 token per whitespace-separated word."""

    def __init__(self, prose_piece_words: int = 30) -> None:
        self.prose_piece_words = prose_piece_words
        self.enforce_calls: list[list[str]] = []

    def count_tokens(self, text: str) -> int:
        return len(text.split())

    def split_prose(self, text: str, chunk_size: int | None = None) -> list[str]:
        words = text.split()
        n = chunk_size or self.prose_piece_words
        return [" ".join(words[i : i + n]) for i in range(0, len(words), n)]

    def enforce_max_chunk_chars(self, chunks: list[str]) -> list[str]:
        self.enforce_calls.append(chunks)
        return chunks


def make_splitter(chunk_size: int, breadcrumbs: bool = True) -> tuple[MarkdownStructureSplitter, StubInner]:
    stub = StubInner()
    splitter = MarkdownStructureSplitter(
        inner=cast(SemchunkTextSplitterAdapter, stub),
        chunk_size=chunk_size,
        breadcrumbs=breadcrumbs,
    )
    return splitter, stub


def test_heading_stays_with_first_body_block() -> None:
    splitter, _ = make_splitter(chunk_size=22)
    doc = (
        "First paragraph with enough words to nearly fill the whole token budget of the chunk right here now\n\n"
        "## Section\n\n"
        "Body paragraph of the section."
    )

    chunks = splitter.split_text(doc)

    assert len(chunks) == 2
    # the heading must not dangle at the end of the first chunk
    assert "## Section" not in chunks[0]
    assert "## Section" in chunks[1]
    assert "Body paragraph of the section." in chunks[1]


def test_small_table_stays_intact() -> None:
    splitter, _ = make_splitter(chunk_size=60)
    table = "| Name | Role |\n| --- | --- |\n| Alice | Speaker |\n| Bob | Host |"
    doc = f"# Schedule\n\n{table}"

    chunks = splitter.split_text(doc)

    assert len(chunks) == 1
    assert table in chunks[0]


def test_oversized_table_splits_by_rows_with_header_repeated() -> None:
    splitter, _ = make_splitter(chunk_size=30)
    header = "| Name | Role | Notes |\n| --- | --- | --- |"
    rows = [f"| Person{i} | Role{i} | some extra filler words here |" for i in range(6)]
    doc = "# Big\n\n" + header + "\n" + "\n".join(rows)

    chunks = splitter.split_text(doc)

    assert len(chunks) > 1
    for chunk in chunks:
        assert "| Name | Role | Notes |" in chunk
        assert "| --- | --- | --- |" in chunk
    # every row survives, exactly once across all chunks
    joined = "\n".join(chunks)
    for row in rows:
        assert joined.count(row) == 1


def test_long_list_splits_between_items_and_keeps_intro_with_first_item() -> None:
    splitter, _ = make_splitter(chunk_size=20)
    items = [f"- item {i} with several extra words" for i in range(6)]
    doc = "Here are the items:\n\n" + "\n".join(items)

    chunks = splitter.split_text(doc)

    assert len(chunks) > 1
    assert "Here are the items:" in chunks[0]
    assert items[0] in chunks[0]
    # no item is ever cut in half
    joined = "\n".join(chunks)
    for item in items:
        assert joined.count(item) == 1


def test_breadcrumb_prefix_added_for_continuation_chunks() -> None:
    splitter, _ = make_splitter(chunk_size=20, breadcrumbs=True)
    doc = (
        "# Title\n\n"
        "## Section\n\n"
        "First paragraph with enough words to fill the token budget completely\n\n"
        "Second paragraph continuing the same section with more words here"
    )

    chunks = splitter.split_text(doc)

    assert len(chunks) == 2
    # first chunk contains the headings verbatim, so no breadcrumb duplication
    assert not chunks[0].startswith("Title")
    assert chunks[0].startswith("# Title")
    # continuation chunk carries the heading path
    assert chunks[1].startswith("Title > Section\n\n")


def test_breadcrumbs_disabled() -> None:
    splitter, _ = make_splitter(chunk_size=20, breadcrumbs=False)
    doc = (
        "# Title\n\n"
        "## Section\n\n"
        "First paragraph with enough words to fill the token budget completely\n\n"
        "Second paragraph continuing the same section with more words here"
    )

    chunks = splitter.split_text(doc)

    assert len(chunks) == 2
    assert not chunks[1].startswith("Title")


def test_plain_text_packs_paragraphs() -> None:
    splitter, _ = make_splitter(chunk_size=50)
    doc = "Just a plain paragraph.\n\nAnother plain paragraph without any markdown."

    chunks = splitter.split_text(doc)

    assert chunks == [doc]


def test_blank_input_returns_empty() -> None:
    splitter, _ = make_splitter(chunk_size=50)
    assert splitter.split_text("   \n  ") == []


@pytest.mark.asyncio
async def test_run_returns_contiguous_indices() -> None:
    splitter, _ = make_splitter(chunk_size=10)
    doc = "# A\n\nSome words here for one\n\n# B\n\nMore words there for two"

    result = await splitter.run(doc)

    indexes = [tc.index for tc in result.chunks]
    assert indexes == list(range(len(result.chunks)))
    assert len(result.chunks) >= 2


def test_no_chunk_ever_exceeds_token_budget() -> None:
    # heading + paragraph together exceed the budget but neither may be
    # dropped nor the heading left dangling: packing overruns, and the final
    # token-budget pass must split the chunk back under the hard limit
    splitter, _ = make_splitter(chunk_size=12)
    doc = "# A heading with quite many words in it\n\nBody paragraph with several more words here"

    chunks = splitter.split_text(doc)

    assert len(chunks) > 1
    for chunk in chunks:
        assert splitter.inner.count_tokens(chunk) <= 12


def test_char_cap_enforcement_applied() -> None:
    splitter, stub = make_splitter(chunk_size=50)
    splitter.split_text("A short paragraph.")
    assert len(stub.enforce_calls) == 1


def test_oversized_prose_delegates_to_inner_and_keeps_heading_on_first_piece() -> None:
    splitter, _ = make_splitter(chunk_size=25)
    doc = "# Head\n\n" + " ".join(f"w{i}" for i in range(90))

    chunks = splitter.split_text(doc)

    assert len(chunks) > 1
    assert chunks[0].startswith("# Head")
    assert "w0" in chunks[0] and "w89" in chunks[-1]
    for chunk in chunks:
        assert splitter.inner.count_tokens(chunk) <= 25


def test_fence_kept_intact() -> None:
    splitter, _ = make_splitter(chunk_size=40)
    fence = "```python\nprint('hello')\nprint('world')\n```"
    doc = f"# Code\n\nSome intro text.\n\n{fence}"

    chunks = splitter.split_text(doc)

    assert len(chunks) == 1
    assert fence in chunks[0]


def _markdown_mode_config() -> MagicMock:
    mock_config = MagicMock()
    mock_config.text_splitter = "MARKDOWN"
    mock_config.embedding_model_provider = "SBERT"
    mock_config.embedding_model_name = "all-mpnet-base-v2"
    mock_config.semchunk_tokenizer_provider = "TIKTOKEN"
    mock_config.semchunk_tokenizer_model_name = None
    mock_config.chunk_size = 300
    mock_config.chunk_overlap = 30
    mock_config.markdown_splitter_breadcrumbs = True
    mock_config.app_base = "/app/knowledge"
    return mock_config


@patch("app.services.text_splitter_factory.MarkdownStructureSplitter")
@patch("app.services.text_splitter_factory.SemchunkTextSplitterAdapter")
@patch("app.services.text_splitter_factory.Config")
def test_factory_markdown_wraps_semchunk_adapter_for_markdown_text(
    mock_config_cls: MagicMock, mock_adapter_cls: MagicMock, mock_markdown_cls: MagicMock
) -> None:
    inner = MagicMock()
    mock_adapter_cls.return_value = inner
    mock_config_cls.return_value = _markdown_mode_config()

    result = TextSplitterFactory.get_text_splitter(text_is_markdown=True)

    mock_markdown_cls.assert_called_once_with(inner=inner, chunk_size=300, breadcrumbs=True)
    assert result is mock_markdown_cls.return_value


@patch("app.services.text_splitter_factory.MarkdownStructureSplitter")
@patch("app.services.text_splitter_factory.SemchunkTextSplitterAdapter")
@patch("app.services.text_splitter_factory.Config")
def test_factory_markdown_falls_back_to_semchunk_for_plain_text(
    mock_config_cls: MagicMock, mock_adapter_cls: MagicMock, mock_markdown_cls: MagicMock
) -> None:
    adapter = MagicMock()
    mock_adapter_cls.return_value = adapter
    mock_config_cls.return_value = _markdown_mode_config()

    result = TextSplitterFactory.get_text_splitter(text_is_markdown=False)

    mock_markdown_cls.assert_not_called()
    assert result is adapter


@patch("app.services.text_splitter_factory.MarkdownStructureSplitter")
@patch("app.services.text_splitter_factory.SemchunkTextSplitterAdapter")
@patch("app.services.text_splitter_factory.Config")
def test_factory_markdown_defaults_to_plain_text_fallback(
    mock_config_cls: MagicMock, mock_adapter_cls: MagicMock, mock_markdown_cls: MagicMock
) -> None:
    adapter = MagicMock()
    mock_adapter_cls.return_value = adapter
    mock_config_cls.return_value = _markdown_mode_config()

    result = TextSplitterFactory.get_text_splitter()

    mock_markdown_cls.assert_not_called()
    assert result is adapter
