"""Helpers for asserting scenario replies only contain configured contact details."""

import re

_EMAIL_PATTERN = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
_URL_PATTERN = re.compile(r"https?://[^\s\])>,]+|www\.[^\s\])>,]+")
_PHONE_PATTERN = re.compile(r"(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3}[\s.-]?\d{4,}")


def _normalize_phone_digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def _strip_trailing_punctuation(value: str) -> str:
    return value.rstrip(".,;:!?)\"'")


def assert_answer_contacts_subset(answer: str, allowed_titles: list[str]) -> None:
    """Fail if the answer contains emails, URLs, or phone numbers not from allowed_titles."""
    allowed_emails = {t.lower() for t in allowed_titles if "@" in t}
    allowed_urls = {
        _strip_trailing_punctuation(t).lower()
        for t in allowed_titles
        if t.lower().startswith(("http://", "https://", "www."))
    }
    allowed_phone_digits = {
        _normalize_phone_digits(t)
        for t in allowed_titles
        if len(_normalize_phone_digits(t)) >= 10 and "@" not in t and not t.lower().startswith("http")
    }

    for email in _EMAIL_PATTERN.findall(answer):
        email_l = email.lower()
        if not any(email_l in allowed or allowed in email_l for allowed in allowed_emails):
            raise AssertionError(f"Unexpected email {email!r} in answer (allowed: {allowed_titles})")

    for url in _URL_PATTERN.findall(answer):
        url_l = _strip_trailing_punctuation(url).lower()
        if not any(url_l in allowed or allowed in url_l for allowed in allowed_urls):
            raise AssertionError(f"Unexpected URL {url!r} in answer (allowed: {allowed_titles})")

    for match in _PHONE_PATTERN.findall(answer):
        digits = _normalize_phone_digits(match)
        if len(digits) < 10:
            continue
        if not any(
            digits == allowed or digits.endswith(allowed) or allowed.endswith(digits)
            for allowed in allowed_phone_digits
        ):
            raise AssertionError(f"Unexpected phone {match!r} in answer (allowed: {allowed_titles})")
