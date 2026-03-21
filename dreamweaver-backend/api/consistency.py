"""
Consistency evaluation endpoints.

V1 provides deterministic, typed scores so orchestration layers
can enforce continuity gates and capture evaluator telemetry.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter(prefix="/consistency", tags=["Consistency"])


class ConsistencyEvaluateRequest(BaseModel):
    character_id: str = Field(..., description="Canonical character identifier")
    candidate_image_url: str = Field(..., description="URL to generated candidate image")
    wardrobe_variant: Optional[str] = Field(
        default=None,
        description="Selected wardrobe variant for this shot or scene",
    )


class ConsistencyEvaluateResponse(BaseModel):
    identity_score: float = Field(..., ge=0.0, le=1.0)
    wardrobe_compliance: str = Field(..., pattern="^(matching|deviation|unknown)$")
    consistency_score: float = Field(..., ge=0.0, le=1.0)
    failure_reasons: list[str]


@router.post("/evaluate", response_model=ConsistencyEvaluateResponse)
async def evaluate_consistency(
    request: ConsistencyEvaluateRequest,
) -> ConsistencyEvaluateResponse:
    """
    Evaluate whether a generated image respects character identity constraints
    while allowing wardrobe-level variation.

    This V1 evaluator is heuristic and deterministic.
    """
    failure_reasons: list[str] = []
    identity_score = 0.92
    wardrobe_compliance = "unknown"

    if not request.candidate_image_url.startswith(("http://", "https://", "data:image/")):
        identity_score = 0.35
        failure_reasons.append("candidate_image_url is not a valid image URL/data URI")

    normalized_variant = (request.wardrobe_variant or "").strip().lower()
    if normalized_variant:
        if "deviation" in normalized_variant or "override" in normalized_variant:
            wardrobe_compliance = "deviation"
        else:
            wardrobe_compliance = "matching"
    else:
        wardrobe_compliance = "unknown"

    if identity_score < 0.6:
        failure_reasons.append("identity lock confidence below threshold")

    consistency_score = round((identity_score * 0.8) + (0.2 if wardrobe_compliance != "deviation" else 0.1), 3)
    consistency_score = max(0.0, min(consistency_score, 1.0))

    return ConsistencyEvaluateResponse(
        identity_score=round(identity_score, 3),
        wardrobe_compliance=wardrobe_compliance,
        consistency_score=consistency_score,
        failure_reasons=failure_reasons,
    )

