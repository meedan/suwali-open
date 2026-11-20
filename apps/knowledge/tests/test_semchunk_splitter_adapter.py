from unittest.mock import MagicMock, patch

import pytest

from app.services.semchunk_splitter_adapter import SemchunkTextSplitterAdapter, _hard_split_at_whitespace


@patch("app.services.semchunk_splitter_adapter.semchunk.semchunk.chunkerify")
def test_split_text_returns_empty_when_blank(mock_chunkerify: MagicMock) -> None:
    chunker = MagicMock()
    mock_chunkerify.return_value = chunker

    splitter = SemchunkTextSplitterAdapter(
        chunk_size=50,
        chunk_overlap=5,
        tokenizer_provider="HUGGINGFACE",
        model_name="dummy-model",
    )

    assert splitter.split_text("   ") == []
    chunker.assert_not_called()  # blank input should skip chunking


@patch("app.services.semchunk_splitter_adapter.semchunk.semchunk.chunkerify")
def test_splitter_calls_chunkerify_with_model_and_chunk_size(
    mock_chunkerify: MagicMock,
) -> None:
    chunker = MagicMock()
    mock_chunkerify.return_value = chunker

    SemchunkTextSplitterAdapter(
        chunk_size=42,
        chunk_overlap=5,
        tokenizer_provider="HUGGINGFACE",
        model_name="dummy-model",
    )

    mock_chunkerify.assert_called_once_with("dummy-model", chunk_size=42, memoize=True)


@patch("app.services.semchunk_splitter_adapter.semchunk.semchunk.chunkerify")
def test_split_text_uses_none_overlap_when_nonpositive(mock_chunkerify: MagicMock) -> None:
    chunker = MagicMock(return_value=["a", "b"])
    mock_chunkerify.return_value = chunker

    splitter = SemchunkTextSplitterAdapter(
        chunk_size=10,
        chunk_overlap=0,
        tokenizer_provider="HUGGINGFACE",
        model_name="dummy-model",
    )

    out = splitter.split_text("A short paragraph with a few sentences.")
    assert out == ["a", "b"]
    chunker.assert_called_once_with("A short paragraph with a few sentences.", overlap=None)


@patch("app.services.semchunk_splitter_adapter.semchunk.semchunk.chunkerify")
def test_split_text_uses_configured_overlap(mock_chunkerify: MagicMock) -> None:
    chunker = MagicMock(return_value=["chunk"])
    mock_chunkerify.return_value = chunker

    splitter = SemchunkTextSplitterAdapter(
        chunk_size=10,
        chunk_overlap=3,
        tokenizer_provider="HUGGINGFACE",
        model_name="dummy-model",
    )

    out = splitter.split_text("Here is some text we want to split.")
    assert out == ["chunk"]
    chunker.assert_called_once_with("Here is some text we want to split.", overlap=3)


@patch("app.services.semchunk_splitter_adapter.semchunk.semchunk.chunkerify")
def test_split_text_coerces_negative_overlap_to_none(mock_chunkerify: MagicMock) -> None:
    chunker = MagicMock(return_value=["chunk"])
    mock_chunkerify.return_value = chunker

    splitter = SemchunkTextSplitterAdapter(
        chunk_size=10,
        chunk_overlap=-1,
        tokenizer_provider="HUGGINGFACE",
        model_name="dummy-model",
    )

    out = splitter.split_text("Negative overlap should be ignored.")
    assert out == ["chunk"]
    chunker.assert_called_once_with("Negative overlap should be ignored.", overlap=None)


@patch("app.services.semchunk_splitter_adapter.semchunk.semchunk.chunkerify")
def test_split_text_passes_fractional_overlap(mock_chunkerify: MagicMock) -> None:
    chunker = MagicMock(return_value=["chunk"])
    mock_chunkerify.return_value = chunker

    splitter = SemchunkTextSplitterAdapter(
        chunk_size=10,
        chunk_overlap=0.5,
        tokenizer_provider="HUGGINGFACE",
        model_name="dummy-model",
    )

    out = splitter.split_text("Fractional overlap should be forwarded.")
    assert out == ["chunk"]
    chunker.assert_called_once_with("Fractional overlap should be forwarded.", overlap=0.5)


@patch("app.services.semchunk_splitter_adapter.semchunk.semchunk.chunkerify")
@pytest.mark.asyncio
async def test_run_returns_indexed_textchunks(mock_chunkerify: MagicMock) -> None:
    mock_chunkerify.return_value = MagicMock(return_value=["first", "second"])

    splitter = SemchunkTextSplitterAdapter(
        chunk_size=20,
        chunk_overlap=2,
        tokenizer_provider="HUGGINGFACE",
        model_name="dummy-model",
    )

    long_text = "First sentence in a longer paragraph. Second sentence continues the thought. Third one wraps it up."
    result = await splitter.run(long_text)
    texts = [tc.text for tc in result.chunks]
    indexes = [tc.index for tc in result.chunks]
    assert texts == ["first", "second"]
    assert indexes == [0, 1]


def test_tiktoken_validation_raises_value_error() -> None:
    with patch("app.services.semchunk_splitter_adapter.tiktoken.encoding_for_model", side_effect=KeyError):
        with pytest.raises(ValueError):
            SemchunkTextSplitterAdapter(
                chunk_size=10,
                chunk_overlap=0,
                tokenizer_provider="TIKTOKEN",
                model_name="bad-model",
            )


@patch("app.services.semchunk_splitter_adapter.semchunk.semchunk.chunkerify")
@patch("app.services.semchunk_splitter_adapter._load_hf_tokenizer_from_cache_dir")
def test_huggingface_uses_cache_dir_and_passes_tokenizer_to_chunkerify(
    mock_load_tok: MagicMock, mock_chunkerify: MagicMock
) -> None:
    mock_tok = MagicMock()
    mock_tok.model_max_length = 512
    mock_load_tok.return_value = mock_tok
    mock_chunkerify.return_value = MagicMock()

    SemchunkTextSplitterAdapter(
        chunk_size=100,
        chunk_overlap=5,
        tokenizer_provider="HUGGINGFACE",
        model_name="dummy-model",
        hf_cache_dir="/cache/hf",
    )

    mock_load_tok.assert_called_once_with("dummy-model", "/cache/hf")
    mock_chunkerify.assert_called_once_with(mock_tok, chunk_size=100, memoize=True)


@patch("app.services.semchunk_splitter_adapter.semchunk.semchunk.chunkerify")
def test_tiktoken_validation_happy_path(mock_chunkerify: MagicMock) -> None:
    chunker = MagicMock(return_value=["ok"])
    mock_chunkerify.return_value = chunker

    with patch(
        "app.services.semchunk_splitter_adapter.tiktoken.encoding_for_model",
        return_value=MagicMock(),
    ):
        splitter = SemchunkTextSplitterAdapter(
            chunk_size=10,
            chunk_overlap=2,
            tokenizer_provider="TIKTOKEN",
            model_name="gpt-4o-mini",
        )

    # ensure chunker is still usable after tiktoken validation
    assert splitter.split_text("hello") == ["ok"]
    mock_chunkerify.assert_called_once_with("gpt-4o-mini", chunk_size=10, memoize=True)


def test_invalid_tokenizer_provider_raises_value_error() -> None:
    with pytest.raises(ValueError, match="tokenizer_provider must be TIKTOKEN or HUGGINGFACE"):
        SemchunkTextSplitterAdapter(
            chunk_size=10,
            chunk_overlap=0,
            tokenizer_provider="INVALID",  # type: ignore[arg-type]
            model_name="dummy-model",
        )


def test_hard_split_at_whitespace_respects_max_chars() -> None:
    text = "one two three four five six seven eight nine ten"
    chunks = _hard_split_at_whitespace(text, max_chars=15)
    assert all(len(c) <= 15 for c in chunks)
    assert "".join(chunks).replace(" ", "") == text.replace(" ", "")


@patch("app.services.semchunk_splitter_adapter.semchunk.semchunk.chunkerify")
def test_max_chunk_chars_splits_oversized_chunk(mock_chunkerify: MagicMock) -> None:
    oversized = "x" * 3000
    resplit_chunker = MagicMock(return_value=["a" * 100, "b" * 100])
    mock_chunkerify.side_effect = [MagicMock(return_value=[oversized]), resplit_chunker]

    splitter = SemchunkTextSplitterAdapter(
        chunk_size=500,
        chunk_overlap=100,
        tokenizer_provider="HUGGINGFACE",
        model_name="dummy-model",
        max_chunk_chars=2048,
    )

    chunks = splitter.split_text("some input")
    assert chunks == ["a" * 100, "b" * 100]
    resplit_chunker.assert_called_once_with(oversized, overlap=None)
    resplit_call = mock_chunkerify.call_args_list[1]
    assert resplit_call.kwargs["memoize"] is False


@patch("app.services.semchunk_splitter_adapter.semchunk.semchunk.chunkerify")
def test_max_chunk_chars_none_skips_enforcement(mock_chunkerify: MagicMock) -> None:
    oversized = "x" * 3000
    mock_chunkerify.return_value = MagicMock(return_value=[oversized])

    splitter = SemchunkTextSplitterAdapter(
        chunk_size=500,
        chunk_overlap=0,
        tokenizer_provider="HUGGINGFACE",
        model_name="dummy-model",
        max_chunk_chars=None,
    )

    assert splitter.split_text("input") == [oversized]
    mock_chunkerify.assert_called_once()


@patch("app.services.semchunk_splitter_adapter._hard_split_at_whitespace")
@patch("app.services.semchunk_splitter_adapter.semchunk.semchunk.chunkerify")
def test_max_chunk_chars_hard_splits_when_resplit_still_oversized(
    mock_chunkerify: MagicMock, mock_hard_split: MagicMock
) -> None:
    oversized = "y" * 3000
    still_oversized = "z" * 3000
    chunker_calls = 0

    def chunkerify_side_effect(*_args: object, **_kwargs: object) -> MagicMock:
        nonlocal chunker_calls
        chunker_calls += 1
        if chunker_calls == 1:
            return MagicMock(return_value=[oversized])
        return MagicMock(return_value=[still_oversized])  # every resplit pass stays oversized

    mock_chunkerify.side_effect = chunkerify_side_effect
    mock_hard_split.return_value = ["part1", "part2"]

    splitter = SemchunkTextSplitterAdapter(
        chunk_size=500,
        chunk_overlap=0,
        tokenizer_provider="HUGGINGFACE",
        model_name="dummy-model",
        max_chunk_chars=2048,
    )

    chunks = splitter.split_text("input")
    assert chunks == ["part1", "part2"]
    mock_hard_split.assert_called_once_with(still_oversized, 2048)
