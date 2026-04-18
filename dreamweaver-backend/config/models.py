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
    INPAINTING = "inpainting"
    OUTPAINTING = "outpainting"


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
    premium: bool = False


# ============================================================================
# Image Generation Models
# ============================================================================

IMAGE_MODELS: List[ModelConfig] = [
    ModelConfig(
        id="gpt-image-1",
        name="GPT Image 1.5",
        provider=ModelProvider.OPENAI,
        capabilities=[
            ModelCapability.IMAGE_GEN,
            ModelCapability.IMAGE_EDIT,
            ModelCapability.INPAINTING,
            ModelCapability.OUTPAINTING,
            ModelCapability.HD,
        ],
        description="OpenAI's latest flagship image generation model with native editing",
        max_resolution="1536x1536",
        premium=True,
    ),
    ModelConfig(
        id="dall-e-3",
        name="DALL·E 3",
        provider=ModelProvider.OPENAI,
        capabilities=[ModelCapability.IMAGE_GEN, ModelCapability.HD],
        description="High-quality image generation with prompt revision",
        max_resolution="1792x1024",
    ),
    ModelConfig(
        id="dall-e-2",
        name="DALL·E 2",
        provider=ModelProvider.OPENAI,
        capabilities=[
            ModelCapability.IMAGE_GEN,
            ModelCapability.IMAGE_EDIT,
            ModelCapability.INPAINTING,
            ModelCapability.FAST,
        ],
        description="Fast and reliable image generation",
        max_resolution="1024x1024",
    ),
    ModelConfig(
        id="zennah-image-gen",
        name="Zennah Image Gen",
        provider=ModelProvider.MODAL,
        capabilities=[ModelCapability.IMAGE_GEN, ModelCapability.HD, ModelCapability.CAMERA_CONTROL],
        description="High-quality cinematic image generation with camera controls",
        max_resolution="1024x768",
        premium=False,
    ),
    ModelConfig(
        id="zennah-qwen-edit",
        name="Zennah Multi-Angle",
        provider=ModelProvider.MODAL,
        capabilities=[ModelCapability.IMAGE_EDIT, ModelCapability.CAMERA_CONTROL],
        description="Consistent multi-angle view generation from single image",
        max_resolution="1024x768",
        premium=False,
    ),
    ModelConfig(
        id="zennah-qwen-multiview",
        name="Zennah Multi-View",
        provider=ModelProvider.MODAL,
        capabilities=[ModelCapability.IMAGE_EDIT],
        description="Automatic 3-angle view generation (LoRA)",
        max_resolution="1024x768",
        premium=False,
    ),
]


# ============================================================================
# Video Generation Models
# ============================================================================

VIDEO_MODELS: List[ModelConfig] = [
    ModelConfig(
        id="ltx-2.3",
        name="LTX-2.3",
        provider=ModelProvider.MODAL,
        capabilities=[
            ModelCapability.VIDEO_GEN,
            ModelCapability.HD,
            ModelCapability.CAMERA_CONTROL,
        ],
        description="Lightricks LTX-2.3 (22B DiT) — I2V + keyframe interpolation + retake",
        max_resolution="1536x1024",
        max_duration="10.7s",
    ),
    ModelConfig(
        id="ltx-2",
        name="LTX-2",
        provider=ModelProvider.MODAL,
        capabilities=[
            ModelCapability.VIDEO_GEN,
            ModelCapability.CAMERA_CONTROL,
        ],
        description="Legacy LTX-2 video model (predecessor to LTX-2.3)",
        max_resolution="1280x704",
        max_duration="10s",
    ),
    ModelConfig(
        id="veo-3.1",
        name="Veo 3.1",
        provider=ModelProvider.OPENAI,  # Google provider key re-uses this enum slot for now
        capabilities=[
            ModelCapability.VIDEO_GEN,
            ModelCapability.AUDIO,
            ModelCapability.HD,
            ModelCapability.CAMERA_CONTROL,
        ],
        description="Google DeepMind Veo 3.1 video model",
        max_resolution="1080p",
        max_duration="12s",
        enabled=False,  # placeholder until Vertex credentials are wired
    ),
    ModelConfig(
        id="sora-2",
        name="Sora 2",
        provider=ModelProvider.OPENAI,
        capabilities=[
            ModelCapability.VIDEO_GEN,
            ModelCapability.AUDIO,
            ModelCapability.HD,
            ModelCapability.CAMERA_CONTROL,
        ],
        description="OpenAI's most advanced video generation model",
        max_resolution="1080p",
        max_duration="12s",
        enabled=False,  # Not yet available
    ),
]


# ============================================================================
# Edit Models
# ============================================================================

EDIT_MODELS: List[ModelConfig] = [
    ModelConfig(
        id="gpt-image-1",
        name="GPT Image Edit",
        provider=ModelProvider.OPENAI,
        capabilities=[
            ModelCapability.IMAGE_EDIT,
            ModelCapability.INPAINTING,
            ModelCapability.OUTPAINTING,
            ModelCapability.HD,
        ],
        description="Edit images with natural language using GPT-4o",
        max_resolution="1536x1536",
    ),
]


# ============================================================================
# Helper Functions
# ============================================================================

def get_models_by_type(model_type: str) -> List[ModelConfig]:
    """Get models filtered by type."""
    if model_type == "image":
        return [m for m in IMAGE_MODELS if m.enabled]
    elif model_type == "video":
        return [m for m in VIDEO_MODELS if m.enabled]
    elif model_type == "edit":
        return [m for m in EDIT_MODELS if m.enabled]
    return []


def get_model_by_id(model_id: str) -> Optional[ModelConfig]:
    """Get a specific model by ID."""
    all_models = IMAGE_MODELS + VIDEO_MODELS + EDIT_MODELS
    for model in all_models:
        if model.id == model_id:
            return model
    return None


def get_enabled_models() -> List[ModelConfig]:
    """Get all enabled models."""
    all_models = IMAGE_MODELS + VIDEO_MODELS + EDIT_MODELS
    return [m for m in all_models if m.enabled]
