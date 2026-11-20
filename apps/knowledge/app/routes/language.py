from fastapi import APIRouter

from app.models.language import DetectLanguageRequest, DetectLanguageResponse
from app.services.language import LANGUAGE_DETECTION_CHAR_LIMIT, detect_message
from app.services.language._llm import DetectionContext

router = APIRouter()


@router.post("/", response_model=DetectLanguageResponse)
async def detect_language(payload: DetectLanguageRequest) -> DetectLanguageResponse:
    """Detect the language of a single text, e.g. to welcome a new user in their language."""
    context = DetectionContext(
        default_language=payload.default_language,
        supported_languages=tuple(payload.supported_languages),
    )
    result = await detect_message(payload.text[:LANGUAGE_DETECTION_CHAR_LIMIT], context)
    return DetectLanguageResponse(language=result[0] if result else None)
