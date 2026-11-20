"""Layout-aware PDF text extraction.

pdfminer's extract_text() runs full layout analysis and then flattens it, which splices
photo captions into body prose (a caption asserting a location reads as a fact about the
document subject) and interleaves Wikipedia-style infobox rows with the paragraphs next
to them. This module keeps the geometry and uses it:

- main text keeps pdfminer's text-box order, so multi-column pages read like extract_text
- stray single-word boxes (link-styled words) are re-inlined into the box that contains them
- sidebar/infobox lines (right of the page midline, font differing from the document body
  font) are fenced in a [sidebar]...[/sidebar] block with key/value rows re-paired
- photo captions (image-adjacent lines in a smaller font, or blocks carrying a photo
  credit) are prefixed with [photo caption]
- page furniture (bare page numbers, lines repeating across pages) is dropped

The [photo caption]/[sidebar] markers use plain brackets on purpose: they must not read
as part of the <DOCUMENT ...> markup the retrievers build around chunk text.
"""

from __future__ import annotations

import re
import statistics
from collections import Counter
from dataclasses import dataclass

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTChar, LTFigure, LTImage, LTItem, LTTextContainer, LTTextLine

# sidebar lines start right of this fraction of the page width
SIDEBAR_X_FRACTION = 0.5
# and their font differs from the document body font by more than this (points)
SIDEBAR_FONT_DELTA = 0.5
# bbox distance within which text counts as adjacent to an image (points)
CAPTION_IMAGE_MARGIN = 60.0
# caption font must sit at least this far below the document body font (points)
CAPTION_FONT_DELTA = 1.0
# photo credits mark a caption regardless of font size
CREDIT_RE = re.compile(r"^(photo(graph)?s?\s+(by|:)|©|\(c\)\s)", re.IGNORECASE)
# a vertical gap larger than this factor of the row height starts a new paragraph
PARAGRAPH_GAP_FACTOR = 0.9
# fragments need this much vertical overlap (fraction of the smaller height) to share a row
BASELINE_OVERLAP_FACTOR = 0.5
# a merged row may not span more than this factor of its tallest fragment, so
# near-overlapping staircase lines cannot chain-merge into one garbled row
ROW_MAX_SPAN_FACTOR = 1.5
# a line repeated on this many pages (or the page fraction below) is a running header/footer
FURNITURE_MIN_PAGES = 3
FURNITURE_PAGE_FRACTION = 0.4
# bare numbers count as page numbers only inside this band at the page top/bottom;
# elsewhere a standalone number is table/stat content that must survive extraction
PAGE_NUMBER_RE = re.compile(r"^\d{1,3}$")
PAGE_NUMBER_MARGIN = 50.0
# horizontal gap between same-row fragments rendered as a wide separator
COLUMN_GAP = 12.0
# a box this small is a stray fragment candidate for re-inlining
STRAY_MAX_CHARS = 30
# pages with more line fragments than this skip the quadratic geometry passes and
# fall back to plain box-order text, bounding CPU on degenerate or crafted PDFs
MAX_PAGE_LINES = 5000

CAPTION_TAG = "[photo caption]"
SIDEBAR_OPEN = "[sidebar]"
SIDEBAR_CLOSE = "[/sidebar]"


@dataclass
class _Line:
    text: str
    x0: float
    x1: float
    y0: float
    y1: float
    font: float

    @property
    def height(self) -> float:
        return self.y1 - self.y0


@dataclass
class _BBox:
    x0: float
    x1: float
    y0: float
    y1: float


@dataclass
class _PageLayout:
    number: int
    width: float
    height: float
    # one entry per pdfminer text box, in the box order extract_text would use
    blocks: list[list[_Line]]
    images: list[_BBox]


def _line_from(element: LTTextLine) -> _Line | None:
    text = element.get_text().strip()
    if not text:
        return None
    sizes = [round(ch.size, 1) for ch in element if isinstance(ch, LTChar)]
    font = statistics.median(sizes) if sizes else 0.0
    return _Line(text, element.x0, element.x1, element.y0, element.y1, font)


def _collect_lines(element: LTTextContainer[LTItem], out: list[_Line]) -> None:
    for child in element:
        if isinstance(child, LTTextLine):
            line = _line_from(child)
            if line is not None:
                out.append(line)
        elif isinstance(child, LTTextContainer):
            _collect_lines(child, out)


def _collect_images(element: LTFigure | LTImage, out: list[_BBox]) -> None:
    if isinstance(element, LTImage):
        out.append(_BBox(element.x0, element.x1, element.y0, element.y1))
        return
    had = len(out)
    for child in element:
        if isinstance(child, (LTFigure, LTImage)):
            _collect_images(child, out)
    # vector-only figures still anchor captions, so fall back to the figure bbox
    if len(out) == had and element.width > 20 and element.height > 20:
        out.append(_BBox(element.x0, element.x1, element.y0, element.y1))


def _load_pages(path: str) -> list[_PageLayout]:
    pages: list[_PageLayout] = []
    for number, lt_page in enumerate(extract_pages(path), start=1):
        blocks: list[list[_Line]] = []
        images: list[_BBox] = []
        for element in lt_page:
            if isinstance(element, LTTextContainer):
                lines: list[_Line] = []
                _collect_lines(element, lines)
                if lines:
                    blocks.append(lines)
            elif isinstance(element, (LTFigure, LTImage)):
                _collect_images(element, images)
        pages.append(_PageLayout(number, lt_page.width, lt_page.height, blocks, images))
    return pages


def _document_font(pages: list[_PageLayout]) -> float:
    """Dominant font size across the document, weighted by character count."""
    weights: Counter[float] = Counter()
    for page in pages:
        for block in page.blocks:
            for line in block:
                weights[line.font] += len(line.text)
    return weights.most_common(1)[0][0] if weights else 0.0


def _furniture_texts(pages: list[_PageLayout]) -> set[str]:
    """Normalized lines recurring across pages: running headers and footers."""
    seen: Counter[str] = Counter()
    for page in pages:
        page_texts = {re.sub(r"\s+", " ", line.text).casefold() for block in page.blocks for line in block}
        for text in page_texts:
            seen[text] += 1
    threshold = max(FURNITURE_MIN_PAGES, FURNITURE_PAGE_FRACTION * len(pages))
    return {text for text, count in seen.items() if count >= threshold}


def _is_furniture(line: _Line, furniture: set[str], page_height: float) -> bool:
    in_margin_band = line.y1 < PAGE_NUMBER_MARGIN or line.y0 > page_height - PAGE_NUMBER_MARGIN
    if in_margin_band and PAGE_NUMBER_RE.fullmatch(line.text):
        return True
    return re.sub(r"\s+", " ", line.text).casefold() in furniture


def _near(a: _BBox, b: _BBox, margin: float) -> bool:
    return a.x0 < b.x1 + margin and a.x1 > b.x0 - margin and a.y0 < b.y1 + margin and a.y1 > b.y0 - margin


def _line_bbox(lines: list[_Line]) -> _BBox:
    return _BBox(
        min(line.x0 for line in lines),
        max(line.x1 for line in lines),
        min(line.y0 for line in lines),
        max(line.y1 for line in lines),
    )


def _is_caption_line(line: _Line, images: list[_BBox], doc_font: float) -> bool:
    """Line-level caption test, applied before assembling the main flow: a caption
    column beside body text shares baselines with it and would otherwise interleave."""
    near = any(_near(_line_bbox([line]), image, CAPTION_IMAGE_MARGIN) for image in images)
    return near and (line.font <= doc_font - CAPTION_FONT_DELTA or bool(CREDIT_RE.match(line.text)))


def _is_caption_paragraph(paragraph: list[list[_Line]], images: list[_BBox]) -> bool:
    """Paragraph-level backstop for captions set in the body font: they are only
    recognizable once their photo credit line merges into the paragraph."""
    # a lone credit/copyright row near an image is not a caption block; requiring
    # caption text above the credit keeps image-adjacent (c) footers untagged
    if len(paragraph) < 2:
        return False
    lines = [line for row in paragraph for line in row]
    if not any(CREDIT_RE.match(line.text) for line in lines):
        return False
    return any(_near(_line_bbox(lines), image, CAPTION_IMAGE_MARGIN) for image in images)


def _rows(lines: list[_Line]) -> list[list[_Line]]:
    """Rows of fragments sharing a baseline, top to bottom then left to right.
    Re-pairs infobox keys with values and re-inlines stray link-styled words."""
    rows: list[list[_Line]] = []
    for line in sorted(lines, key=lambda ln: (-ln.y1, ln.x0)):
        for row in rows:
            anchor = row[-1]
            overlap = min(anchor.y1, line.y1) - max(anchor.y0, line.y0)
            if overlap <= BASELINE_OVERLAP_FACTOR * min(anchor.height, line.height):
                continue
            # cap the merged row's vertical span: consecutive staircase lines each
            # overlap their neighbour, but chaining them would garble word order
            span = max(line.y1, max(ln.y1 for ln in row)) - min(line.y0, min(ln.y0 for ln in row))
            if span > ROW_MAX_SPAN_FACTOR * max(anchor.height, line.height):
                continue
            row.append(line)
            break
        else:
            rows.append([line])
    for row in rows:
        row.sort(key=lambda ln: ln.x0)
    return rows


def _row_text(row: list[_Line]) -> str:
    parts = [re.sub(r"\s+", " ", row[0].text)]
    for prev, line in zip(row, row[1:]):
        parts.append("  " if line.x0 - prev.x1 > COLUMN_GAP else " ")
        parts.append(re.sub(r"\s+", " ", line.text))
    return "".join(parts).strip()


def _paragraphs(rows: list[list[_Line]]) -> list[list[list[_Line]]]:
    """Group consecutive rows into paragraphs. A new paragraph starts on a wide
    vertical gap or when the flow jumps back up the page (a new column or table cell)."""
    grouped: list[list[list[_Line]]] = []
    for row in rows:
        if grouped:
            prev = grouped[-1][-1]
            gap = min(line.y0 for line in prev) - max(line.y1 for line in row)
            # the taller neighbour sets the scale so a small credit line under a
            # caption joins it instead of becoming its own paragraph
            height = max(min(line.height for line in prev), min(line.height for line in row))
            if -2.0 <= gap <= PARAGRAPH_GAP_FACTOR * height:
                grouped[-1].append(row)
                continue
        grouped.append([row])
    return grouped


def _paragraph_text(paragraph: list[list[_Line]]) -> str:
    texts = [_row_text(row) for row in paragraph]
    joined: list[str] = []
    for text in texts:
        # keep the hyphen when joining wrapped rows: "co-" + "produced" -> "co-produced"
        if joined and joined[-1].endswith("-") and text[:1].islower():
            joined[-1] = joined[-1] + text
        else:
            joined.append(text)
    return "\n".join(joined)


def _contains(outer: _BBox, inner: _BBox, tolerance: float = 2.0) -> bool:
    return (
        outer.x0 - tolerance <= inner.x0
        and inner.x1 <= outer.x1 + tolerance
        and outer.y0 - tolerance <= inner.y0
        and inner.y1 <= outer.y1 + tolerance
    )


def _adopt_stray_blocks(blocks: list[list[_Line]]) -> list[list[_Line]]:
    """Merge tiny boxes (link-styled words split out by layout analysis) into the
    box whose bbox contains them, so baseline reflow can slot them back in place.
    The input lists are not modified."""
    if len(blocks) < 2:
        return blocks
    bboxes = [_line_bbox(block) for block in blocks]
    adopted: set[int] = set()
    extras: dict[int, list[_Line]] = {}
    for i, block in enumerate(blocks):
        if len(block) > 1 or sum(len(line.text) for line in block) > STRAY_MAX_CHARS:
            continue
        for j, bbox in enumerate(bboxes):
            if i != j and j not in adopted and _contains(bbox, bboxes[i]):
                extras.setdefault(j, []).extend(block)
                adopted.add(i)
                break
    return [block + extras.get(i, []) for i, block in enumerate(blocks) if i not in adopted]


def _render_page(page: _PageLayout, doc_font: float, furniture: set[str]) -> list[str]:
    kept_blocks = [[line for line in block if not _is_furniture(line, furniture, page.height)] for block in page.blocks]
    kept_blocks = [block for block in kept_blocks if block]

    # degenerate or crafted pages skip the quadratic geometry passes entirely
    if sum(len(block) for block in kept_blocks) > MAX_PAGE_LINES:
        return ["\n".join(line.text for line in block) for block in kept_blocks]

    midline = SIDEBAR_X_FRACTION * page.width
    sidebar: list[_Line] = []
    captions: list[_Line] = []
    main_blocks: list[list[_Line]] = []
    for block in kept_blocks:
        remaining: list[_Line] = []
        for line in block:
            # sidebar deliberately wins over caption on the right half: wikipedia
            # infobox rows sit within the caption margin of the cover image and
            # must stay [sidebar]; a right-side caption is mislabeled but still fenced
            if line.x0 > midline and abs(line.font - doc_font) > SIDEBAR_FONT_DELTA:
                sidebar.append(line)
            elif _is_caption_line(line, page.images, doc_font):
                captions.append(line)
            else:
                remaining.append(line)
        if remaining:
            main_blocks.append(remaining)

    output: list[str] = []
    main_rows = [row for block in _adopt_stray_blocks(main_blocks) for row in _rows(block)]
    for paragraph in _paragraphs(main_rows):
        text = _paragraph_text(paragraph)
        if _is_caption_paragraph(paragraph, page.images):
            output.append(f"{CAPTION_TAG} {text}")
        else:
            output.append(text)
    for paragraph in _paragraphs(_rows(captions)):
        output.append(f"{CAPTION_TAG} {_paragraph_text(paragraph)}")
    if sidebar:
        block_text = "\n\n".join(_paragraph_text(p) for p in _paragraphs(_rows(sidebar)))
        output.append(f"{SIDEBAR_OPEN}\n{block_text}\n{SIDEBAR_CLOSE}")
    return output


def extract_layout_text(path: str) -> str:
    """Extract plain text from a PDF, preserving layout semantics as inline tags.

    Raises pdfminer's PDFEncryptionError for password-protected files, like
    pdfminer.high_level.extract_text does.
    """
    pages = _load_pages(path)
    doc_font = _document_font(pages)
    furniture = _furniture_texts(pages)
    output: list[str] = []
    for page in pages:
        output.extend(_render_page(page, doc_font, furniture))
    return "\n\n".join(output)
