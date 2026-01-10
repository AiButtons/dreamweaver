from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import base64
import httpx

from config.settings import settings
from services.prompt_builder import build_full_prompt

router = APIRouter()


class ImageGenerationRequest(BaseModel):
    prompt: Optional[str] = None
    input_image: Optional[str] = None  # base64
    azimuth: float = 0
    elevation: float = 0
    distance: float = 1.0
    camera_id: Optional[str] = None
    lens_id: Optional[str] = None
    focal_length: int = 35
    aperture: str = "f/11"
    aspect_ratio: str = "16:9"
    resolution: str = "fhd"
    batch_size: int = 1
    model_id: str = "dall-e-3"


class ImageGenerationResponse(BaseModel):
    id: str
    prompt: str
    images: list[str]  # base64 or URLs


@router.post("/generate", response_model=ImageGenerationResponse)
async def generate_image(request: ImageGenerationRequest):
    """Generate images from visual parameters."""
    
    # Build the full prompt
    full_prompt = build_full_prompt(
        user_prompt=request.prompt or "",
        azimuth=request.azimuth,
        elevation=request.elevation,
        distance=request.distance,
        camera_id=request.camera_id,
        lens_id=request.lens_id,
        focal_length=request.focal_length,
        aperture=request.aperture,
    )
    
    # Map resolution
    size_map = {
        "hd": "1024x1024",
        "fhd": "1792x1024",
        "2k": "1792x1024",
        "4k": "1792x1024",  # DALL-E 3 max
    }
    size = size_map.get(request.resolution, "1024x1024")
    
    # For now, return mock response
    # TODO: Connect to actual OpenAI API
    if not settings.openai_api_key:
        return ImageGenerationResponse(
            id="mock-123",
            prompt=full_prompt,
            images=["https://via.placeholder.com/1024"],
        )
    
    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.openai_api_key)
        
        response = client.images.generate(
            model="dall-e-3",
            prompt=full_prompt,
            size=size,
            quality="hd",
            n=1,
        )
        
        return ImageGenerationResponse(
            id=response.created,
            prompt=full_prompt,
            images=[img.url for img in response.data],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/build-prompt")
async def build_prompt(request: ImageGenerationRequest):
    """Build prompt from visual parameters without generating."""
    full_prompt = build_full_prompt(
        user_prompt=request.prompt or "",
        azimuth=request.azimuth,
        elevation=request.elevation,
        distance=request.distance,
        camera_id=request.camera_id,
        lens_id=request.lens_id,
        focal_length=request.focal_length,
        aperture=request.aperture,
    )
    return {"prompt": full_prompt}
