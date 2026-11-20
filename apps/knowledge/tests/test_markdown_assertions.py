import pytest

from tests.markdown_assertions import assert_markdown_summary


@pytest.mark.parametrize(
    "summary",
    [
        "## Overview\n\nThree claims were checked this week.",
        "Key findings:\n\n- The bridge collapse claim is misleading\n- The dataset was superseded",
        "Three claims were checked.\n\n1. The vaccine schedule was misrepresented\n2. The figure was corrected",
        "### Water access\n\nFarmers reported longer dry seasons.\n\n### Schools\n\nThe lunch program expanded.",
    ],
)
def test_accepts_marked_up_structure(summary: str) -> None:
    assert_markdown_summary(summary, expect_structure=True)


@pytest.mark.parametrize(
    "summary",
    [
        # structure is there, but implied instead of marked up
        "Who:\nThe regional council.\n\nWhat:\nApproved funding for solar panels.",
        "SUMMARY OF FINDINGS\n\nThe council approved funding for solar panels this quarter.",
        "Three claims were checked.\n\n1) The vaccine schedule was misrepresented\n2) The figure was corrected",
        "Water access in Kenya\n\nFarmers reported longer dry seasons and broken hand pumps.",
    ],
)
def test_rejects_unmarked_structure(summary: str) -> None:
    with pytest.raises(AssertionError):
        assert_markdown_summary(summary)


@pytest.mark.parametrize(
    "summary",
    [
        "The council approved funding for solar panels, expanding capacity across coastal communities.",
        "Los agricultores informaron de estaciones secas más largas y bombas manuales averiadas.",
        "Costs are 5*2 dollars and the file is named my_file_name.",
    ],
)
def test_accepts_a_single_paragraph_when_structure_is_unchecked(summary: str) -> None:
    assert_markdown_summary(summary)


def test_requires_structure_when_asked() -> None:
    summary = "The council approved funding for solar panels, expanding capacity across communities."
    with pytest.raises(AssertionError):
        assert_markdown_summary(summary, expect_structure=True)


def test_rejects_an_empty_summary() -> None:
    with pytest.raises(AssertionError):
        assert_markdown_summary("   ")


@pytest.mark.parametrize(
    "summary",
    [
        "## Council Flood Figure Correction\n\nThe council revised the figure it published in March.",
        "The council revised the figure.\n\n- it was published in March\n- the dataset was superseded",
    ],
)
def test_rejects_structure_invented_for_content_that_has_none(summary: str) -> None:
    with pytest.raises(AssertionError):
        assert_markdown_summary(summary, expect_structure=False)


def test_accepts_a_bare_paragraph_when_structure_is_not_expected() -> None:
    assert_markdown_summary(
        "The council revised the flood figure it published in March after the dataset was superseded.",
        expect_structure=False,
    )


@pytest.mark.parametrize(
    "summary",
    [
        # a short paragraph is not a heading just because it is short: these close on a
        # symbol rather than sentence punctuation, which an end-of-line check alone misreads
        "Attendance rose by 12%\n\nThe program expanded to two new districts this term.",
        "The figure was corrected (see note)\n\nThe council published the revision in April.",
        'The report called it "significant"\n\nOfficials disagreed with that framing.',
    ],
)
def test_accepts_short_paragraphs_that_do_not_end_in_sentence_punctuation(summary: str) -> None:
    assert_markdown_summary(summary)
