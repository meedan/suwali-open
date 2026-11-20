from collections.abc import Iterator
from itertools import chain

from neo4j_graphrag.components.text_splitters.base import TextSplitter
from neo4j_graphrag.components.types import TextChunk


class PrefixedTextSplitter(TextSplitter):
    """Splits a known prefix of the text and the rest of it with separate splitters.

    Keeps the prefix in chunks of its own, so its Markdown structure (e.g. headings,
    which become breadcrumbs) doesn't carry over into the chunks of the rest of the text.
    """

    def __init__(self, prefix: str, prefix_splitter: TextSplitter, splitter: TextSplitter) -> None:
        self.prefix = prefix
        self.prefix_splitter = prefix_splitter
        self.splitter = splitter

    def iter_chunks(self, text: str) -> Iterator[TextChunk]:
        if not text.startswith(self.prefix):
            yield from self.splitter.iter_chunks(text)
            return
        chunks = chain(
            self.prefix_splitter.iter_chunks(self.prefix),
            self.splitter.iter_chunks(text[len(self.prefix) :]),
        )
        for index, chunk in enumerate(chunks):
            yield TextChunk(text=chunk.text, index=index, metadata=chunk.metadata)
