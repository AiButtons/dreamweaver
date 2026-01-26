"""
Image Generation API endpoints.

Uses the provider registry to route requests to the appropriate
AI provider based on the requested model.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Any
import traceback

from config.settings import settings
from services.prompt_builder import build_full_prompt
from providers import (
    ProviderRegistry,
    ImageGenerationRequest as ProviderRequest,
    ImageGenerationResponse as ProviderResponse,
    ImageEditRequest as ProviderEditRequest,
    ImageSize,
    ImageQuality,
    ImageStyle,
    ProviderError,
)

router = APIRouter()


# ============================================================================
# Request/Response Models (API-facing)
# ============================================================================

class ImageGenerationRequest(BaseModel):
    """API request model for image generation."""
    prompt: Optional[str] = None
    input_image: Optional[str] = None  # base64
    
    # Camera parameters
    azimuth: float = 0
    elevation: float = 0
    distance: float = 1.0
    camera_id: Optional[str] = None
    lens_id: Optional[str] = None
    focal_length: int = 35
    aperture: str = "f/11"
    
    # Generation settings
    aspect_ratio: str = "16:9"
    resolution: str = "fhd"
    batch_size: int = 1
    quality: str = "standard"
    style: Optional[str] = None
    
    # Model selection
    model_id: str = "gpt-image-1"
    
    # Advanced parameters (for Modal/custom providers)
    n_steps: Optional[int] = None
    guidance_scale: Optional[float] = None
    seed: Optional[int] = None


class ImageEditAPIRequest(BaseModel):
    """API request model for image editing."""
    prompt: str
    image: str  # base64
    mask: Optional[str] = None  # base64
    model_id: str = "gpt-image-1"
    size: str = "1024x1024"
    n: int = 1
    extra_params: Optional[dict] = None  # For Modal/Qwen specific params


class ImageGenerationResponse(BaseModel):
    """API response model for image generation."""
    id: str
    prompt: str
    model: str
    images: list[dict[str, Any]]


# ============================================================================
# Helper Functions
# ============================================================================

def map_resolution_to_size(resolution: str, aspect_ratio: str) -> ImageSize:
    """Map resolution and aspect ratio to ImageSize enum."""
    # Default mappings
    if aspect_ratio in ["16:9", "21:9"]:
        return ImageSize.LANDSCAPE_HD
    elif aspect_ratio in ["9:16", "2:3"]:
        return ImageSize.PORTRAIT_HD
    elif aspect_ratio in ["1:1"]:
        if resolution in ["4k", "2k"]:
            return ImageSize.SQUARE_2K
        return ImageSize.SQUARE_LG
    else:
        return ImageSize.SQUARE_LG


def map_quality(quality: str) -> ImageQuality:
    """Map quality string to ImageQuality enum."""
    quality_map = {
        "low": ImageQuality.LOW,
        "medium": ImageQuality.MEDIUM,
        "standard": ImageQuality.STANDARD,
        "high": ImageQuality.HIGH,
        "hd": ImageQuality.HD,
    }
    return quality_map.get(quality, ImageQuality.STANDARD)


# ============================================================================
# Endpoints
# ============================================================================

@router.post("/generate", response_model=ImageGenerationResponse)
async def generate_image(request: ImageGenerationRequest):
    """
    Generate images from visual parameters.
    
    Routes the request to the appropriate AI provider based on model_id.
    """
    
    # Build the full prompt from visual parameters
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
    
    # Get the provider for this model
    try:
        provider = ProviderRegistry.get_image_provider(request.model_id)
    except ProviderError as e:
        raise HTTPException(status_code=400, detail=str(e.message))
    
    # Build provider request
    provider_request = ProviderRequest(
        prompt=request.prompt or "",
        model_id=request.model_id,
        size=map_resolution_to_size(request.resolution, request.aspect_ratio),
        quality=map_quality(request.quality),
        style=ImageStyle(request.style) if request.style else None,
        n=request.batch_size,
        camera_prompt=full_prompt if request.prompt else None,
        extra_params={
            # Pass through advanced parameters for Modal provider
            "n_steps": getattr(request, "n_steps", None),
            "guidance_scale": getattr(request, "guidance_scale", None),
            "seed": getattr(request, "seed", None),
        },
    )
    
    # Generate
    try:
        response = await provider.generate(provider_request)
        
        return ImageGenerationResponse(
            id=response.id,
            prompt=full_prompt,
            model=response.model,
            images=[
                {
                    "url": img.url,
                    "b64_json": img.b64_json,
                    "revised_prompt": img.revised_prompt,
                }
                for img in response.images
            ],
        )
    except ProviderError as e:
        raise HTTPException(
            status_code=e.status_code or 500,
            detail={
                "error": e.message,
                "provider": e.provider,
                "code": e.error_code,
            },
        )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/edit", response_model=ImageGenerationResponse)
async def edit_image(request: ImageEditAPIRequest):
    """
    Edit an image using AI.
    
    Supports inpainting, outpainting, and general editing.
    """
    
    # Get the provider
    try:
        provider = ProviderRegistry.get_image_provider(request.model_id)
    except ProviderError as e:
        raise HTTPException(status_code=400, detail=str(e.message))
    
    # Build provider request
    provider_request = ProviderEditRequest(
        prompt=request.prompt,
        model_id=request.model_id,
        image=request.image,
        mask=request.mask,
        n=request.n,
        extra_params=request.extra_params or {},
    )
    
    # Edit
    try:
        response = await provider.edit(provider_request)
        
        return ImageGenerationResponse(
            id=response.id,
            prompt=request.prompt,
            model=response.model,
            images=[
                {
                    "url": img.url,
                    "b64_json": img.b64_json,
                    "revised_prompt": img.revised_prompt,
                }
                for img in response.images
            ],
        )
    except ProviderError as e:
        raise HTTPException(
            status_code=e.status_code or 500,
            detail={
                "error": e.message,
                "provider": e.provider,
                "code": e.error_code,
            },
        )
    except Exception as e:
        traceback.print_exc()
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


@router.get("/models")
async def list_models():
    """List available image generation models."""
    from config.models import IMAGE_MODELS
    
    return {
        "models": [
            {
                "id": model.id,
                "name": model.name,
                "provider": model.provider.value,
                "description": model.description,
                "capabilities": [c.value for c in model.capabilities],
                "max_resolution": model.max_resolution,
            }
            for model in IMAGE_MODELS
        ]
    }
