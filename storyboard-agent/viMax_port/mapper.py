"""Pure functions: ViMax agent outputs -> Dreamweaver ingestion payloads.

These are intentionally dependency-free so the mapper can be unit tested
without network or LLM access.
"""

from __future__ import annotations

import re
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

# --- Cinematic vocabulary matchers ---------------------------------------
# Match canonical film-school terms in the ViMax `visual_desc` / `ff_desc`
# text so we can populate real ShotMeta instead of falling back to the
# variation_type heuristic (which describes INTRA-shot motion, not framing).
# Order within each tuple matters: earlier entries win on a tie.
_SIZE_PATTERNS: Tuple[Tuple[str, str], ...] = (
    # Keep specific / compound terms ahead of the permissive proximity matchers
    # so "medium close-up" wins over "medium … shot".
    ("ECU", r"\b(?:extreme close[- ]?up|ECU)\b"),
    ("MCU", r"\b(?:medium close[- ]?up|MCU)\b"),
    ("CU",  r"\b(?:close[- ]?up|tight\s+(?:on|shot)|CU)\b"),
    ("EWS", r"\b(?:extreme (?:wide|long) shot|EWS|EXW|XWS)\b"),
    ("MLS", r"\b(?:medium (?:long|wide) shot|MLS|MWS)\b"),
    # Proximity matchers — allow 0-3 hyphen-or-space-separated modifier words
    # between the size adjective and "shot" so "Wide eye-level shot",
    # "Medium two-shot", and "long tracking shot" all classify.
    ("WS",  r"\b(?:wide|long|establishing)(?:[- ]\w+){0,3}[- ]shot\b"),
    ("MS",  r"\b(?:medium|waist|cowboy)(?:[- ]\w+){0,3}[- ]shot\b"),
)

_ANGLE_PATTERNS: Tuple[Tuple[str, str], ...] = (
    ("dutch",      r"\b(?:dutch angle|canted angle)\b"),
    ("birds_eye",  r"\b(?:bird'?s[- ]?eye|top[- ]?down|overhead shot)\b"),
    ("worms_eye",  r"\b(?:worm'?s[- ]?eye)\b"),
    ("high",       r"\b(?:high angle|looking down on)\b"),
    ("low",        r"\b(?:low angle|looking up at)\b"),
    ("eye_level",  r"\beye[- ]?level\b"),
)

_MOVE_PATTERNS: Tuple[Tuple[str, str], ...] = (
    ("push_in",   r"\b(?:push[- ]in|dolly in|zoom in|move in)\b"),
    ("pull_out",  r"\b(?:pull[- ]out|dolly out|pull back|zoom out)\b"),
    ("whip_pan",  r"\bwhip[- ]pan(?:s|ning|ned)?\b"),
    ("pan",       r"\bpan(?:s|ning|ned)?\b"),
    ("tilt",      r"\btilt(?:s|ing|ed)?\b"),
    ("dolly",     r"\bdolly\b"),
    ("track",     r"\b(?:track|tracking shot)\b"),
    ("steadicam", r"\bsteadicam\b"),
    ("handheld",  r"\bhand[- ]?held\b"),
    ("crane",     r"\b(?:crane|jib)\b"),
    ("drone",     r"\b(?:drone|aerial)\b"),
    ("static",    r"\b(?:static camera|locked[- ]off|stationary)\b"),
)

_SCREEN_DIR_PATTERNS: Tuple[Tuple[str, str], ...] = (
    ("left_to_right", r"\b(?:left[- ]to[- ]right|moves right|facing right|to the right)\b"),
    ("right_to_left", r"\b(?:right[- ]to[- ]left|moves left|facing left|to the left)\b"),
)


def _match_first(text: str, patterns: Tuple[Tuple[str, str], ...]) -> Optional[str]:
    for value, pattern in patterns:
        if re.search(pattern, text, flags=re.IGNORECASE):
            return value
    return None


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
    view: str = "front",
    condition_on_view: Optional[str] = None,
) -> IngestedPortrait:
    return IngestedPortrait(
        characterIdentifier=character_id,
        view=view,  # type: ignore[arg-type]
        sourceUrl=source_url,
        prompt=prompt,
        conditionOnView=condition_on_view,  # type: ignore[arg-type]
    )


def shot_meta_from_description(
    shot: Optional[ShotDescription],
    style_hint: str,
    brief: Optional[ShotBriefDescription] = None,
) -> ShotMetaOut:
    """Derive a `ShotMetaOut` from a decomposed shot.

    Strategy (best-effort, in order):
      1. Text-match cinematic vocabulary in `visual_desc` + `ff_desc` +
         `motion_desc` — pulls out "wide shot", "medium close-up", "push-in",
         etc. that the LLM has already described in prose. This is much
         more faithful than a variation_type-based heuristic.
      2. Fall back to a variation_type lookup when no text hints exist —
         `variation_type` describes *intra-shot* change, not shot framing,
         so it's a weak signal but better than nothing.
      3. Default to MS + eye_level + static + 9:16 + 3s when both above fail.

    Users can still refine every field in the Shot tab post-ingest.
    """
    _var_size = {"large": "WS", "medium": "MS", "small": "MCU"}
    _var_move = {"large": "dolly", "medium": "push_in", "small": "static"}

    if shot is None and brief is None:
        return ShotMetaOut(
            aspect="9:16",
            durationS=3.0,
            screenDirection="neutral",
        )

    # Concatenate every text surface the LLM wrote so patterns can fire on any.
    search_text_parts: List[str] = []
    if brief is not None:
        search_text_parts.append(brief.visual_desc or "")
    if shot is not None:
        search_text_parts.extend([
            shot.visual_desc or "",
            shot.ff_desc or "",
            shot.lf_desc or "",
            shot.motion_desc or "",
        ])
    search_text = " ".join(search_text_parts)

    size = _match_first(search_text, _SIZE_PATTERNS)
    angle = _match_first(search_text, _ANGLE_PATTERNS)
    move = _match_first(search_text, _MOVE_PATTERNS)
    screen_dir = _match_first(search_text, _SCREEN_DIR_PATTERNS)

    # Fallbacks when text-match didn't find a specific value.
    if size is None and shot is not None:
        size = _var_size.get(shot.variation_type, "MS")
    elif size is None:
        size = "MS"

    if move is None and shot is not None:
        move = _var_move.get(shot.variation_type, "static")
    elif move is None:
        move = "static"

    if angle is None:
        angle = "eye_level"

    return ShotMetaOut(
        size=size,  # type: ignore[arg-type]
        angle=angle,  # type: ignore[arg-type]
        move=move,  # type: ignore[arg-type]
        aspect="9:16",
        durationS=3.0,
        screenDirection=screen_dir or "neutral",  # type: ignore[arg-type]
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
        shot_meta = shot_meta_from_description(decomp, style_hint, brief=brief)
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
        facings_by_char: Dict[str, str] = {}
        if decomp:
            ff_idxs = decomp.ff_vis_char_idxs or []
            ff_facings = decomp.ff_char_facings or []
            for pos, idx in enumerate(ff_idxs):
                cid = character_lookup_by_idx.get(idx)
                if not cid:
                    continue
                char_ids.append(cid)
                # Parallel-array alignment: grab the facing at the same
                # position. "unknown" or out-of-range → drop the entry so
                # the downstream map stays tight.
                if pos < len(ff_facings):
                    facing = ff_facings[pos]
                    if facing and facing != "unknown":
                        facings_by_char[cid] = facing

        node = IngestedShotNode(
            nodeId=node_id,
            nodeType="shot",
            label=f"Shot {i + 1}",
            segment=brief.visual_desc or "",
            position={"x": float(i * x_step), "y": 0.0},
            shotMeta=shot_meta,
            promptPack=prompt_pack,
            characterIdentifiers=char_ids,
            # Only attach when we have at least one known facing; otherwise
            # leave as None so the TS consumer can skip the field entirely.
            characterFacings=facings_by_char if facings_by_char else None,
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
