import re
from pathlib import Path

import pytest

from app.services.pdf_layout_extractor import (
    CAPTION_TAG,
    MAX_PAGE_LINES,
    SIDEBAR_CLOSE,
    SIDEBAR_OPEN,
    _BBox,
    _is_caption_line,
    _is_caption_paragraph,
    _is_furniture,
    _Line,
    _PageLayout,
    _paragraph_text,
    _render_page,
    _rows,
    extract_layout_text,
)

FIXTURE = Path(__file__).parent / "data" / "beast-over-hammersmith-wikipedia.pdf"


@pytest.fixture(scope="module")
def beast_text() -> str:
    return extract_layout_text(str(FIXTURE))


def _body_and_sidebar(text: str) -> tuple[str, str]:
    body, _, rest = text.partition(SIDEBAR_OPEN)
    sidebar, _, _ = rest.partition(SIDEBAR_CLOSE)
    return body, sidebar


def test_stray_link_word_is_reinserted(beast_text: str) -> None:
    # the link-styled "the" gets its own text box; extract_text left it dangling
    # after the paragraph, breaking the sentence it belongs to
    collapsed = re.sub(r"\s+", " ", beast_text)
    assert "Archives was the last one with an original illustration" in collapsed


def test_infobox_is_fenced_out_of_body(beast_text: str) -> None:
    # the chronology names neighbouring albums; loose in body prose it made the
    # LLM attribute this album's cover artist to them
    body, sidebar = _body_and_sidebar(beast_text)
    assert "cover illustration by longtime artist Derek Riggs" in re.sub(r"\s+", " ", body)
    assert "Iron Maiden chronology" in sidebar
    assert "Iron Maiden chronology" not in body


def test_infobox_keys_pair_with_values(beast_text: str) -> None:
    _, sidebar = _body_and_sidebar(beast_text)
    assert re.search(r"Venue\s+Hammersmith Odeon, London", sidebar)
    assert re.search(r"Genre\s+Heavy metal", sidebar)


def _line(
    text: str,
    x0: float = 0.0,
    x1: float = 100.0,
    y0: float = 0.0,
    y1: float = 10.0,
    font: float = 10.0,
) -> _Line:
    return _Line(text, x0, x1, y0, y1, font)


def test_rows_merge_same_baseline_fragments_left_to_right() -> None:
    lines = [
        _line("last one", x0=150.0, x1=250.0),
        _line("(BBC Archives was", x0=0.0, x1=120.0),
        _line("the", x0=126.0, x1=146.0),
    ]
    rows = _rows(lines)
    assert len(rows) == 1
    assert [ln.text for ln in rows[0]] == ["(BBC Archives was", "the", "last one"]


def test_rows_do_not_chain_merge_staircase_lines() -> None:
    # consecutive lines each overlap their neighbour by 60%, but merging the whole
    # diagonal into one x-sorted row would garble the word order
    stairs = [_line(f"w{i}", x0=i * 20.0, x1=i * 20.0 + 15.0, y0=100.0 - i * 4.0, y1=110.0 - i * 4.0) for i in range(8)]
    rows = _rows(stairs)
    assert len(rows) > 1


def test_paragraph_text_keeps_hyphen_on_wrapped_rows() -> None:
    paragraph = [[_line("specially co-", y0=20.0, y1=30.0)], [_line("produced by", y0=8.0, y1=18.0)]]
    assert _paragraph_text(paragraph) == "specially co-produced by"


def test_caption_line_needs_image_adjacency() -> None:
    image = _BBox(x0=110.0, x1=300.0, y0=0.0, y1=200.0)
    small_near = _line("Located in Salvador", font=6.7, y0=50.0, y1=60.0)
    assert _is_caption_line(small_near, [image], doc_font=10.0) is True
    # body-sized font next to an image is regular prose, not a caption
    body_near = _line("Regular paragraph text", font=10.0, y0=50.0, y1=60.0)
    assert _is_caption_line(body_near, [image], doc_font=10.0) is False
    # small font far from any image (footnotes) is not a caption either
    assert _is_caption_line(small_near, [], doc_font=10.0) is False


def test_caption_paragraph_backstop_via_photo_credit() -> None:
    # captions set in the body font are only recognizable by their credit line
    image = _BBox(x0=110.0, x1=300.0, y0=0.0, y1=200.0)
    paragraph = [
        [_line("Located in Salvador, Brazil", y0=60.0, y1=70.0)],
        [_line("Photo by travelism", y0=48.0, y1=55.0, font=7.0)],
    ]
    assert _is_caption_paragraph(paragraph, [image]) is True
    no_credit = [[_line("Located in Salvador, Brazil", y0=60.0, y1=70.0)]]
    assert _is_caption_paragraph(no_credit, [image]) is False
    # a lone copyright footer near an image is not a caption block
    lone_credit = [[_line("(c) 2026 Acme Corp", y0=48.0, y1=55.0, font=7.0)]]
    assert _is_caption_paragraph(lone_credit, [image]) is False


def test_furniture_drops_page_numbers_only_in_margin_bands() -> None:
    page_height = 842.0
    assert _is_furniture(_line("2", y0=14.0, y1=39.0), set(), page_height) is True
    assert _is_furniture(_line("2", y0=810.0, y1=830.0), set(), page_height) is True
    # a standalone number mid-page is a table/stat value, not a page number
    assert _is_furniture(_line("75", y0=400.0, y1=410.0), set(), page_height) is False
    assert _is_furniture(_line("Annual revenue was 2", y0=14.0, y1=39.0), set(), page_height) is False


def test_furniture_drops_repeated_headers() -> None:
    header = _line("Meedan 2024  Annual Report", y0=400.0, y1=410.0)
    assert _is_furniture(header, {"meedan 2024 annual report"}, 842.0) is True


def test_oversized_page_falls_back_to_plain_box_order() -> None:
    blocks = [[_line(f"line {i}", y0=float(i), y1=float(i) + 10.0)] for i in range(MAX_PAGE_LINES + 1)]
    page = _PageLayout(number=1, width=600.0, height=100000.0, blocks=blocks, images=[])
    output = _render_page(page, doc_font=10.0, furniture=set())
    assert len(output) == MAX_PAGE_LINES + 1
    assert output[0] == "line 0"
    assert not any(SIDEBAR_OPEN in part or CAPTION_TAG in part for part in output)


def test_mid_page_stat_numbers_survive_rendering() -> None:
    blocks = [
        [_line("Fact-checking partners", y0=500.0, y1=510.0)],
        [_line("75", y0=480.0, y1=490.0)],
        [_line("3", y0=14.0, y1=24.0)],
    ]
    page = _PageLayout(number=1, width=600.0, height=842.0, blocks=blocks, images=[])
    text = "\n\n".join(_render_page(page, doc_font=10.0, furniture=set()))
    assert "75" in text
    assert "3" not in text


def test_tags_use_plain_brackets() -> None:
    # the markers live inside chunk text that later sits inside <DOCUMENT ...>
    # prompt markup, so they must never look like markup themselves
    for marker in (CAPTION_TAG, SIDEBAR_OPEN, SIDEBAR_CLOSE):
        assert "<" not in marker and ">" not in marker
