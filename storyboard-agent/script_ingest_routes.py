"""FastAPI route exposing the Phase 2 screenplay ingestion pipeline."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from viMax_port.idea_ingester import ingest_idea
from viMax_port.screenplay_ingester import ingest_screenplay
from viMax_port.types import IngestionResult


router = APIRouter()


class ScriptIngestRequest(BaseModel):
    storyboardId: str
    screenplay: str = Field(min_length=20, max_length=60_000)
    style: str = Field(max_length=200)
    userRequirement: str = Field(default="", max_length=1000)
    mediaBaseUrl: str = Field(default="http://localhost:3000")


class IdeaIngestRequest(BaseModel):
    storyboardId: str
    idea: str = Field(min_length=5, max_length=4_000)
    style: str = Field(max_length=200)
    userRequirement: str = Field(default="", max_length=1000)
    mediaBaseUrl: str = Field(default="http://localhost:3000")


@router.post(
    "/script-ingest",
    response_model=IngestionResult,
    # Exclude None values from the response. Dreamweaver's Convex mutations
    # validate optional fields as `v.optional(v.string())` which means "absent
    # OR string" — not "nullable". Letting FastAPI serialize Pydantic `None`
    # as JSON `null` triggers ArgumentValidationError in `bulkCreateNodes`.
    response_model_exclude_none=True,
)
async def script_ingest(
    payload: ScriptIngestRequest,
    authorization: Optional[str] = Header(default=None),
) -> IngestionResult:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer auth token")
    token = authorization.split(" ", 1)[1]
    try:
        return await ingest_screenplay(
            storyboard_id=payload.storyboardId,
            screenplay=payload.screenplay,
            style=payload.style,
            user_requirement=payload.userRequirement,
            media_base_url=payload.mediaBaseUrl,
            auth_token=token,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {exc}")


@router.post(
    "/idea-ingest",
    response_model=IngestionResult,
    # Same rationale as /script-ingest: Convex rejects JSON null for
    # v.optional fields, so we excise them at the wire.
    response_model_exclude_none=True,
)
async def idea_ingest(
    payload: IdeaIngestRequest,
    authorization: Optional[str] = Header(default=None),
) -> IngestionResult:
    """M3 Phase 1 — Idea2Video. Runs ViMax's Screenwriter to develop a story
    and decompose it into scene scripts, then hands off to the M1 screenplay
    ingester pipeline. Returns the same IngestionResult shape so Next.js
    can reuse the portrait + Convex write flow without changes."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer auth token")
    token = authorization.split(" ", 1)[1]
    try:
        return await ingest_idea(
            storyboard_id=payload.storyboardId,
            idea=payload.idea,
            style=payload.style,
            user_requirement=payload.userRequirement,
            media_base_url=payload.mediaBaseUrl,
            auth_token=token,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Idea ingestion failed: {exc}")
