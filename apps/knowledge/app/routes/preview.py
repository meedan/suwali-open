from fastapi import APIRouter, HTTPException, status
from loguru import logger

from app.models.chat import PreviewRequest, PreviewResponse
from app.services.preview import generate_preview_response

router = APIRouter()


# Deliberately sync: generate_preview_response() blocks on an LLM call for several seconds, and an
# async handler would hold the event loop for that long, stalling every other request. FastAPI runs
# sync handlers in a threadpool instead.
@router.post("/", response_model=PreviewResponse, status_code=200)
def preview(payload: PreviewRequest) -> PreviewResponse:
    logger.info(f"Generating preview for scenario: {payload.scenario}")
    answer = generate_preview_response(payload.scenario, payload.personalization)
    if not answer:
        # an error status, not a placeholder answer, so the CMS never caches or sends it to users
        logger.warning(f"Empty preview generated for scenario: {payload.scenario}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="The model returned an empty preview")
    logger.info(f"Preview generated successfully for scenario: {payload.scenario}")
    return PreviewResponse(answer=answer)
