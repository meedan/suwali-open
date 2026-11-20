from typing import cast

from app.services.markdown_splitter import MarkdownStructureSplitter
from app.services.prefixed_splitter import PrefixedTextSplitter
from app.services.semchunk_splitter_adapter import SemchunkTextSplitterAdapter
from tests.test_markdown_splitter import StubInner


def make_markdown_splitter() -> MarkdownStructureSplitter:
    return MarkdownStructureSplitter(inner=cast(SemchunkTextSplitterAdapter, StubInner()), chunk_size=200)


def test_headings_of_the_prefix_do_not_carry_over_into_the_rest_of_the_text() -> None:
    prefix = "Summary:\n\n## Caveats\n\nThe figures were revised.\n\n"
    splitter = PrefixedTextSplitter(prefix, make_markdown_splitter(), make_markdown_splitter())

    chunks = list(splitter.iter_chunks(f"{prefix}The report covers rainfall.\n\n# Results\n\nRainfall dropped."))

    assert [chunk.index for chunk in chunks] == [0, 1]
    assert "Caveats" in chunks[0].text
    assert "Caveats" not in chunks[1].text
    assert chunks[1].text.startswith("The report covers rainfall.")
