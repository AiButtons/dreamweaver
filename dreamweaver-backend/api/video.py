
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, List, Any
import logging

from providers.modal.video import ModalVideoProvider
from providers.google.video import GoogleVideoProvider
from config.settings import settings

router = APIRouter(prefix="/api/video", tags=["video"])

logger = logging.getLogger(__name__)

class VideoGenerationRequest(BaseModel):
    prompt: str = Field(..., description="Text prompt for generation")
    model_id: str = Field("ltx-2", description="Model ID (ltx-2 or veo-3.1)")
    negative_prompt: Optional[str] = Field(None, description="Negative prompt")
    start_image: Optional[str] = Field(None, description="Base64 or URL of start image")
    end_image: Optional[str] = Field(None, description="Base64 or URL of end image")
    aspect_ratio: str = Field("16:9", description="Aspect ratio (e.g. 16:9, 1:1)")
    duration: str = Field("5", description="Duration in seconds (approx)")
    camera_movement: str = Field("static", description="Camera movement type")
    seed: Optional[int] = Field(42, description="Random seed")
    
    # Extra params from frontend
    audio_enabled: bool = Field(False, description="Enable audio generation")
    slow_motion: bool = Field(False, description="Enable slow motion")
    
    # Other potential params
    batch_size: int = Field(1, description="Number of videos (usually 1)")

@router.post("/generate")
async def generate_video(request: VideoGenerationRequest):
    logger.info(f"Received Video Generation Request: {request.dict()}")
    try:
        if request.model_id == "veo-3.1":
            # Use Google Provider
            provider = GoogleVideoProvider(api_key=None) # Add Vertex/Google key if available
        else:
            # Default to Modal LTX2
            provider = ModalVideoProvider(api_key=settings.modal_api_key)
        
        # Convert Pydantic model to dict for provider
        req_dict = request.dict()
        
        # Clean up
        result = await provider.generate(req_dict)
        return result
        
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        logger.error(f"Video generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

