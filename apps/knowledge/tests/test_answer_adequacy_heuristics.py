from app.core.constants import SOURCE_DOCUMENT_TAG, SOURCE_PRIORITIZED_ATTRIBUTE
from app.models.temporal import TemporalContext, TemporalType
from app.services.answer_adequacy_heuristics import (
    claims_prioritized_without_citing_it,
    clearly_inadequate_by_heuristics,
    matches_insufficient_phrase,
    misattributes_point_in_time_year,
    phrase_mentioned_in_context,
    quote_found_in_context,
)


def test_clearly_inadequate_requires_citations() -> None:
    body = "x" * 81
    # missing tag, rejected
    assert clearly_inadequate_by_heuristics(body, "en", None, None, None) is True
    # empty or whitespace-only, rejected
    assert clearly_inadequate_by_heuristics(body, "en", [], None, None) is True
    assert clearly_inadequate_by_heuristics(body, "en", ["  ", ""], None, None) is True


def test_clearly_inadequate_not_inadequate_with_citations_and_no_negation() -> None:
    body = "x" * 81
    assert clearly_inadequate_by_heuristics(body, "en", ["doc-a"], None, None) is False
    assert clearly_inadequate_by_heuristics(body, "en", ["doc-a"], ["doc-a"], None) is False


def test_clearly_inadequate_rejects_citations_not_matching_known_documents() -> None:
    body = "x" * 81
    assert clearly_inadequate_by_heuristics(body, "en", ["fake-id"], ["real-a", "real-b.txt"], None) is True


def test_clearly_inadequate_prefix_citation_resolves_against_known() -> None:
    body = "x" * 81
    assert (
        clearly_inadequate_by_heuristics(
            body,
            "en",
            ["roman-empire-01-recent"],
            ["roman-empire-01-recent.txt", "other.txt"],
            None,
        )
        is False
    )


def test_clearly_inadequate_rejects_negation_phrase() -> None:
    body = "x" * 81 + " i don't know"
    assert clearly_inadequate_by_heuristics(body, "en", ["doc-a"], None, None) is True


def test_matches_insufficient_phrase_startswith_en() -> None:
    answer = "There is not enough information to answer this question in full."
    assert matches_insufficient_phrase(answer, "en", temporal_type=TemporalType.NONE) is True


def test_matches_insufficient_phrase_substring_en() -> None:
    body = "x" * 81 + " i don't know"
    assert matches_insufficient_phrase(body, "en", temporal_type=TemporalType.NONE) is True


def test_matches_insufficient_phrase_skipped_for_point_in_time() -> None:
    answer = "There is not enough information to answer for 2024 specifically."
    assert matches_insufficient_phrase(answer, "en", temporal_type=TemporalType.POINT_IN_TIME) is False


def test_clearly_inadequate_skips_phrase_check_for_point_in_time() -> None:
    pit = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024-01-01")
    answer = (
        "There is not enough information to answer for 2024 specifically. "
        "The latest available rate in the sources is 8.5% as of January 2023."
    )
    assert clearly_inadequate_by_heuristics(answer, "en", ["doc-a"], ["doc-a"], pit) is False


_OLD_DOC_CONTEXT = [
    '<DOCUMENT ref="time-sensitive-old.txt" published_at="2023-01-15T00:00:00Z">\n'
    "The unemployment rate stands at 8.5%.\n</DOCUMENT>"
]


def test_misattributes_point_in_time_year_detects_wrong_year_attribution() -> None:
    pit = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024")
    answer = (
        "In 2024, the employment situation was characterized by a reported unemployment rate of 8.5%, "
        "with approximately 2.1 million citizens seeking employment."
    )
    assert misattributes_point_in_time_year(answer, pit, _OLD_DOC_CONTEXT, ["time-sensitive-old.txt"]) is True


def test_misattributes_point_in_time_year_allows_correct_source_year() -> None:
    pit = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2023")
    answer = "In 2023, the unemployment rate in the Veridian Republic was 8.5%."
    assert misattributes_point_in_time_year(answer, pit, _OLD_DOC_CONTEXT, ["time-sensitive-old.txt"]) is False


def test_misattributes_point_in_time_year_allows_missing_year_disclaimer() -> None:
    pit = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024")
    answer = (
        "There is no information about the 2024 unemployment rate in my sources. "
        "The most recent available figure is 8.5% from January 2023."
    )
    assert misattributes_point_in_time_year(answer, pit, _OLD_DOC_CONTEXT, ["time-sensitive-old.txt"]) is False


def test_misattributes_point_in_time_year_ignores_pure_disclaimer_without_figures() -> None:
    pit = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024")
    answer = "There is no information about the unemployment rate in 2024 in my sources."
    assert misattributes_point_in_time_year(answer, pit, _OLD_DOC_CONTEXT, ["time-sensitive-old.txt"]) is False


_BOTH_DOCS_CONTEXT = _OLD_DOC_CONTEXT + [
    '<DOCUMENT ref="veridian-informal-employment-valid.txt" published_at="2025-02-20T00:00:00Z">\n'
    "The informal employment rate in the Veridian Republic is 7.1%.\n</DOCUMENT>"
]
_BOTH_DOCS_CITED = ["time-sensitive-old.txt", "veridian-informal-employment-valid.txt"]


def test_misattributes_point_in_time_year_source_year_elsewhere_does_not_absolve() -> None:
    """Regression for the answer shape behind every logged test_chat_api_unemployment_time_awareness
    failure: the 2023 figure narrated as 2024 data, with a 2025 mention in a later sentence
    defusing the old answer-level check."""
    pit = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024")
    answer = (
        "In 2024, the employment situation was characterized by an unemployment rate of 8.5%. "
        "By mid-2025, the informal employment rate was reported at 7.1%."
    )
    assert misattributes_point_in_time_year(answer, pit, _BOTH_DOCS_CONTEXT, _BOTH_DOCS_CITED) is True


def test_misattributes_point_in_time_year_allows_same_sentence_disclosure() -> None:
    pit = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024")
    answer = (
        "There is no 2024 data in my sources; the rate was 8.5% in January 2023, "
        "and the informal employment rate reached 7.1% by February 2025."
    )
    assert misattributes_point_in_time_year(answer, pit, _BOTH_DOCS_CONTEXT, _BOTH_DOCS_CITED) is False


def test_misattributes_point_in_time_year_skips_undated_sources() -> None:
    pit = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024")
    undated_context = ['<DOCUMENT ref="doc-a">\nThe unemployment rate stands at 8.5%.\n</DOCUMENT>']
    answer = "In 2024, the unemployment rate was 8.5%."
    assert misattributes_point_in_time_year(answer, pit, undated_context, ["doc-a"]) is False


def test_misattributes_point_in_time_year_skips_day_precision() -> None:
    """Day/month-precision references must be exempt: prose dates like "July 14" would
    otherwise count as data figures. Regression for the "what did they announce
    yesterday?" integration failure, where a correct answer was rejected and the
    request timed out running improvement strategies."""
    pit = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2026-07-14")
    context = [
        '<DOCUMENT ref="integration_test_meedan" published_at="2025-11-01T00:00:00Z">\n'
        "Meedan announced a leadership transition.\n</DOCUMENT>"
    ]
    answer = "On July 14, 2026, Meedan announced that Dr. Dima Saber will become the new executive director."
    assert misattributes_point_in_time_year(answer, pit, context, ["integration_test_meedan"]) is False


_QUOTE_CONTEXT = [
    '<DOCUMENT ref="doc-a" published_at="2024-01-01T00:00:00Z">\n'
    "Northwind partnered with Seabright to run the joint tipline.\n</DOCUMENT>"
]


def test_quote_found_in_context_matches_verbatim_span() -> None:
    assert quote_found_in_context("Northwind partnered with Seabright", _QUOTE_CONTEXT) is True


def test_quote_found_in_context_ignores_whitespace_and_case() -> None:
    assert quote_found_in_context("northwind   PARTNERED\n with seabright", _QUOTE_CONTEXT) is True


def test_quote_found_in_context_rejects_paraphrase() -> None:
    assert quote_found_in_context("Northwind does not own Seabright", _QUOTE_CONTEXT) is False


def test_quote_found_in_context_rejects_short_or_empty_quotes() -> None:
    assert quote_found_in_context("Northwind", _QUOTE_CONTEXT) is False
    assert quote_found_in_context("", _QUOTE_CONTEXT) is False
    assert quote_found_in_context("Northwind partnered with Seabright", None) is False


_PRIORITIZED_CONTEXT = [
    f'<{SOURCE_DOCUMENT_TAG} ref="contrib" {SOURCE_PRIORITIZED_ATTRIBUTE}="true">\n82 Mill Lane\n</{SOURCE_DOCUMENT_TAG}>\n'
    f'<{SOURCE_DOCUMENT_TAG} ref="report">\n14 Tanner Street\n</{SOURCE_DOCUMENT_TAG}>'
]


def test_claims_prioritized_without_citing_it_flags_mislabelled_value() -> None:
    # the observed failure: the stale value, cited from the untagged report, labelled prioritized
    answer = "The clinic is at 14 Tanner Street. This address is prioritized as the main location."
    assert claims_prioritized_without_citing_it(answer, ["report"], _PRIORITIZED_CONTEXT) is True
    assert claims_prioritized_without_citing_it(
        answer.replace("prioritized", "Prioritised"), ["report"], _PRIORITIZED_CONTEXT
    )


def test_claims_prioritized_without_citing_it_accepts_cited_prioritized_passage() -> None:
    answer = "The clinic is at 82 Mill Lane, the prioritized address."
    assert claims_prioritized_without_citing_it(answer, ["contrib"], _PRIORITIZED_CONTEXT) is False
    assert claims_prioritized_without_citing_it(answer, ["contrib", "report"], _PRIORITIZED_CONTEXT) is False


def test_claims_prioritized_without_citing_it_ignores_answers_it_cannot_judge() -> None:
    # no prioritized label, no prioritized tag in context, or no citations (the citation heuristic owns that)
    assert (
        claims_prioritized_without_citing_it("The clinic is at 14 Tanner Street.", ["report"], _PRIORITIZED_CONTEXT)
        is False
    )
    untagged = [f'<{SOURCE_DOCUMENT_TAG} ref="report">\nThe budget prioritized housing.\n</{SOURCE_DOCUMENT_TAG}>']
    assert claims_prioritized_without_citing_it("The budget prioritized housing.", ["report"], untagged) is False
    assert claims_prioritized_without_citing_it("It is prioritized.", None, _PRIORITIZED_CONTEXT) is False
    assert claims_prioritized_without_citing_it("It is prioritized.", ["report"], None) is False


# CMS document ids come from Ruby's Base64.encode64, which appends a newline
_CMS_CONTRIBUTION_ID = "Q29udHJpYnV0aW9uLzE=\n"
_CMS_REPORT_ID = "RG9jdW1lbnQvMTg=\n"
_CMS_CONTEXT = [
    f'<{SOURCE_DOCUMENT_TAG} ref="{_CMS_CONTRIBUTION_ID}" {SOURCE_PRIORITIZED_ATTRIBUTE}="true">\n'
    f"Person Name is the director of Meedan as of September 2026.\n</{SOURCE_DOCUMENT_TAG}>\n"
    f'<{SOURCE_DOCUMENT_TAG} ref="{_CMS_REPORT_ID}">\nDr. Dima Saber is the executive director.\n</{SOURCE_DOCUMENT_TAG}>'
]


def test_claims_prioritized_without_citing_it_matches_cms_ids_with_trailing_newline() -> None:
    """Production regression: the stripped cited id never matched the newline-terminated ref, so every
    correct answer citing the contribution was hard-rejected."""
    answer = "Person Name is the director of Meedan. This information is prioritized."
    assert claims_prioritized_without_citing_it(answer, [_CMS_CONTRIBUTION_ID], _CMS_CONTEXT) is False
    assert claims_prioritized_without_citing_it(answer, [_CMS_CONTRIBUTION_ID.strip()], _CMS_CONTEXT) is False
    assert claims_prioritized_without_citing_it(answer, [_CMS_REPORT_ID], _CMS_CONTEXT) is True


def test_phrase_mentioned_in_context_matches_the_whole_phrase_only() -> None:
    passages = ["South Carolina offers two weeks of early voting.", "A  new   rule applies statewide."]
    assert phrase_mentioned_in_context("south carolina", passages) is True
    assert phrase_mentioned_in_context("North Carolina", passages) is False
    assert phrase_mentioned_in_context("New York", passages) is False
    assert phrase_mentioned_in_context("new rule", passages) is True
    assert phrase_mentioned_in_context("", passages) is False
    assert phrase_mentioned_in_context("Ohio", None) is False


def test_phrase_mentioned_in_context_matches_whole_words_only() -> None:
    passages = ["Indiana business owners must register because of the new rule.", "Voters in India go to the polls."]
    assert phrase_mentioned_in_context("India", passages) is True
    assert phrase_mentioned_in_context("US", passages) is False
    assert phrase_mentioned_in_context("Indiana", ["Voters in India go to the polls."]) is False
    assert phrase_mentioned_in_context("St. Louis", ["Polls in St. Louis open at 6."]) is True
    assert phrase_mentioned_in_context("St. Louis", ["Polls in StX Louis open at 6."]) is False
    assert phrase_mentioned_in_context("D.C.", ["Washington D.C. polls open at 7."]) is True
    assert phrase_mentioned_in_context("D.C.", ["The AD.C.X code"]) is False
