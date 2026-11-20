"""Deprecated langdetect backend. Unused: detection goes through the LLM path."""

import sys

import langdetect
from langdetect import DetectorFactory
from loguru import logger

from .detector import DetectedLanguage, Detector

DetectorFactory.seed = 0


class LangdetectDetector(Detector):
    def detect_languages(self, text: str) -> list[DetectedLanguage]:
        try:
            results = langdetect.detect_langs(text)
            if not results:
                return []
            return [DetectedLanguage(lang=str(r.lang), confidence=float(r.prob)) for r in results]
        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"langdetect error: {e}")
            return []
