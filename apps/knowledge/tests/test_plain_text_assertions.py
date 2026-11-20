import pytest

from tests.plain_text_assertions import assert_plain_text_answer


@pytest.mark.parametrize(
    "answer",
    [
        "You can visit [Google](https://google.com) for additional help.",
        "Contact us at [hello@meedan.org](mailto:hello@meedan.org).",
        "**Important:** call the support line.",
        "__Important__ call the support line.",
        "# Help\nVisit our help center.",
        "Use the `support` command.",
    ],
)
def test_rejects_markdown(answer: str) -> None:
    with pytest.raises(AssertionError):
        assert_plain_text_answer(answer)


@pytest.mark.parametrize(
    "answer",
    [
        "I couldn't find an answer. You can visit https://example.org/help for assistance.",
        # fallback paths append resources as "- {title}" lines; bullets must not be flagged
        "I couldn't find an answer. Try rephrasing your question.\n\n- https://example.org/help\n- +1 555 1234",
        "Para más ayuda visite https://example.org/help (disponible 24/7).",
        "अधिक सहायता के लिए https://example.org/help देखें।",
        "Costs are 5*2 dollars and the file is named my_file_name.",
    ],
)
def test_accepts_plain_text(answer: str) -> None:
    assert_plain_text_answer(answer)
