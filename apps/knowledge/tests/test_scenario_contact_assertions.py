import pytest

from tests.scenario_contact_assertions import assert_answer_contacts_subset


def test_allows_configured_email_only() -> None:
    assert_answer_contacts_subset(
        "You can reach us at hello@meedan.org for help.",
        ["hello@meedan.org"],
    )


def test_rejects_extra_phone_when_only_email_configured() -> None:
    with pytest.raises(AssertionError, match="Unexpected phone"):
        assert_answer_contacts_subset(
            "Email hello@meedan.org or call +1 (415) 800-1000.",
            ["hello@meedan.org"],
        )


def test_rejects_extra_url_when_only_email_configured() -> None:
    with pytest.raises(AssertionError, match="Unexpected URL"):
        assert_answer_contacts_subset(
            "Email hello@meedan.org or visit https://meedan.com.",
            ["hello@meedan.org"],
        )


def test_rejects_second_phone_when_one_phone_configured() -> None:
    with pytest.raises(AssertionError, match="Unexpected phone"):
        assert_answer_contacts_subset(
            "Call +1 555 1234 or +1 415 621 2000.",
            ["+1 555 1234"],
        )


def test_allows_configured_phone_and_url() -> None:
    assert_answer_contacts_subset(
        "Call +1 555 1234 or visit https://example.org/store.",
        ["+1 555 1234", "https://example.org/store"],
    )
