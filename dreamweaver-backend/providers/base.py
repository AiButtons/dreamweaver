"""
Abstract base classes for AI providers.

This module defines the interfaces that all AI providers must implement,
ensuring consistent behavior and easy extensibility.
"""

from abc import ABC, abstractmethod
from typing import Optional, Any
from pydantic import BaseModel, Field
from enum import Enum


# ============================================================================
# Enums
# ============================================================================

class ImageSize(str, Enum):
    """Standard image sizes supported across providers."""
    SQUARE_SM = "256x256"
    SQUARE_MD = "512x512"
    SQUARE_LG = "1024x1024"
    LANDSCAPE_HD = "1792x1024"
    PORTRAIT_HD = "1024x1792"
    SQUARE_2K = "2048x2048"
    AUTO = "auto"


class ImageQuality(str, Enum):
    """Image quality settings."""
    LOW = "low"
    MEDIUM = "medium"
    STANDARD = "standard"
    HIGH = "high"
    HD = "hd"


class ImageStyle(str, Enum):
    """Image style presets."""
    NATURAL = "natural"
    VIVID = "vivid"
    CINEMATIC = "cinematic"


# ============================================================================
# Request Models
# ============================================================================

class ImageGenerationRequest(BaseModel):
    """Universal request model for image generation."""
    
    # Core parameters
    prompt: str = Field(..., description="Text description of the image to generate")
    model_id: str = Field(..., description="Model identifier (e.g., 'gpt-image-1', 'dall-e-3')")
    
    # Image settings
    size: ImageSize = Field(default=ImageSize.SQUARE_LG, description="Output image size")
    quality: ImageQuality = Field(default=ImageQuality.STANDARD, description="Image quality")
    style: Optional[ImageStyle] = Field(default=None, description="Style preset")
    n: int = Field(default=1, ge=1, le=10, description="Number of images to generate")
    
    # Input image (for edit/variation)
    input_image: Optional[str] = Field(default=None, description="Base64 encoded input image")
    mask: Optional[str] = Field(default=None, description="Base64 encoded mask for inpainting")
    
    # Camera/visual parameters
    camera_prompt: Optional[str] = Field(default=None, description="Camera angle/equipment prompt")
    
    # Provider-specific parameters (pass-through)
    extra_params: dict[str, Any] = Field(default_factory=dict, description="Provider-specific parameters")
    
    class Config:
        use_enum_values = True


class ImageEditRequest(BaseModel):
    """Request model for image editing operations."""
    
    prompt: str = Field(..., description="Edit instruction")
    model_id: str = Field(..., description="Model identifier")
    image: str = Field(..., description="Base64 encoded image to edit")
    mask: Optional[str] = Field(default=None, description="Base64 encoded mask")
    size: ImageSize = Field(default=ImageSize.SQUARE_LG)
    n: int = Field(default=1, ge=1, le=10)
    extra_params: dict[str, Any] = Field(default_factory=dict)


# ============================================================================
# Response Models
# ============================================================================

class GeneratedImage(BaseModel):
    """A single generated image."""
    url: Optional[str] = Field(default=None, description="URL to the generated image")
    b64_json: Optional[str] = Field(default=None, description="Base64 encoded image data")
    revised_prompt: Optional[str] = Field(default=None, description="Model's revised prompt")


class ImageGenerationResponse(BaseModel):
    """Universal response model for image generation."""
    
    id: str = Field(..., description="Unique generation ID")
    model: str = Field(..., description="Model used for generation")
    prompt: str = Field(..., description="Original prompt")
    images: list[GeneratedImage] = Field(..., description="Generated images")
    
    # Metadata
    created_at: int = Field(..., description="Unix timestamp of creation")
    usage: Optional[dict[str, Any]] = Field(default=None, description="Usage/billing info if available")
    
    class Config:
        from_attributes = True


class ProviderError(Exception):
    """Base exception for provider errors."""
    
    def __init__(
        self,
        message: str,
        provider: str,
        status_code: Optional[int] = None,
        error_code: Optional[str] = None,
    ):
        self.message = message
        self.provider = provider
        self.status_code = status_code
        self.error_code = error_code
        super().__init__(self.message)


# ============================================================================
# Abstract Base Classes
# ============================================================================

class ImageProvider(ABC):
    """
    Abstract base class for image generation providers.
    
    All image providers (OpenAI, FAL, Replicate, etc.) must implement this interface.
    """
    
    # Provider metadata
    provider_name: str
    supported_models: list[str]
    
    @abstractmethod
    async def generate(self, request: ImageGenerationRequest) -> ImageGenerationResponse:
        """
        Generate images from a text prompt.
        
        Args:
            request: Image generation request with all parameters
            
        Returns:
            ImageGenerationResponse with generated images
            
        Raises:
            ProviderError: If generation fails
        """
        pass
    
    @abstractmethod
    async def edit(self, request: ImageEditRequest) -> ImageGenerationResponse:
        """
        Edit an existing image based on a prompt.
        
        Args:
            request: Image edit request with source image and instructions
            
        Returns:
            ImageGenerationResponse with edited images
            
        Raises:
            ProviderError: If editing fails
        """
        pass
    
    def supports_model(self, model_id: str) -> bool:
        """Check if this provider supports the given model."""
        return model_id in self.supported_models
    
    def validate_request(self, request: ImageGenerationRequest) -> None:
        """
        Validate request parameters for this provider.
        Override in subclasses to add provider-specific validation.
        
        Raises:
            ValueError: If request is invalid
        """
        if not self.supports_model(request.model_id):
            raise ValueError(f"Model '{request.model_id}' not supported by {self.provider_name}")


class VideoProvider(ABC):
    """
    Abstract base class for video generation providers.
    
    For future video generation support (Sora, Kling, etc.)
    """
    
    provider_name: str
    supported_models: list[str]
    
    @abstractmethod
    async def generate(self, request: Any) -> Any:
        """Generate video from prompt or image."""
        pass
    
    @abstractmethod
    async def extend(self, request: Any) -> Any:
        """Extend an existing video."""
        pass
