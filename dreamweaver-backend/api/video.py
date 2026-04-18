
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, List, Any
import logging

from providers.modal.video import ModalVideoProvider, LTX2_MODEL_IDS, LTX2_3_MODEL_IDS
from providers.google.video import GoogleVideoProvider
from config.settings import settings

router = APIRouter(prefix="/api/video", tags=["video"])

logger = logging.getLogger(__name__)


MODAL_VIDEO_MODEL_IDS = LTX2_MODEL_IDS | LTX2_3_MODEL_IDS


class VideoGenerationRequest(BaseModel):
    prompt: str = Field(..., description="Text prompt for generation")
    model_id: str = Field("ltx-2.3", description="Model ID (ltx-2, ltx-2.3, veo-3.1)")
    negative_prompt: Optional[str] = Field(None, description="Negative prompt")
    start_image: Optional[str] = Field(None, description="Base64 or URL of start image")
    end_image: Optional[str] = Field(
        None,
        description="Base64 or URL of end image. On LTX-2.3 with start_image set this triggers keyframe interpolation.",
    )
    aspect_ratio: str = Field("16:9", description="Aspect ratio (e.g. 16:9, 1:1)")
    duration: str = Field("5", description="Duration in seconds (approx)")
    camera_movement: str = Field("static", description="Camera movement type")
    seed: Optional[int] = Field(42, description="Random seed")

    # Extra params from frontend
    audio_enabled: bool = Field(False, description="Enable audio generation")
    slow_motion: bool = Field(False, description="Enable slow motion")

    # LTX-2.3 specific overrides (ignored by legacy LTX-2)
    num_inference_steps: Optional[int] = Field(None, description="LTX-2.3: denoising steps (default 30)")
    cfg_guidance_scale: Optional[float] = Field(None, description="LTX-2.3: classifier-free guidance (default 3.0)")
    enhance_prompt: bool = Field(False, description="LTX-2.3: auto-enhance prompt via the model")
    frame_rate: Optional[float] = Field(None, description="LTX-2.3: frames per second (default 24)")

    # Other potential params
    batch_size: int = Field(1, description="Number of videos (usually 1)")


class VideoRetakeRequest(BaseModel):
    """LTX-2.3 video-to-video region regeneration request."""

    prompt: str = Field(..., description="Text prompt for the regenerated section")
    start_time: float = Field(..., description="Start of region to regenerate (seconds)")
    end_time: float = Field(..., description="End of region to regenerate (seconds)")

    video_url: Optional[str] = Field(None, description="URL to source video")
    video_data: Optional[str] = Field(None, description="Base64-encoded source video")

    negative_prompt: Optional[str] = Field(None)
    num_inference_steps: int = Field(30)
    cfg_guidance_scale: float = Field(3.0)
    seed: int = Field(42)
    regenerate_video: bool = Field(True)
    regenerate_audio: bool = Field(True)
    enhance_prompt: bool = Field(False)

    # Routes to the retake pipeline; only LTX-2.3 supports this for now.
    model_id: str = Field("ltx-2.3", description="Model ID (LTX-2.3 only)")


def _modal_provider() -> ModalVideoProvider:
    return ModalVideoProvider(api_key=settings.modal_api_key)


@router.post("/generate")
async def generate_video(request: VideoGenerationRequest):
    logger.info(f"Received Video Generation Request: {request.dict()}")
    try:
        model_id = (request.model_id or "").lower()
        if model_id == "veo-3.1":
            provider = GoogleVideoProvider(api_key=None)  # TODO: wire Vertex credentials
        elif model_id in MODAL_VIDEO_MODEL_IDS:
            provider = _modal_provider()
        else:
            # Default to Modal LTX-2.3 for any unrecognized id.
            logger.warning(f"Unknown model_id '{model_id}', defaulting to ltx-2.3")
            provider = _modal_provider()

        req_dict = request.dict()
        # Strip None-only LTX-2.3 overrides so provider defaults apply.
        for key in ("num_inference_steps", "cfg_guidance_scale", "frame_rate"):
            if req_dict.get(key) is None:
                req_dict.pop(key, None)

        result = await provider.generate(req_dict)
        return result

    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Video generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/retake")
async def retake_video(request: VideoRetakeRequest):
    """LTX-2.3 video-to-video: regenerate a [start_time, end_time] window."""
    logger.info(
        f"Received Video Retake Request window={request.start_time}-{request.end_time}s "
        f"model={request.model_id}"
    )
    model_id = (request.model_id or "").lower()
    if model_id not in LTX2_3_MODEL_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"retake is only supported on LTX-2.3 (got '{request.model_id}')",
        )

    try:
        provider = _modal_provider()
        result = await provider.retake(request.dict(exclude_none=True))
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Video retake failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

