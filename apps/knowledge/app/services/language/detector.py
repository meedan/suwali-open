"""Deprecated statistical language detectors.

Chat and text detection use the LLM path in ``app.services.language``. These
backends remain only so they can be reinstated without rewriting them.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from warnings import deprecated


# can be converted to a Pydantic model and moved to models/ if we decide to
# use it outside of the language module
@dataclass
class DetectedLanguage:
    lang: str  # ISO 639-1 code
    confidence: float  # 0.0 - 1.0


class Detector(ABC):
    @abstractmethod
    def detect_languages(self, text: str) -> list[DetectedLanguage]:
        """Return detected languages sorted by confidence descending."""
        ...


_DEPRECATED_MSG = (
    "Statistical language detectors (langdetect, pycld2, fasttext) are deprecated; "
    "detection uses the LLM path. This factory is kept only to restore a backend."
)


@deprecated(_DEPRECATED_MSG)
def create_detector(backend: str) -> Detector:
    if backend == "langdetect":
        from ._langdetect import LangdetectDetector

        return LangdetectDetector()
    elif backend == "pycld2":
        from ._pycld2 import Pycld2Detector

        return Pycld2Detector()
    elif backend == "fasttext":
        from ._fasttext import FasttextDetector

        return FasttextDetector()
    else:
        raise ValueError(f"Unknown language detector backend: {backend}")
