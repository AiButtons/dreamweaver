"""Idea2Video coordinator — M3 Phase 1.

Takes a one-liner idea + optional user requirement, runs ViMax's Screenwriter
to turn it into a full narrative + a list of per-scene screenplay strings,
then hands off to the M1 screenplay ingester to produce characters, portrait
prompts, shot metadata and edges. The result is an `IngestionResult` with
the exact same shape M1 returns, plus a `generatedStory` diagnostic field
so the Next.js route can optionally surface the intermediate prose.

Scene scripts from Screenwriter are joined with `CUT TO:` transitions so the
screenplay preprocessor sees a coherent multi-scene document (instead of N
isolated snippets) and the resulting storyboard reads as one linear arc.
"""

from __future__ import annotations

from typing import List, Optional

from .llm_factory import make_chat_model
from .screenplay_ingester import EventEmitter, _emit, ingest_screenplay
from .screenwriter import Screenwriter
from .types import IngestionResult


def _join_scenes(scenes: List[str]) -> str:
    """Join per-scene screenplay strings into one document. Scenes are
    already in screenplay format (slug lines + action + dialogue); we just
    normalize separation so the preprocessor downstream sees the
    transitions and scene boundaries clearly. Empty entries are filtered
    before adding `CUT TO:` transitions so we don't emit dangling ones."""
    cleaned = [s.strip() for s in scenes if s and s.strip()]
    if not cleaned:
        return ""
    parts: List[str] = []
    for i, scene in enumerate(cleaned):
        parts.append(scene)
        if i < len(cleaned) - 1:
            parts.append("\n\nCUT TO:\n")
    return "\n\n".join(parts)


async def ingest_idea(
    *,
    storyboard_id: str,
    idea: str,
    style: str,
    user_requirement: str,
    media_base_url: str = "",
    auth_token: str = "",
    event_emitter: Optional[EventEmitter] = None,
) -> IngestionResult:
    """Pipeline:
      1) develop_story(idea, user_requirement) → narrative prose
      2) write_script_based_on_story(story, user_requirement) → List[str]
      3) join scenes → one screenplay document
      4) hand off to ingest_screenplay(...) which does preprocessor →
         character extraction → storyboard design → shot decomposition →
         3-view portrait prompts → mapper.

    Adds 2 LLM calls on top of M1's baseline (develop_story + write_script).
    Emits `developing_story` + `writing_script` events before delegating, so
    clients see these stages *before* the downstream screenplay events fire.
    """
    chat_model = make_chat_model()
    writer = Screenwriter(chat_model=chat_model)

    await _emit(event_emitter, "developing_story", 1.0, "Developing a narrative from the idea")
    story = await writer.develop_story(
        idea=idea,
        user_requirement=user_requirement or None,
    )
    await _emit(
        event_emitter,
        "writing_script",
        8.0,
        f"Story ready ({len(story)} chars) — splitting into scenes",
    )
    scenes = await writer.write_script_based_on_story(
        story=story,
        user_requirement=user_requirement or None,
    )
    screenplay = _join_scenes(scenes)
    await _emit(
        event_emitter,
        "preprocessing",
        14.0,
        f"Wrote {len(scenes)} scene{'s' if len(scenes) != 1 else ''} — handing off to screenplay ingestion",
    )

    # Downstream ingester produces the IngestionResult. It will run its own
    # preprocessor (screenplay_preprocessor) against the joined document —
    # since each scene already carries INT./EXT./CUT TO: markers the
    # preprocessor will normalize to prose before feeding character_extractor.
    result = await ingest_screenplay(
        storyboard_id=storyboard_id,
        screenplay=screenplay,
        style=style,
        user_requirement=user_requirement,
        media_base_url=media_base_url,
        auth_token=auth_token,
        event_emitter=event_emitter,
    )
    # Bump the LLM call count to reflect the two extra Screenwriter calls
    # we made here; keep the downstream pipelineDurationMs as reported
    # (it covers only the screenplay-ingest portion, intentionally, so the
    # Next.js side can reason about each stage independently if needed).
    result.llmCallCount = (result.llmCallCount or 0) + 2
    return result
