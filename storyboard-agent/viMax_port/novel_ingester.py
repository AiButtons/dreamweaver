"""Novel2Video coordinator — M3 Phase 2.

Pipeline:
    1) Split + compress + aggregate the novel into one continuous narrative
    2) Split the narrative into N episodes via EpisodeSplitter
    3) Extract characters ONCE against the aggregated narrative
    4) Build 3-view portrait prompts ONCE for every visible character
    5) Per episode, in order:
        - Screenwriter.write_script_based_on_story(episode.summary)
        - Join scenes → one screenplay
        - Preprocess → storyboard design → shot decomposition → mapper
          (skipping character extraction + portrait prompts since they
           were computed globally)
        - Offset shot positions into a per-episode horizontal band so the
          canvas shows episodes side-by-side (x offset by episode index)
        - Prefix shot numbers with the episode index (e.g. "Ep2-1A")

Returns `NovelIngestionResult` — characters + portraits at the top level
(reused across all episodes' branches), per-episode node/edge graphs
under `episodes[]`. Next.js Phase 3 writes everything to Convex.

The coordinator accepts the same `event_emitter` callback contract as
`ingest_screenplay`/`ingest_idea`, extended with per-episode stages:
    - "novel_chunking"        — 2%
    - "novel_compressing"     — 6%
    - "novel_aggregating"     — 18%
    - "splitting_episodes"    — 24%
    - "extracting_characters" — 30%
    - "building_portraits"    — 34%
    - "episode_started"       — scales 35-88% across episodes
    - "episode_done"          — fires at the end of each episode
"""

from __future__ import annotations

import asyncio
import re
import time
from typing import Any, List, Optional

from ._vimax_types import CharacterInScene
from .character_extractor import CharacterExtractor
from .character_portraits_generator import (
    build_back_portrait_prompt,
    build_front_portrait_prompt,
    build_side_portrait_prompt,
)
from .episode_splitter import EpisodeSpec, EpisodeSplitter
from .llm_factory import make_chat_model
from .mapper import (
    build_portrait,
    character_to_ingested,
    shots_and_edges_from_descriptions,
)
from .novel_compressor import NovelCompressor
from .screenplay_ingester import EventEmitter, _emit
from .screenplay_preprocessor import maybe_preprocess_screenplay
from .screenwriter import Screenwriter
from .storyboard_artist import StoryboardArtist
from .types import (
    IngestedEdge,
    IngestedEpisode,
    IngestedPortrait,
    IngestedShotNode,
    NovelIngestionResult,
)


EPISODE_X_STEP = 5000  # canvas distance between episodes — wide enough that ReactFlow naturally pans between them


def _slugify(raw: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9\s-]", "", raw or "").strip().lower()
    cleaned = re.sub(r"\s+", "-", cleaned)
    return cleaned[:40] if cleaned else "untitled"


def _join_episode_scenes(scenes: List[str]) -> str:
    """Join per-scene screenplay strings into one document, dropping empty
    entries. Same shape as idea_ingester._join_scenes so the downstream
    preprocessor works identically."""
    cleaned = [s.strip() for s in scenes if s and s.strip()]
    if not cleaned:
        return ""
    parts: List[str] = []
    for i, scene in enumerate(cleaned):
        parts.append(scene)
        if i < len(cleaned) - 1:
            parts.append("\n\nCUT TO:\n")
    return "\n\n".join(parts)


def _offset_episode_graph(
    episode_index: int,
    nodes: List[IngestedShotNode],
) -> None:
    """Shift every node's x-position into this episode's lane + prefix shot
    numbers. Mutates in place so the caller can keep using the same refs."""
    x_offset = episode_index * EPISODE_X_STEP
    for node in nodes:
        node.position = {
            "x": float(node.position.get("x", 0.0)) + x_offset,
            "y": float(node.position.get("y", 0.0)),
        }
        # Re-stamp shot numbers with the episode prefix. `number` is always
        # set by the mapper (defaults to shot index) so this is safe.
        if node.shotMeta and node.shotMeta.number:
            node.shotMeta.number = f"Ep{episode_index + 1}-{node.shotMeta.number}"


async def _ingest_single_episode(
    *,
    chat_model: Any,
    artist: StoryboardArtist,
    writer: Screenwriter,
    spec: EpisodeSpec,
    characters: List[CharacterInScene],
    style: str,
    user_requirement: str,
) -> tuple[List[IngestedShotNode], List[IngestedEdge], int, bool, int]:
    """Run screenwriter + screenplay design + decomposition for one episode,
    reusing the globally-extracted character list so we don't pay the
    extraction cost per episode. Returns (nodes, edges, llm_call_count,
    did_preprocess, screenplay_char_length)."""
    started = time.time()
    llm_calls = 0

    # 1. Episode summary + key beats → scene scripts.
    episode_story = spec.summary.strip()
    if spec.key_beats:
        bullets = "\n".join(f"- {beat}" for beat in spec.key_beats)
        episode_story = f"{episode_story}\n\nKey beats:\n{bullets}"
    scenes = await writer.write_script_based_on_story(
        story=episode_story,
        user_requirement=user_requirement or None,
    )
    llm_calls += 1
    screenplay = _join_episode_scenes(scenes)

    # 2. Preprocess (if needed — per-episode screenplays usually already
    # have INT./EXT. markers, so the preprocessor often skips the LLM call).
    prose_script, did_preprocess = await maybe_preprocess_screenplay(screenplay, chat_model)
    if did_preprocess:
        llm_calls += 1

    # 3. Design storyboard + decompose shots (reusing globally-extracted chars).
    briefs = await artist.design_storyboard(
        script=prose_script,
        characters=characters,
        user_requirement=user_requirement,
    )
    llm_calls += 1

    decomp_tasks = [
        artist.decompose_visual_description(shot_brief_desc=b, characters=characters)
        for b in briefs
    ]
    decompositions = await asyncio.gather(*decomp_tasks, return_exceptions=True)
    decomposed = [d for d in decompositions if not isinstance(d, Exception)]
    llm_calls += len(briefs)

    # 4. Map to Dreamweaver payloads.
    char_lookup = {c.idx: c.identifier_in_scene for c in characters}
    nodes, edges = shots_and_edges_from_descriptions(
        briefs=briefs,
        decompositions=decomposed,
        style_hint=style,
        character_lookup_by_idx=char_lookup,
    )
    _offset_episode_graph(spec.index, nodes)
    return nodes, edges, llm_calls, did_preprocess, len(screenplay)


async def ingest_novel(
    *,
    storyboard_id: str,
    novel_text: str,
    style: str,
    user_requirement: str,
    target_episode_count: Optional[int] = None,
    media_base_url: str = "",  # noqa: ARG001  (reserved for M4-side/back from Python)
    auth_token: str = "",  # noqa: ARG001
    event_emitter: Optional[EventEmitter] = None,
) -> NovelIngestionResult:
    started = time.time()
    total_llm_calls = 0

    chat_model = make_chat_model()

    # ---------------------------------------------------------------
    # Stage 1: chunk + compress + aggregate
    # ---------------------------------------------------------------
    compressor = NovelCompressor(chat_model=chat_model)
    await _emit(event_emitter, "novel_chunking", 2.0, "Splitting novel into chunks")
    chunks = compressor.split(novel_text)
    chunk_count = len(chunks)
    await _emit(
        event_emitter,
        "novel_compressing",
        6.0,
        f"Compressing {chunk_count} chunk{'s' if chunk_count != 1 else ''}",
        chunkCount=chunk_count,
    )
    compressed_chunks = await compressor.compress(chunks)
    total_llm_calls += len(chunks)

    await _emit(
        event_emitter,
        "novel_aggregating",
        18.0,
        "Merging compressed chunks into one narrative",
    )
    narrative = await compressor.aggregate(compressed_chunks)
    if len(compressed_chunks) > 1:
        total_llm_calls += 1

    # ---------------------------------------------------------------
    # Stage 2: split the narrative into episodes
    # ---------------------------------------------------------------
    await _emit(
        event_emitter,
        "splitting_episodes",
        24.0,
        f"Splitting narrative into episodes (target: {target_episode_count or 'auto'})",
    )
    splitter = EpisodeSplitter(chat_model=chat_model)
    episode_specs: List[EpisodeSpec] = await splitter.split_into_episodes(
        narrative=narrative,
        target_episode_count=target_episode_count,
    )
    total_llm_calls += 1
    episode_count = len(episode_specs)

    # ---------------------------------------------------------------
    # Stage 3: extract characters ONCE against the aggregated narrative
    # ---------------------------------------------------------------
    await _emit(
        event_emitter,
        "extracting_characters",
        30.0,
        f"Extracting characters for {episode_count} episode{'s' if episode_count != 1 else ''}",
        episodeCount=episode_count,
    )
    extractor = CharacterExtractor(chat_model=chat_model)
    characters = await extractor.extract_characters(script=narrative)
    total_llm_calls += 1
    visible_characters = [c for c in characters if c.is_visible]

    # ---------------------------------------------------------------
    # Stage 4: build 3-view portrait prompts ONCE per character
    # ---------------------------------------------------------------
    await _emit(
        event_emitter,
        "building_portraits",
        34.0,
        f"Preparing {len(visible_characters) * 3} portrait prompts (front + side + back per visible character)",
        characterCount=len(characters),
        visibleCharacterCount=len(visible_characters),
    )
    portraits: List[IngestedPortrait] = []
    for c in visible_characters:
        portraits.append(
            build_portrait(
                character_id=c.identifier_in_scene,
                source_url="",
                prompt=build_front_portrait_prompt(character=c, style=style),
                view="front",
                condition_on_view=None,
            )
        )
        portraits.append(
            build_portrait(
                character_id=c.identifier_in_scene,
                source_url="",
                prompt=build_side_portrait_prompt(character=c),
                view="side",
                condition_on_view="front",
            )
        )
        portraits.append(
            build_portrait(
                character_id=c.identifier_in_scene,
                source_url="",
                prompt=build_back_portrait_prompt(character=c),
                view="back",
                condition_on_view="front",
            )
        )

    # ---------------------------------------------------------------
    # Stage 5: per-episode screenplay + shot graph
    # ---------------------------------------------------------------
    artist = StoryboardArtist(chat_model=chat_model)
    writer = Screenwriter(chat_model=chat_model)
    episodes: List[IngestedEpisode] = []

    # Reserve 35-88% of the bar for the per-episode loop, evenly.
    per_episode_span = 53.0 / max(episode_count, 1)

    for spec in episode_specs:
        episode_percent_start = 35.0 + spec.index * per_episode_span
        await _emit(
            event_emitter,
            "episode_started",
            episode_percent_start,
            f"Episode {spec.index + 1}/{episode_count}: {spec.title}",
            episodeIndex=spec.index,
            episodeCount=episode_count,
            episodeTitle=spec.title,
        )

        ep_started = time.time()
        try:
            nodes, edges, ep_llm_calls, did_preprocess, screenplay_len = await _ingest_single_episode(
                chat_model=chat_model,
                artist=artist,
                writer=writer,
                spec=spec,
                characters=characters,
                style=style,
                user_requirement=user_requirement,
            )
        except Exception as exc:
            # A single episode failure shouldn't kill the whole novel. Skip it
            # and surface via an event so the UI reports partial success.
            await _emit(
                event_emitter,
                "episode_failed",
                episode_percent_start + per_episode_span,
                f"Episode {spec.index + 1} failed: {exc}",
                episodeIndex=spec.index,
                episodeCount=episode_count,
                error=str(exc),
            )
            continue

        total_llm_calls += ep_llm_calls
        branch_id = f"ep-{spec.index + 1}-{_slugify(spec.title)}"
        episodes.append(
            IngestedEpisode(
                index=spec.index,
                title=spec.title,
                branchId=branch_id,
                branchName=f"Episode {spec.index + 1}: {spec.title}",
                nodes=nodes,
                edges=edges,
                episodeDurationMs=int((time.time() - ep_started) * 1000),
                llmCallCount=ep_llm_calls,
                screenplayLength=screenplay_len,
                preprocessed=did_preprocess,
            )
        )

        await _emit(
            event_emitter,
            "episode_done",
            episode_percent_start + per_episode_span,
            f"Episode {spec.index + 1} complete: {len(nodes)} shots",
            episodeIndex=spec.index,
            episodeCount=episode_count,
            shotCount=len(nodes),
            edgeCount=len(edges),
        )

    await _emit(
        event_emitter,
        "novel_assembling",
        90.0,
        f"Assembled {len(episodes)}/{episode_count} episodes",
    )

    return NovelIngestionResult(
        storyboardId=storyboard_id,
        novelLength=len(novel_text),
        compressedNarrativeLength=len(narrative),
        chunkCount=chunk_count,
        characters=[character_to_ingested(c) for c in characters],
        portraits=portraits,
        episodes=episodes,
        pipelineDurationMs=int((time.time() - started) * 1000),
        llmCallCount=total_llm_calls,
        episodeCount=len(episodes),
    )
