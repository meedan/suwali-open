"""Deprecated pycld2 backend. Unused: detection goes through the LLM path."""

import re
import sys

import pycld2
from loguru import logger

from .detector import DetectedLanguage, Detector

# Control characters (excluding \t \n \r) that pycld2 rejects as
# "invalid UTF-8" even though they're valid unicode, e.g. NUL bytes left
# behind by PDF ligature extraction.
_INVALID_FOR_PYCLD2 = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")


class Pycld2Detector(Detector):
    def detect_languages(self, text: str) -> list[DetectedLanguage]:
        try:
            _, _, details = pycld2.detect(_INVALID_FOR_PYCLD2.sub("", text))
            return [
                DetectedLanguage(lang=lang_code, confidence=percent / 100.0)
                for _, lang_code, percent, _ in details
                if lang_code != "un"
            ]
        except pycld2.error as e:
            logger.opt(exception=sys.exc_info()).error(f"pycld2 error: {e}")
            return []
