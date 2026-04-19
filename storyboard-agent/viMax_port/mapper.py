"""Pure functions: ViMax agent outputs -> Dreamweaver ingestion payloads.

These are intentionally dependency-free so the mapper can be unit tested
without network or LLM access.
"""

from __future__ import annotations

import uuid
from typing import Dict, List, Optional, Tuple

from ._vimax_types import CharacterInScene, ShotBriefDescription, ShotDescription
from .types import (
    IngestedCharacter,
    IngestedEdge,
    IngestedPortrait,
    IngestedShotNode,
    PromptPackOut,
    ShotMetaOut,
)


def generate_node_id() -> str:
    return f"n_{uuid.uuid4().hex[:16]}"


def generate_edge_id(src: str, tgt: str) -> str:
    return f"e_{src[:8]}_{tgt[:8]}"


def character_to_ingested(c: CharacterInScene) -> IngestedCharacter:
    return IngestedCharacter(
        identifier=c.identifier_in_scene,
        staticFeatures=c.static_features or "",
        dynamicFeatures=c.dynamic_features or "",
        isVisible=c.is_visible,
        identityPackName=c.identifier_in_scene,
    )


def build_portrait(
    character_id: str,
    source_url: str,
    prompt: str,
) -> IngestedPortrait:
    return IngestedPortrait(
        characterIdentifier=character_id,
        view="front",
        sourceUrl=source_url,
        prompt=prompt,
    )


def shot_meta_from_description(
    shot: Optional[ShotDescription],
    style_hint: str,
) -> ShotMetaOut:
    """Derive a `ShotMetaOut` from a decomposed shot.

    M1 heuristics (user can refine in the Shot tab post-ingest):
      - variation_type == "large"  -> size: WS, move: dolly
      - variation_type == "medium" -> size: MS, move: push_in
      - variation_type == "small"  -> size: MCU, move: static
      - durationS defaults to 3.0
      - aspect "9:16" default (matches DEFAULT_ASPECT on media proxy)
    """
    size_map = {"large": "WS", "medium": "MS", "small": "MCU"}
    move_map = {"large": "dolly", "medium": "push_in", "small": "static"}
    if shot is None:
        return ShotMetaOut(
            aspect="9:16",
            durationS=3.0,
            screenDirection="neutral",
        )
    return ShotMetaOut(
        size=size_map.get(shot.variation_type, "MS"),
        angle="eye_level",
        move=move_map.get(shot.variation_type, "static"),
        aspect="9:16",
        durationS=3.0,
        screenDirection="neutral",
    )


def shots_and_edges_from_descriptions(
    briefs: List[ShotBriefDescription],
    decompositions: List[ShotDescription],
    style_hint: str,
    character_lookup_by_idx: Dict[int, str],
) -> Tuple[List[IngestedShotNode], List[IngestedEdge]]:
    """Walk the shot list in order and produce a serial chain of node + edge
    payloads. Each decomposition's `ff_vis_char_idxs` is resolved to character
    identifiers via `character_lookup_by_idx`.
    """
    nodes: List[IngestedShotNode] = []
    edges: List[IngestedEdge] = []
    decomp_by_idx = {d.idx: d for d in decompositions}
    x_step = 400  # canvas spacing
    prev_node_id: Optional[str] = None

    for i, brief in enumerate(briefs):
        node_id = generate_node_id()
        decomp = decomp_by_idx.get(brief.idx)
        shot_meta = shot_meta_from_description(decomp, style_hint)
        shot_meta.number = f"{i + 1}"

        image_prompt_parts: List[str] = [brief.visual_desc or ""]
        if decomp:
            image_prompt_parts.append(decomp.ff_desc)
        prompt_pack = PromptPackOut(
            imagePrompt=" ".join(p for p in image_prompt_parts if p),
            videoPrompt=decomp.motion_desc if decomp else None,
            continuityDirectives=[],
        )

        char_ids: List[str] = []
        if decomp:
            for idx in decomp.ff_vis_char_idxs or []:
                cid = character_lookup_by_idx.get(idx)
                if cid:
                    char_ids.append(cid)

        node = IngestedShotNode(
            nodeId=node_id,
            nodeType="shot",
            label=f"Shot {i + 1}",
            segment=brief.visual_desc or "",
            position={"x": float(i * x_step), "y": 0.0},
            shotMeta=shot_meta,
            promptPack=prompt_pack,
            characterIdentifiers=char_ids,
        )
        nodes.append(node)

        if prev_node_id is not None:
            edges.append(
                IngestedEdge(
                    edgeId=generate_edge_id(prev_node_id, node_id),
                    sourceNodeId=prev_node_id,
                    targetNodeId=node_id,
                    edgeType="serial",
                    isPrimary=True,
                    order=i,
                )
            )
        prev_node_id = node_id

    return nodes, edges
