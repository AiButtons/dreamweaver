"""FastAPI routes exposing the Phase 2 screenplay ingestion pipeline.

M3 #2 adds streaming (SSE) variants of both endpoints. The coordinators
call an `event_emitter(stage, percent, message, extra)` callback at stage
boundaries; the streaming endpoints wrap each coordinator with an
`asyncio.Queue`, feed the callback into it, and drain the queue to the
client via `StreamingResponse` with `text/event-stream`.

Non-streaming endpoints are retained unchanged for backwards compat."""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator, Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
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


# ---------------------------------------------------------------------------
# Streaming (SSE) variants — M3 #2
# ---------------------------------------------------------------------------


def _sse_format(event_type: str, payload: Any) -> bytes:
    """Serialize one SSE frame. `event: <type>\\n` lets the client dispatch
    on `addEventListener("stage", ...)` etc.; the body is always JSON."""
    body = json.dumps(payload, ensure_ascii=False)
    return f"event: {event_type}\ndata: {body}\n\n".encode("utf-8")


async def _run_with_event_stream(
    coroutine_factory,
) -> AsyncIterator[bytes]:
    """Turn a coordinator + event_emitter callback into an SSE byte stream.

    The coordinator runs in a background task; the callback enqueues events
    into an asyncio.Queue which this generator drains and formats. When the
    coordinator finishes, we emit a final `result` event with its return
    value (or `error` on exception) and close the stream.
    """
    queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

    async def emitter(stage: str, percent: float, message: str, extra: dict) -> None:
        await queue.put(
            (
                "stage",
                {
                    "stage": stage,
                    "percentComplete": percent,
                    "statusMessage": message,
                    **extra,
                },
            )
        )

    async def runner() -> None:
        try:
            result = await coroutine_factory(emitter)
            # Pydantic model → dict, excluding None values so the final
            # payload matches the non-streaming shape.
            await queue.put(
                (
                    "result",
                    result.model_dump(exclude_none=True) if hasattr(result, "model_dump") else result,
                )
            )
        except Exception as exc:
            await queue.put(("error", {"message": str(exc), "type": type(exc).__name__}))
        finally:
            await queue.put(("__done__", None))

    task = asyncio.create_task(runner())
    try:
        # Eager open: emit a heartbeat immediately so the client's stream
        # unblocks and the progress bar starts rendering.
        yield _sse_format("open", {"ok": True})
        while True:
            event_type, payload = await queue.get()
            if event_type == "__done__":
                break
            yield _sse_format(event_type, payload)
    finally:
        if not task.done():
            task.cancel()


@router.post("/script-ingest-stream")
async def script_ingest_stream(
    payload: ScriptIngestRequest,
    authorization: Optional[str] = Header(default=None),
) -> StreamingResponse:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer auth token")
    token = authorization.split(" ", 1)[1]

    async def factory(emitter):
        return await ingest_screenplay(
            storyboard_id=payload.storyboardId,
            screenplay=payload.screenplay,
            style=payload.style,
            user_requirement=payload.userRequirement,
            media_base_url=payload.mediaBaseUrl,
            auth_token=token,
            event_emitter=emitter,
        )

    return StreamingResponse(
        _run_with_event_stream(factory),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/idea-ingest-stream")
async def idea_ingest_stream(
    payload: IdeaIngestRequest,
    authorization: Optional[str] = Header(default=None),
) -> StreamingResponse:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer auth token")
    token = authorization.split(" ", 1)[1]

    async def factory(emitter):
        return await ingest_idea(
            storyboard_id=payload.storyboardId,
            idea=payload.idea,
            style=payload.style,
            user_requirement=payload.userRequirement,
            media_base_url=payload.mediaBaseUrl,
            auth_token=token,
            event_emitter=emitter,
        )

    return StreamingResponse(
        _run_with_event_stream(factory),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
