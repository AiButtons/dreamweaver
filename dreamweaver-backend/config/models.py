"""Model registry and configuration."""

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel


class ModelCapability(str, Enum):
    IMAGE_GEN = "image_gen"
    IMAGE_EDIT = "image_edit"
    VIDEO_GEN = "video_gen"
    VIDEO_EDIT = "video_edit"
    CAMERA_CONTROL = "camera_control"
    AUDIO = "audio"
    HD = "hd"
    FOUR_K = "4k"
    FAST = "fast"


class ModelProvider(str, Enum):
    OPENAI = "openai"
    FAL = "fal"
    REPLICATE = "replicate"
    KLING = "kling"
    MODAL = "modal"
    LOCAL = "local"


class ModelConfig(BaseModel):
    id: str
    name: str
    provider: ModelProvider
    capabilities: List[ModelCapability]
    description: str
    max_resolution: Optional[str] = None
    max_duration: Optional[str] = None
    enabled: bool = True


# Model Registry
IMAGE_MODELS: List[ModelConfig] = [
    ModelConfig(
        id="dall-e-3",
        name="DALL·E 3",
        provider=ModelProvider.OPENAI,
        capabilities=[ModelCapability.IMAGE_GEN, ModelCapability.HD],
        description="OpenAI's most advanced image generation model",
        max_resolution="1792x1024",
    ),
    ModelConfig(
        id="gpt-image-1",
        name="GPT Image",
        provider=ModelProvider.OPENAI,
        capabilities=[ModelCapability.IMAGE_GEN, ModelCapability.IMAGE_EDIT, ModelCapability.HD],
        description="Native image generation with GPT-4o",
        max_resolution="2048x2048",
    ),
]

VIDEO_MODELS: List[ModelConfig] = [
    ModelConfig(
        id="sora-2",
        name="Sora 2",
        provider=ModelProvider.OPENAI,
        capabilities=[ModelCapability.VIDEO_GEN, ModelCapability.AUDIO, ModelCapability.HD],
        description="OpenAI's most advanced video model",
        max_resolution="1080p",
        max_duration="12s",
    ),
]

EDIT_MODELS: List[ModelConfig] = [
    ModelConfig(
        id="gpt-image-1",
        name="GPT Image Edit",
        provider=ModelProvider.OPENAI,
        capabilities=[ModelCapability.IMAGE_EDIT, ModelCapability.HD],
        description="Edit images with natural language",
        max_resolution="2048x2048",
    ),
]


def get_models_by_type(model_type: str) -> List[ModelConfig]:
    """Get models filtered by type."""
    if model_type == "image":
        return IMAGE_MODELS
    elif model_type == "video":
        return VIDEO_MODELS
    elif model_type == "edit":
        return EDIT_MODELS
    return []
