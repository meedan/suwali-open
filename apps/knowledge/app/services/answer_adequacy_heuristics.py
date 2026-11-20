import re

from app.core.constants import prioritized_document_refs
from app.models.temporal import TemporalContext, TemporalPrecision, TemporalType
from app.services.citation_reconciliation import at_least_one_citation_resolves

MIN_ANSWER_LENGTH = 20

_YEAR_TOKEN = re.compile(r"\b(19|20)\d{2}\b")
# ref and published_at attributes of the <DOCUMENT ...> markup produced by the retrievers
_SOURCE_TAG = re.compile(r'ref="([^"]+)"[^>]*?published_at="(\d{4})')
# the generator is told to use this word when it gives a prioritized value; British spelling tolerated
_PRIORITIZED_WORD = re.compile(r"\bprioriti[sz]ed\b", re.IGNORECASE)
# sentence terminator followed by whitespace, or a newline; decimals like "8.5" never split since no whitespace follows the dot
# includes Arabic, Urdu and Devanagari terminators for the supported corpus languages
_SENTENCE_END = re.compile(r"(?<=[.!?؟۔।])\s+|\n+")

INSUFFICIENT_PHRASES_STARTSWITH: dict[str, tuple[str, ...]] = {
    "en": (
        "there is not enough information to answer",
        "i don't have enough information",
        "i do not have enough information",
        "i'm sorry, but i couldn't find an answer to your question.",
    ),
    "ar": ("عذرًا، لم أتمكن من العثور على إجابة لسؤالك",),
    "fr": (
        "désolé, je n'ai pas pu trouver de réponse à votre question.",
        "je suis désolé, mais je n'ai pas pu trouver de réponse à votre question",
    ),
    "pt": ("desculpe, não consegui encontrar uma resposta para a sua pergunta",),
    "es": (
        "lo siento, no pude encontrar una respuesta a su pregunta.",
        "lo siento, pero no pude encontrar una respuesta a su pregunta.",
    ),
    "hi": ("मुझे खेद है, लेकिन आपके प्रश्न का कोई उत्तर नहीं मिला। कृपया अपने प्रश्न को फिर से जांचें या अन्य प्रश्न पूछने का प्रयास करें।",),
}

INSUFFICIENT_PHRASES_SUBSTRING: dict[str, tuple[str, ...]] = {
    "en": (
        "i don't know",
        "please, rephrase the question",
    ),
    "ar": ("لا أعرف", "ليس لدي إجابة على هذا السؤال", "يرجى إعادة الطريقة"),
    "fr": (
        "je ne sais pas",
        "je n'ai pas assez d'informations pour répondre à cette question",
        "veuillez réécrire la question",
    ),
    "pt": (
        "eu não sei",
        "eu não tenho informações suficientes para responder a esta pergunta",
        "por favor, reformule a pergunta",
    ),
    "es": (
        "no sé",
        "no tengo suficiente información para responder a esta pregunta",
        "por favor, reformule la pregunta",
    ),
    "hi": (
        "मैं नहीं जानता",
        "मुझे इस प्रश्न का उत्तर देने के लिए पर्याप्त जानकारी नहीं है",
        "कृपया प्रश्न को पुनः विचार करें",
    ),
}


def _temporal_type(temporal_context: TemporalContext | None) -> TemporalType:
    if temporal_context is None:
        return TemporalType.NONE
    return temporal_context.type


def matches_insufficient_phrase(
    answer: str,
    language: str,
    *,
    temporal_type: TemporalType,
) -> bool:
    if temporal_type == TemporalType.POINT_IN_TIME:
        return False

    haystack = answer.lower()
    for phrase in INSUFFICIENT_PHRASES_STARTSWITH.get(language, ()):
        if haystack.startswith(phrase):
            return True
    for phrase in INSUFFICIENT_PHRASES_SUBSTRING.get(language, ()):
        if phrase in haystack:
            return True
    return False


def _requested_year(temporal_context: TemporalContext) -> str | None:
    if not temporal_context.reference_date:
        return None
    match = re.match(r"^(\d{4})", temporal_context.reference_date)
    return match.group(1) if match else None


def _cited_source_years(context: list[str] | None, cited_sources: list[str] | None) -> set[str]:
    """Publication years of the cited documents, parsed from the <DOCUMENT ...> markup."""
    if not context:
        return set()
    cites = [c.strip() for c in cited_sources or [] if c and c.strip()]
    years = set()
    for chunk in context:
        for ref, year in _SOURCE_TAG.findall(chunk):
            # match citation reconciliation: exact id or unambiguous prefix of it
            if not cites or any(ref == c or ref.startswith(c) for c in cites):
                years.add(year)
    return years


def _mentions_non_year_figure(answer: str) -> bool:
    """True when the answer contains numeric data beyond bare year tokens."""
    return bool(re.search(r"\d", _YEAR_TOKEN.sub("", answer)))


_WHITESPACE = re.compile(r"\s+")
MIN_EVIDENCE_QUOTE_CHARS = 15


def entity_mentioned_in_context(entity: str, context: list[str] | None) -> bool:
    """True when any token of ``entity`` appears in the passages, in any script.

    No capitalisation test: ar and hi carry no letter case, so a casing filter yields no tokens
    and any gate built on it silently stops rejecting anything for a third of the supported
    languages. The caller supplies an already-bare name, so every token is a name part.

    Substring rather than word-boundary matching, which earns its keep outside Latin: Arabic
    clitics and Devanagari suffixes mean the passages often carry a longer form of the same
    name, and the shorter form still matches inside it.

    Falls open (True) when there is nothing usable to match, so a phrase that slips through
    matches common words and leaves the LLM's own verdict in charge rather than rejecting.
    """
    tokens = [tok for tok in (entity or "").split() if len(tok) >= 2]
    if not tokens:
        return True
    if not context:
        return False
    haystack = "\n".join(chunk for chunk in context if chunk).casefold()
    return any(tok.casefold() in haystack for tok in tokens)


def phrase_mentioned_in_context(phrase: str, context: list[str] | None) -> bool:
    """True when the whole phrase appears in a passage, ignoring whitespace runs and case.

    Built for place names, where the per-token matcher above is wrong: "North Carolina" must not
    match a passage about South Carolina, and "New York" must not match the word "new". The match
    is on word boundaries, so "India" does not match Indiana and "US" does not match business, and
    "D.C." still matches before a space.
    Short phrases are allowed, since "US" or "DC" are legitimate places; the caller pairs this with
    the judge's own verdict so an alias the phrase check cannot see does not reject on its own.
    """
    if not phrase or not context:
        return False
    needle = _WHITESPACE.sub(" ", phrase).strip().casefold()
    if not needle:
        return False
    # lookarounds rather than \b: a name ending in punctuation ("D.C.") has no word boundary after it
    pattern = re.compile(r"(?<!\w)" + re.escape(needle) + r"(?!\w)")
    return any(pattern.search(_WHITESPACE.sub(" ", chunk).casefold()) for chunk in context if chunk)


def quote_found_in_context(quote: str, context: list[str] | None) -> bool:
    """True when the quote really appears in a retrieved passage, ignoring whitespace and case.

    The judge treats implication as statement ("they partnered" read as "they do not own"), so a
    claim that the passages settle something is only honoured when the span backing it can be found.
    Quotes shorter than MIN_EVIDENCE_QUOTE_CHARS are rejected: a few words match by accident.
    """
    if not quote or not context:
        return False
    needle = _WHITESPACE.sub(" ", quote).strip().casefold()
    if len(needle) < MIN_EVIDENCE_QUOTE_CHARS:
        return False
    return any(needle in _WHITESPACE.sub(" ", chunk).casefold() for chunk in context if chunk)


def misattributes_point_in_time_year(
    answer: str,
    temporal_context: TemporalContext,
    context: list[str] | None,
    cited_sources: list[str] | None,
) -> bool:
    """Detect answers that present figures under the asked-about year when every cited
    source was published in a different year and the sentence never discloses that year.

    Complements judge criterion 9: the LLM judge sometimes accepts a figure from year Y
    presented as year X data. The check is sentence-scoped: a source year mentioned
    elsewhere in the answer does not absolve a sentence that pairs the requested year
    with an undated figure — "In 2019 prices rose 4%. By 2021 they stabilized." still
    misattributes the 4% when the figure's source is a 2017 report, even though 2021 is
    another cited source's year. Sentences carrying the real source year next to the
    figure ("no data for 2019, the latest figure is from 2017") are not flagged;
    sentences without figures aren't either.

    Only applies to YEAR-precision references ("what was X in 2024?"). For day/month
    precision ("yesterday", "last June") prose dates like "July 14" would read as data
    figures and correct answers would be rejected.
    """
    if temporal_context.precision != TemporalPrecision.YEAR:
        return False

    year = _requested_year(temporal_context)
    if not year or year not in answer:
        return False

    source_years = _cited_source_years(context, cited_sources)
    if not source_years or year in source_years:
        return False

    for sentence in _SENTENCE_END.split(answer):
        if year not in sentence:
            continue
        if any(source_year in sentence for source_year in source_years):
            continue
        if _mentions_non_year_figure(sentence):
            return True
    return False


def clearly_inadequate_by_heuristics(
    answer: str,
    language: str,
    cited_sources: list[str] | None,
    source_document_ids: list[str] | None,
    temporal_context: TemporalContext | None,
) -> bool:
    if not answer or len(answer) < MIN_ANSWER_LENGTH:
        return True

    # reject if no citations: None (tag absent), [] (empty), or whitespace-only
    if not cited_sources or not any(s.strip() for s in cited_sources if s):
        return True

    if cited_sources and source_document_ids is not None:
        non_empty_cites = [s.strip() for s in cited_sources if s and s.strip()]
        if not at_least_one_citation_resolves(non_empty_cites, source_document_ids):
            return True

    if language and matches_insufficient_phrase(answer, language, temporal_type=_temporal_type(temporal_context)):
        return True

    return False


def claims_prioritized_without_citing_it(
    answer: str,
    cited_sources: list[str] | None,
    context: list[str] | None,
) -> bool:
    """True when the answer calls a value prioritized but cites none of the prioritized passages.

    Catches the generator attaching the prioritized label to a value from an untagged passage
    (repeated across many chunks) — a mislabel the LLM judge tends to accept at face value.
    """
    if not answer or not _PRIORITIZED_WORD.search(answer):
        return False
    prioritized_refs = prioritized_document_refs("\n".join(context or []))
    cited = {s.strip() for s in cited_sources or [] if s and s.strip()}
    if not prioritized_refs or not cited:
        return False
    return cited.isdisjoint(prioritized_refs)
