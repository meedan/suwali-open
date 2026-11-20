from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Literal

from markdown_it import MarkdownIt
from markdown_it.token import Token
from neo4j_graphrag.components.text_splitters.base import TextSplitter
from neo4j_graphrag.components.types import TextChunk

from app.services.semchunk_splitter_adapter import SemchunkTextSplitterAdapter

_BlockKind = Literal["heading", "paragraph", "table", "fence", "list_item", "other"]


@dataclass
class _Block:
    kind: _BlockKind
    text: str
    # heading path in effect before this block (for headings: ancestors only)
    heading_path: tuple[str, ...] = field(default_factory=tuple)
    # block must stay in the same chunk as the block that follows it
    glue_to_next: bool = False
    first_list_item: bool = False


class MarkdownStructureSplitter(TextSplitter):
    """Structure-aware Markdown splitter.

    Parses text into structural blocks (headings, paragraphs, tables, fenced code,
    list items) and greedily packs them into token-budgeted chunks so that headings
    stay with their bodies, tables and fences are never cut mid-block, and lists
    split only between items. Oversized tables are split by rows with the header
    row repeated; other oversized blocks fall back to the inner semchunk adapter.

    This splitter produces no inter-chunk overlap: heading breadcrumbs carry the
    document context into each chunk instead.
    """

    def __init__(
        self,
        inner: SemchunkTextSplitterAdapter,
        chunk_size: int,
        breadcrumbs: bool = True,
    ) -> None:
        self.inner = inner
        self.chunk_size = chunk_size
        self.breadcrumbs = breadcrumbs
        self._md = MarkdownIt("commonmark").enable("table")

    def iter_chunks(self, text: str) -> Iterator[TextChunk]:
        for idx, chunk in enumerate(self.split_text(text)):
            yield TextChunk(text=chunk, index=idx)

    def split_text(self, text: str) -> list[str]:
        if not text.strip():
            return []
        blocks = self._parse_blocks(text)
        if not blocks:
            return []
        chunks = self._pack(blocks)
        chunks = self._enforce_token_budget(chunks)
        return self.inner.enforce_max_chunk_chars(chunks)

    def _parse_blocks(self, text: str) -> list[_Block]:
        lines = text.split("\n")
        tokens = self._md.parse(text)

        blocks: list[_Block] = []
        heading_stack: list[tuple[int, str]] = []

        def slice_lines(token: Token) -> str:
            if token.map is None:
                return token.content
            start, end = token.map
            return "\n".join(lines[start:end]).rstrip()

        def find_close(open_idx: int) -> int:
            open_tok = tokens[open_idx]
            close_type = open_tok.type.replace("_open", "_close")
            for j in range(open_idx + 1, len(tokens)):
                if tokens[j].type == close_type and tokens[j].level == open_tok.level:
                    return j
            return len(tokens) - 1

        i = 0
        while i < len(tokens):
            tok = tokens[i]
            if tok.type == "heading_open":
                close_idx = find_close(i)
                level = int(tok.tag[1])
                title = tokens[i + 1].content if tokens[i + 1].type == "inline" else slice_lines(tok)
                while heading_stack and heading_stack[-1][0] >= level:
                    heading_stack.pop()
                blocks.append(
                    _Block(
                        kind="heading",
                        text=slice_lines(tok),
                        heading_path=tuple(t for _, t in heading_stack),
                        glue_to_next=True,
                    )
                )
                heading_stack.append((level, title))
                i = close_idx + 1
            elif tok.type in ("bullet_list_open", "ordered_list_open"):
                close_idx = find_close(i)
                path = tuple(t for _, t in heading_stack)
                j = i + 1
                first = True
                while j < close_idx:
                    item = tokens[j]
                    if item.type == "list_item_open" and item.level == tok.level + 1:
                        item_close = find_close(j)
                        blocks.append(
                            _Block(
                                kind="list_item",
                                text=slice_lines(item),
                                heading_path=path,
                                first_list_item=first,
                            )
                        )
                        first = False
                        j = item_close + 1
                    else:
                        j += 1
                i = close_idx + 1
            elif tok.type == "table_open":
                close_idx = find_close(i)
                blocks.append(
                    _Block(kind="table", text=slice_lines(tok), heading_path=tuple(t for _, t in heading_stack))
                )
                i = close_idx + 1
            elif tok.type in ("fence", "code_block"):
                blocks.append(
                    _Block(kind="fence", text=slice_lines(tok), heading_path=tuple(t for _, t in heading_stack))
                )
                i += 1
            elif tok.type.endswith("_open"):
                close_idx = find_close(i)
                kind: _BlockKind = "paragraph" if tok.type == "paragraph_open" else "other"
                blocks.append(_Block(kind=kind, text=slice_lines(tok), heading_path=tuple(t for _, t in heading_stack)))
                i = close_idx + 1
            elif tok.map is not None:
                # standalone block tokens: html_block, hr, ...
                blocks.append(
                    _Block(kind="other", text=slice_lines(tok), heading_path=tuple(t for _, t in heading_stack))
                )
                i += 1
            else:
                i += 1

        blocks = [b for b in blocks if b.text.strip()]

        # an intro paragraph immediately preceding a list stays with the first item
        for idx in range(len(blocks) - 1):
            if (
                blocks[idx].kind == "paragraph"
                and blocks[idx + 1].kind == "list_item"
                and blocks[idx + 1].first_list_item
            ):
                blocks[idx].glue_to_next = True

        return blocks

    def _breadcrumb(self, block: _Block) -> str | None:
        if not self.breadcrumbs or not block.heading_path:
            return None
        return " > ".join(block.heading_path)

    def _render(self, blocks: list[_Block]) -> str:
        parts: list[str] = []
        for idx, block in enumerate(blocks):
            if idx > 0:
                # consecutive list items keep tight-list formatting
                tight = block.kind == "list_item" and blocks[idx - 1].kind == "list_item"
                parts.append("\n" if tight else "\n\n")
            parts.append(block.text)
        body = "".join(parts)
        prefix = self._breadcrumb(blocks[0])
        return f"{prefix}\n\n{body}" if prefix else body

    def _chunk_tokens(self, blocks: list[_Block]) -> int:
        return self.inner.count_tokens(self._render(blocks))

    def _split_trailing_glue(self, blocks: list[_Block]) -> tuple[list[_Block], list[_Block]]:
        split_at = len(blocks)
        while split_at > 0 and blocks[split_at - 1].glue_to_next:
            split_at -= 1
        return blocks[:split_at], blocks[split_at:]

    def _split_table_by_rows(self, table_text: str) -> list[str]:
        table_lines = [line for line in table_text.splitlines() if line.strip()]
        header = table_lines[:2]
        rows = table_lines[2:]
        if not rows:
            return ["\n".join(header)]

        header_tokens = self.inner.count_tokens("\n".join(header))
        groups: list[str] = []
        current_rows: list[str] = []
        current_tokens = header_tokens
        for row in rows:
            row_tokens = self.inner.count_tokens(row)
            if current_rows and current_tokens + row_tokens > self.chunk_size:
                groups.append("\n".join(header + current_rows))
                current_rows = []
                current_tokens = header_tokens
            current_rows.append(row)
            current_tokens += row_tokens
        if current_rows:
            groups.append("\n".join(header + current_rows))
        return groups

    def _split_oversized_block(self, block: _Block) -> list[str]:
        if block.kind == "table":
            return self._split_table_by_rows(block.text)
        return self.inner.split_prose(block.text, self.chunk_size)

    def _pack(self, blocks: list[_Block]) -> list[str]:
        chunks: list[str] = []
        current: list[_Block] = []

        for block in blocks:
            block_tokens = self.inner.count_tokens(block.text)

            if block_tokens > self.chunk_size:
                kept, carry = self._split_trailing_glue(current)
                if kept:
                    chunks.append(self._render(kept))
                pieces = self._split_oversized_block(block)
                first_piece_blocks = carry + [_Block(kind=block.kind, text=pieces[0], heading_path=block.heading_path)]
                chunks.append(self._render(first_piece_blocks))
                chunks.extend(
                    self._render([_Block(kind=block.kind, text=piece, heading_path=block.heading_path)])
                    for piece in pieces[1:]
                )
                current = []
                continue

            candidate = current + [block]
            if current and self._chunk_tokens(candidate) > self.chunk_size:
                kept, carry = self._split_trailing_glue(current)
                if kept:
                    chunks.append(self._render(kept))
                    current = carry + [block]
                else:
                    # chunk is all glue blocks (like a lone heading):
                    # the break is not allowed, so tolerate the soft-budget overrun while packing
                    # -> _enforce_token_budget re-splits any such chunk afterwards
                    current = candidate
            else:
                current = candidate

        if current:
            chunks.append(self._render(current))
        return chunks

    def _enforce_token_budget(self, chunks: list[str]) -> list[str]:
        """Failsafe for chunk size"""
        out: list[str] = []
        for chunk in chunks:
            if self.inner.count_tokens(chunk) <= self.chunk_size:
                out.append(chunk)
            else:
                out.extend(self.inner.split_prose(chunk, self.chunk_size))
        return out
