from unittest.mock import patch

import nltk

from app.services.router.extractor import NLTKEntityExtractor
from app.services.router.models import QueryContext


def _ctx(lang: str | None) -> QueryContext:
    return QueryContext(hub_id=1, message_id=1, original_query="q", detected_language=lang)


def _wire_fake_nltk(extractor: NLTKEntityExtractor) -> None:
    """Stub the NLTK pipeline so the english path runs without punkt_tab data."""
    extractor._nltk_imported = True
    extractor._word_tokenize = lambda q: q.split()
    extractor._pos_tag = lambda toks: [(t, "NNP") for t in toks]
    extractor._ne_chunk = lambda tagged: nltk.Tree("S", [nltk.Tree("PERSON", [("Angela", "NNP"), ("Merkel", "NNP")])])
    extractor._Tree = nltk.Tree


class TestNLTKEntityExtractorLanguageGate:
    def test_skips_non_english_via_context(self) -> None:
        extractor = NLTKEntityExtractor()
        with patch.object(extractor, "_ensure_nltk") as ensure:
            assert extractor.extract("انا اريد المساعدة من جمعية نبض", _ctx("ar")) == []
            ensure.assert_not_called()  # NLTK never touched for non-english

    def test_skips_when_language_unknown(self) -> None:
        extractor = NLTKEntityExtractor()
        with patch.object(extractor, "_ensure_nltk") as ensure:
            assert extractor.extract("Angela Merkel") == []
            assert extractor.extract("Angela Merkel", _ctx(None)) == []
            ensure.assert_not_called()

    def test_runs_on_english_via_context(self) -> None:
        extractor = NLTKEntityExtractor()
        _wire_fake_nltk(extractor)
        entities = extractor.extract("Angela Merkel", _ctx("en"))
        assert [(e.text, e.entity_type) for e in entities] == [("Angela Merkel", "PERSON")]
