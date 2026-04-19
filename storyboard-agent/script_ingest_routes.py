"""FastAPI route exposing the Phase 2 screenplay ingestion pipeline."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from viMax_port.screenplay_ingester import ingest_screenplay
from viMax_port.types import IngestionResult


router = APIRouter()


class ScriptIngestRequest(BaseModel):
    storyboardId: str
    screenplay: str = Field(min_length=20, max_length=60_000)
    style: str = Field(max_length=200)
    userRequirement: str = Field(default="", max_length=1000)
    mediaBaseUrl: str = Field(default="http://localhost:3000")


@router.post("/script-ingest", response_model=IngestionResult)
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
