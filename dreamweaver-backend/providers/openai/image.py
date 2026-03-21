"""
OpenAI Image Provider - Supports DALL-E and GPT-Image models.

This provider implements the ImageProvider interface for OpenAI's
image generation models including:
- gpt-image-1 (GPT Image 1.5)
- dall-e-3
- dall-e-2
"""

import time
import base64
from typing import Optional

from openai import AsyncOpenAI
from openai import OpenAIError, APIError, RateLimitError, AuthenticationError

from ..base import (
    ImageProvider,
    ImageGenerationRequest,
    ImageEditRequest,
    ImageGenerationResponse,
    GeneratedImage,
    ImageSize,
    ImageQuality,
    ProviderError,
)
from config.settings import settings


class OpenAIImageProvider(ImageProvider):
    """
    OpenAI image generation provider.
    
    Supports:
    - gpt-image-1: OpenAI's new flagship image model
    - dall-e-3: DALL-E 3 with prompt revision
    - dall-e-2: Legacy DALL-E 2
    """
    
    provider_name = "openai"
    supported_models = ["gpt-image-1", "dall-e-3", "dall-e-2"]
    
    # Model-specific size mappings
    SIZE_MAP = {
        "gpt-image-1": {
            ImageSize.SQUARE_SM: "1024x1024",
            ImageSize.SQUARE_MD: "1024x1024",
            ImageSize.SQUARE_LG: "1024x1024",
            ImageSize.LANDSCAPE_HD: "1536x1024",
            ImageSize.PORTRAIT_HD: "1024x1536",
            ImageSize.SQUARE_2K: "1024x1024",  # Max supported
            ImageSize.AUTO: "auto",
        },
        "dall-e-3": {
            ImageSize.SQUARE_SM: "1024x1024",
            ImageSize.SQUARE_MD: "1024x1024",
            ImageSize.SQUARE_LG: "1024x1024",
            ImageSize.LANDSCAPE_HD: "1792x1024",
            ImageSize.PORTRAIT_HD: "1024x1792",
            ImageSize.SQUARE_2K: "1024x1024",
            ImageSize.AUTO: "1024x1024",
        },
        "dall-e-2": {
            ImageSize.SQUARE_SM: "256x256",
            ImageSize.SQUARE_MD: "512x512",
            ImageSize.SQUARE_LG: "1024x1024",
            ImageSize.LANDSCAPE_HD: "1024x1024",
            ImageSize.PORTRAIT_HD: "1024x1024",
            ImageSize.SQUARE_2K: "1024x1024",
            ImageSize.AUTO: "1024x1024",
        },
    }
    
    # Quality mappings per model
    QUALITY_MAP = {
        "gpt-image-1": {
            ImageQuality.LOW: "low",
            ImageQuality.MEDIUM: "medium",
            ImageQuality.STANDARD: "medium",
            ImageQuality.HIGH: "high",
            ImageQuality.HD: "high",
        },
        "dall-e-3": {
            ImageQuality.LOW: "standard",
            ImageQuality.MEDIUM: "standard",
            ImageQuality.STANDARD: "standard",
            ImageQuality.HIGH: "hd",
            ImageQuality.HD: "hd",
        },
        "dall-e-2": {
            # DALL-E 2 doesn't support quality
        },
    }
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize OpenAI provider.
        
        Args:
            api_key: OpenAI API key (defaults to settings.openai_api_key)
        """
        self.api_key = api_key or settings.openai_api_key
        if not self.api_key:
            print("OpenAI API key not configured - mock responses will be used")
        self._client: Optional[AsyncOpenAI] = None
    
    @property
    def client(self) -> AsyncOpenAI:
        """Lazy initialization of async client."""
        if self._client is None:
            self._client = AsyncOpenAI(api_key=self.api_key)
        return self._client
    
    def _map_size(self, model_id: str, size: ImageSize) -> str:
        """Map generic size to model-specific size."""
        model_sizes = self.SIZE_MAP.get(model_id, self.SIZE_MAP["dall-e-3"])
        return model_sizes.get(size, "1024x1024")
    
    def _map_quality(self, model_id: str, quality: ImageQuality) -> Optional[str]:
        """Map generic quality to model-specific quality."""
        model_qualities = self.QUALITY_MAP.get(model_id, {})
        return model_qualities.get(quality)
    
    async def generate(self, request: ImageGenerationRequest) -> ImageGenerationResponse:
        """
        Generate images using OpenAI models.
        
        Args:
            request: Image generation request
            
        Returns:
            ImageGenerationResponse with generated images
        """
        self.validate_request(request)
        
        # Build the full prompt (include camera prompt if provided)
        full_prompt = request.prompt
        if request.camera_prompt:
            full_prompt = f"{request.prompt}. {request.camera_prompt}"
        
        # Map parameters
        size = self._map_size(request.model_id, request.size)
        quality = self._map_quality(request.model_id, request.quality)
        
        # If no API key, return mock response
        if not self.api_key:
            return self._mock_response(request, full_prompt)
        
        try:
            # Build API call params
            params = {
                "model": request.model_id,
                "prompt": full_prompt,
                "n": request.n,
            }
            
            # Add size (different param for gpt-image-1)
            if request.model_id == "gpt-image-1":
                if size != "auto":
                    params["size"] = size
            else:
                params["size"] = size
            
            # Add quality if supported
            if quality and request.model_id != "dall-e-2":
                params["quality"] = quality
            
            # Add style for DALL-E 3
            if request.model_id == "dall-e-3" and request.style:
                params["style"] = request.style
            
            
            # Note: extra_params (n_steps, guidance_scale, seed) are Modal-specific
            # and not supported by OpenAI, so we don't include them
            
            # Make API call
            response = await self.client.images.generate(**params)
            
            # Build response
            images = []
            for img_data in response.data:
                images.append(GeneratedImage(
                    url=img_data.url,
                    b64_json=getattr(img_data, "b64_json", None),
                    revised_prompt=getattr(img_data, "revised_prompt", None),
                ))
            
            return ImageGenerationResponse(
                id=str(response.created),
                model=request.model_id,
                prompt=full_prompt,
                images=images,
                created_at=response.created,
            )
            
        except AuthenticationError as e:
            raise ProviderError(
                message="Invalid OpenAI API key",
                provider=self.provider_name,
                status_code=401,
                error_code="AUTHENTICATION_ERROR",
            ) from e
        except RateLimitError as e:
            raise ProviderError(
                message="OpenAI rate limit exceeded",
                provider=self.provider_name,
                status_code=429,
                error_code="RATE_LIMIT_ERROR",
            ) from e
        except APIError as e:
            raise ProviderError(
                message=str(e),
                provider=self.provider_name,
                status_code=getattr(e, "status_code", 500),
                error_code="API_ERROR",
            ) from e
        except OpenAIError as e:
            raise ProviderError(
                message=str(e),
                provider=self.provider_name,
                error_code="OPENAI_ERROR",
            ) from e
    
    async def edit(self, request: ImageEditRequest) -> ImageGenerationResponse:
        """
        Edit an image using OpenAI models.
        
        Args:
            request: Image edit request with source image
            
        Returns:
            ImageGenerationResponse with edited images
        """
        if not self.api_key:
            return self._mock_response_edit(request)
        
        try:
            # Decode base64 image
            image_bytes = base64.b64decode(request.image)
            
            # Prepare mask if provided
            mask_bytes = None
            if request.mask:
                mask_bytes = base64.b64decode(request.mask)
            
            # Map size
            size = self._map_size(request.model_id, request.size)
            
            # Make API call (no extra_params - Modal-specific)
            response = await self.client.images.edit(
                model=request.model_id,
                image=image_bytes,
                mask=mask_bytes,
                prompt=request.prompt,
                n=request.n,
                size=size,
            )
            
            # Build response
            images = []
            for img_data in response.data:
                images.append(GeneratedImage(
                    url=img_data.url,
                    b64_json=getattr(img_data, "b64_json", None),
                    revised_prompt=getattr(img_data, "revised_prompt", None),
                ))
            
            return ImageGenerationResponse(
                id=str(response.created),
                model=request.model_id,
                prompt=request.prompt,
                images=images,
                created_at=response.created,
            )
            
        except OpenAIError as e:
            raise ProviderError(
                message=str(e),
                provider=self.provider_name,
                error_code="OPENAI_ERROR",
            ) from e
    
    def _mock_response(
        self, request: ImageGenerationRequest, full_prompt: str
    ) -> ImageGenerationResponse:
        """Generate a mock response for testing without API key."""
        created = int(time.time())
        images = [
            GeneratedImage(
                url=f"https://via.placeholder.com/1024?text={request.model_id}",
                revised_prompt=full_prompt if request.model_id == "dall-e-3" else None,
            )
            for _ in range(request.n)
        ]
        return ImageGenerationResponse(
            id=f"mock-{created}",
            model=request.model_id,
            prompt=full_prompt,
            images=images,
            created_at=created,
        )
    
    def _mock_response_edit(self, request: ImageEditRequest) -> ImageGenerationResponse:
        """Generate a mock response for edit operations."""
        created = int(time.time())
        images = [
            GeneratedImage(url="https://via.placeholder.com/1024?text=edited")
            for _ in range(request.n)
        ]
        return ImageGenerationResponse(
            id=f"mock-edit-{created}",
            model=request.model_id,
            prompt=request.prompt,
            images=images,
            created_at=created,
        )

