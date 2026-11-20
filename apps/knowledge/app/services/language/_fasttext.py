"""Deprecated fasttext backend. Unused: detection goes through the LLM path."""

import sys

from fast_langdetect import LangDetectConfig, LangDetector
from loguru import logger

from .detector import DetectedLanguage, Detector


class FasttextDetector(Detector):
    def __init__(self) -> None:
        self._detector = LangDetector(LangDetectConfig(normalize_input=True, max_input_length=5000, model="full"))

    def detect_languages(self, text: str) -> list[DetectedLanguage]:
        try:
            results = self._detector.detect(text, model="auto", k=5)
            return [DetectedLanguage(lang=r["lang"], confidence=r["score"]) for r in results]
        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"fasttext error: {e}")
            return []
