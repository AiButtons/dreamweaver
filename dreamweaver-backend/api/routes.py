from fastapi import APIRouter
from api.image import router as image_router
from api.video import router as video_router
from api.consistency import router as consistency_router
from config.models import get_models_by_type

router = APIRouter()

# Include sub-routers
router.include_router(image_router, prefix="/image", tags=["Image Generation"])
router.include_router(video_router, prefix="/video", tags=["Video Generation"])
router.include_router(consistency_router, tags=["Consistency"])


@router.get("/models")
async def list_models(type: str = "image"):
    """List available models by type (image, video, edit)."""
    models = get_models_by_type(type)
    return {
        "type": type,
        "models": [model.model_dump() for model in models if model.enabled],
    }
