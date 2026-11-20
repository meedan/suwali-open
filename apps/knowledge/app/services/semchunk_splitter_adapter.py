from collections.abc import Iterator
from typing import Any, Literal, cast

import semchunk
import tiktoken
from neo4j_graphrag.components.text_splitters.base import TextSplitter
from neo4j_graphrag.components.types import TextChunk

_MIN_RESPLIT_TOKENS = 16
_RESPLIT_CHAR_MARGIN = 0.9


def _hard_split_at_whitespace(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    if max_chars < 1:
        raise ValueError("max_chars must be positive")

    chunks: list[str] = []
    remaining = text
    while remaining:
        if len(remaining) <= max_chars:
            chunks.append(remaining)
            break
        window = remaining[:max_chars]
        split_at = window.rfind(" ")
        if split_at <= 0:
            piece = remaining[:max_chars]
            remaining = remaining[max_chars:]
        else:
            piece = remaining[:split_at]
            remaining = remaining[split_at:].lstrip()
        if piece:
            chunks.append(piece)
    return chunks


def _load_hf_tokenizer_from_cache_dir(model_name: str, cache_dir: str) -> Any:
    from transformers import AutoTokenizer

    try:
        return AutoTokenizer.from_pretrained(  # type: ignore[no-untyped-call]  # nosec B615
            model_name,
            cache_dir=cache_dir,
            local_files_only=True,
            trust_remote_code=False,
        )
    except Exception:
        return AutoTokenizer.from_pretrained(  # type: ignore[no-untyped-call]  # nosec B615
            model_name,
            cache_dir=cache_dir,
            trust_remote_code=False,
        )


class SemchunkTextSplitterAdapter(TextSplitter):
    def __init__(
        self,
        chunk_size: int,
        chunk_overlap: float,
        tokenizer_provider: Literal["TIKTOKEN", "HUGGINGFACE"],
        model_name: str,
        hf_cache_dir: str | None = None,
        max_chunk_chars: int | None = None,
    ) -> None:
        """Initialize the semchunk text splitter adapter.

        args:
            chunk_size: maximum number of tokens per chunk
            chunk_overlap: number of tokens to overlap between chunks: ratio (if < 1) or an absolute number of tokens (if >= 1)
            tokenizer_provider: tokenizer provider - TIKTOKEN for OpenAI models, HUGGINGFACE for HuggingFace models
            model_name: model name, corresponding to tokenizer_provider
            hf_cache_dir: when using HUGGINGFACE, load the tokenizer from this cache first (same dir as init_models / SBERT); falls back to network if missing
            max_chunk_chars: when set, re-split or hard-split chunks that exceed this character length (e.g. Cohere embed cap)
        """
        if tokenizer_provider not in ("TIKTOKEN", "HUGGINGFACE"):
            raise ValueError(f"tokenizer_provider must be TIKTOKEN or HUGGINGFACE, got {tokenizer_provider!r}")

        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.tokenizer_provider = tokenizer_provider
        self.model_name = model_name
        self.hf_cache_dir = hf_cache_dir
        self.max_chunk_chars = max_chunk_chars
        self._hf_tokenizer: Any | None = None
        self._chunkers_by_size: dict[int, Any] = {}

        if tokenizer_provider == "TIKTOKEN":
            try:
                tiktoken.encoding_for_model(model_name)
            except KeyError as e:
                raise ValueError(
                    f"Model '{model_name}' is not recognized by tiktoken. Please use a valid OpenAI model name."
                ) from e

        self.chunker = self._make_chunker(chunk_size)

    def _make_chunker(self, chunk_size: int, memoize: bool = True) -> Any:
        if self.tokenizer_provider == "TIKTOKEN":
            return semchunk.semchunk.chunkerify(self.model_name, chunk_size=chunk_size, memoize=memoize)
        if self.hf_cache_dir is not None:
            if self._hf_tokenizer is None:
                self._hf_tokenizer = _load_hf_tokenizer_from_cache_dir(self.model_name, self.hf_cache_dir)
            return semchunk.semchunk.chunkerify(self._hf_tokenizer, chunk_size=chunk_size, memoize=memoize)
        return semchunk.semchunk.chunkerify(self.model_name, chunk_size=chunk_size, memoize=memoize)

    def _semchunk_split(self, text: str, chunk_size: int, overlap: float | None) -> list[str]:
        if chunk_size == self.chunk_size:
            chunker = self.chunker
        else:
            chunker = self._chunkers_by_size.get(chunk_size)
            if chunker is None:
                # memoize=False: re-split chunkers are short-lived and would otherwise
                # register unbounded entries in semchunk's global token-counter cache
                chunker = self._make_chunker(chunk_size, memoize=False)
                self._chunkers_by_size[chunk_size] = chunker
        result = chunker(text, overlap=overlap)
        return cast(list[str], result)

    def _fit_chunk_char_limit(self, chunk: str, token_chunk_size: int) -> list[str]:
        if self.max_chunk_chars is None or len(chunk) <= self.max_chunk_chars:
            return [chunk]

        reduced_tokens = max(
            _MIN_RESPLIT_TOKENS,
            int(token_chunk_size * self.max_chunk_chars / len(chunk) * _RESPLIT_CHAR_MARGIN),
        )
        if reduced_tokens >= token_chunk_size:
            reduced_tokens = max(_MIN_RESPLIT_TOKENS, token_chunk_size - 1)

        sub_chunks = self._semchunk_split(chunk, reduced_tokens, overlap=None)
        out: list[str] = []
        for sub in sub_chunks:
            if len(sub) <= self.max_chunk_chars:
                out.append(sub)
            elif reduced_tokens <= _MIN_RESPLIT_TOKENS:
                out.extend(_hard_split_at_whitespace(sub, self.max_chunk_chars))
            else:
                out.extend(self._fit_chunk_char_limit(sub, reduced_tokens))
        return out

    def _enforce_max_chunk_chars(self, chunks: list[str]) -> list[str]:
        if self.max_chunk_chars is None:
            return chunks
        out: list[str] = []
        for chunk in chunks:
            out.extend(self._fit_chunk_char_limit(chunk, self.chunk_size))
        return out

    def count_tokens(self, text: str) -> int:
        # semchunk's Chunker exposes the token counter it was built with,
        # so counts here match the splitting budget exactly
        return cast(int, self.chunker.token_counter(text))

    def split_prose(self, text: str, chunk_size: int | None = None) -> list[str]:
        """Split a single oversized prose block without overlap; used by structure-aware wrappers."""
        if not text.strip():
            return []
        return self._semchunk_split(text, chunk_size or self.chunk_size, overlap=None)

    def enforce_max_chunk_chars(self, chunks: list[str]) -> list[str]:
        return self._enforce_max_chunk_chars(chunks)

    def split_text(self, text: str) -> list[str]:
        if not text.strip():
            return []

        overlap = self.chunk_overlap if self.chunk_overlap > 0 else None
        chunks = self._semchunk_split(text, self.chunk_size, overlap=overlap)
        return self._enforce_max_chunk_chars(chunks)

    def iter_chunks(self, text: str) -> Iterator[TextChunk]:
        for idx, chunk in enumerate(self.split_text(text)):
            yield TextChunk(text=chunk, index=idx)
