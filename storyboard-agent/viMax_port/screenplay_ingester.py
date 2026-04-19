"""Coordinator: runs the full Phase 2 pipeline end-to-end and returns a
structured IngestionResult that the Next.js route will write into Convex.
"""

from __future__ import annotations

import asyncio
import time

from .character_extractor import CharacterExtractor
from .character_portraits_generator import CharacterPortraitsGenerator
from .llm_factory import make_chat_model
from .mapper import (
    build_portrait,
    character_to_ingested,
    shots_and_edges_from_descriptions,
)
from .media_proxy import MediaProxyImageGenerator
from .screenplay_preprocessor import maybe_preprocess_screenplay
from .storyboard_artist import StoryboardArtist
from .types import IngestionResult


async def ingest_screenplay(
    *,
    storyboard_id: str,
    screenplay: str,
    style: str,
    user_requirement: str,
    media_base_url: str,
    auth_token: str,
) -> IngestionResult:
    started = time.time()
    llm_calls = 0

    chat_model = make_chat_model()
    image_generator = MediaProxyImageGenerator(
        base_url=media_base_url,
        auth_token=auth_token,
    )

    # Stage 1: preprocessor (conditional)
    prose_script, did_preprocess = await maybe_preprocess_screenplay(
        screenplay, chat_model
    )
    if did_preprocess:
        llm_calls += 1

    # Stage 2: extract characters
    extractor = CharacterExtractor(chat_model=chat_model)
    characters = await extractor.extract_characters(script=prose_script)
    llm_calls += 1

    # Stage 3: generate front-view portraits (bounded parallelism)
    portraits_gen = CharacterPortraitsGenerator(image_generator=image_generator)
    visible_characters = [c for c in characters if c.is_visible]
    portrait_tasks = [
        portraits_gen.generate_front_portrait(character=c, style=style)
        for c in visible_characters
    ]
    portrait_outputs = await asyncio.gather(*portrait_tasks, return_exceptions=True)
    portraits = []
    for c, output in zip(visible_characters, portrait_outputs):
        if isinstance(output, Exception):
            # Don't fail the whole ingestion for one bad portrait.
            continue
        portraits.append(
            build_portrait(
                character_id=c.identifier_in_scene,
                source_url=output.sourceUrl,
                prompt=f"Front-view portrait of {c.identifier_in_scene}",
            )
        )

    # Stage 4: design storyboard (brief descriptions)
    artist = StoryboardArtist(chat_model=chat_model)
    briefs = await artist.design_storyboard(
        script=prose_script,
        characters=characters,
        user_requirement=user_requirement,
    )
    llm_calls += 1

    # Stage 5: decompose each shot (bounded parallelism)
    decomp_tasks = [
        artist.decompose_visual_description(
            shot_brief_desc=b, characters=characters
        )
        for b in briefs
    ]
    decompositions = await asyncio.gather(*decomp_tasks, return_exceptions=True)
    decomposed = [d for d in decompositions if not isinstance(d, Exception)]
    llm_calls += len(briefs)

    # Stage 6: map to Dreamweaver payloads
    char_lookup = {c.idx: c.identifier_in_scene for c in characters}
    nodes, edges = shots_and_edges_from_descriptions(
        briefs=briefs,
        decompositions=decomposed,
        style_hint=style,
        character_lookup_by_idx=char_lookup,
    )

    return IngestionResult(
        storyboardId=storyboard_id,
        screenplayLength=len(screenplay),
        characters=[character_to_ingested(c) for c in characters],
        portraits=portraits,
        nodes=nodes,
        edges=edges,
        pipelineDurationMs=int((time.time() - started) * 1000),
        llmCallCount=llm_calls,
        preprocessed=did_preprocess,
    )
