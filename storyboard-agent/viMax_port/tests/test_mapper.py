"""Pure-function tests for the ViMax -> Dreamweaver mapper. No LLM, no HTTP."""

from __future__ import annotations

import pytest

from viMax_port._vimax_types import (
    CharacterInScene,
    ShotBriefDescription,
    ShotDescription,
)
from viMax_port.mapper import (
    character_to_ingested,
    generate_edge_id,
    generate_node_id,
    shot_meta_from_description,
    shots_and_edges_from_descriptions,
)


def _make_brief(idx: int, visual: str = "A wide shot of a park.") -> ShotBriefDescription:
    return ShotBriefDescription(
        idx=idx,
        is_last=False,
        cam_idx=0,
        visual_desc=visual,
        audio_desc="ambient park noise",
    )


def _make_decomp(
    idx: int,
    variation: str = "medium",
    ff_vis: list | None = None,
) -> ShotDescription:
    return ShotDescription(
        idx=idx,
        is_last=False,
        cam_idx=0,
        visual_desc=f"visual {idx}",
        variation_type=variation,  # type: ignore[arg-type]
        variation_reason="reason",
        ff_desc=f"ff {idx}",
        ff_vis_char_idxs=ff_vis or [],
        lf_desc=f"lf {idx}",
        lf_vis_char_idxs=[],
        motion_desc=f"motion {idx}",
        audio_desc="audio",
    )


def test_generate_node_id_is_prefixed():
    nid = generate_node_id()
    assert nid.startswith("n_")
    assert len(nid) == 2 + 16


def test_generate_edge_id_is_deterministic_per_pair():
    eid = generate_edge_id("n_abc12345xx", "n_def67890yy")
    assert eid == "e_n_abc123_n_def678"


def test_character_to_ingested_maps_fields():
    c = CharacterInScene(
        idx=0,
        identifier_in_scene="Alice",
        is_visible=True,
        static_features="long hair",
        dynamic_features="red coat",
    )
    out = character_to_ingested(c)
    assert out.identifier == "Alice"
    assert out.staticFeatures == "long hair"
    assert out.dynamicFeatures == "red coat"
    assert out.isVisible is True
    assert out.identityPackName == "Alice"


def test_character_to_ingested_handles_blank_features():
    c = CharacterInScene(
        idx=1,
        identifier_in_scene="Ghost",
        is_visible=False,
        static_features="",
        dynamic_features="",
    )
    out = character_to_ingested(c)
    assert out.staticFeatures == ""
    assert out.dynamicFeatures == ""
    assert out.isVisible is False


@pytest.mark.parametrize(
    "variation,expected_size,expected_move",
    [
        ("large", "WS", "dolly"),
        ("medium", "MS", "push_in"),
        ("small", "MCU", "static"),
    ],
)
def test_shot_meta_from_description_variation_map(
    variation, expected_size, expected_move
):
    decomp = _make_decomp(0, variation=variation)
    meta = shot_meta_from_description(decomp, style_hint="cinematic")
    assert meta.size == expected_size
    assert meta.move == expected_move
    assert meta.aspect == "9:16"
    assert meta.durationS == 3.0
    assert meta.angle == "eye_level"
    assert meta.screenDirection == "neutral"


def test_shot_meta_from_description_none_returns_defaults():
    meta = shot_meta_from_description(None, style_hint="cinematic")
    assert meta.aspect == "9:16"
    assert meta.durationS == 3.0
    assert meta.size is None
    assert meta.move is None


def test_shots_and_edges_three_shots_serial_chain():
    briefs = [_make_brief(0), _make_brief(1), _make_brief(2)]
    decomps = [
        _make_decomp(0, variation="large", ff_vis=[0]),
        _make_decomp(1, variation="medium", ff_vis=[0, 1]),
        _make_decomp(2, variation="small", ff_vis=[]),
    ]
    char_lookup = {0: "Alice", 1: "Bob"}

    nodes, edges = shots_and_edges_from_descriptions(
        briefs=briefs,
        decompositions=decomps,
        style_hint="cinematic",
        character_lookup_by_idx=char_lookup,
    )
    assert len(nodes) == 3
    assert len(edges) == 2

    # Positions spaced by 400 px
    assert nodes[0].position["x"] == 0.0
    assert nodes[1].position["x"] == 400.0
    assert nodes[2].position["x"] == 800.0

    # Labels & numbering
    assert nodes[0].label == "Shot 1"
    assert nodes[0].shotMeta.number == "1"
    assert nodes[2].shotMeta.number == "3"

    # Character resolution
    assert nodes[0].characterIdentifiers == ["Alice"]
    assert nodes[1].characterIdentifiers == ["Alice", "Bob"]
    assert nodes[2].characterIdentifiers == []

    # Edges: serial + primary, order starts at 1 (matches index)
    for i, edge in enumerate(edges, start=1):
        assert edge.edgeType == "serial"
        assert edge.isPrimary is True
        assert edge.order == i
        assert edge.sourceNodeId == nodes[i - 1].nodeId
        assert edge.targetNodeId == nodes[i].nodeId


def test_shots_and_edges_empty_input():
    nodes, edges = shots_and_edges_from_descriptions(
        briefs=[],
        decompositions=[],
        style_hint="cinematic",
        character_lookup_by_idx={},
    )
    assert nodes == []
    assert edges == []


def test_shots_and_edges_missing_decomposition_falls_back():
    """A brief with no matching decomposition still produces a node with
    default shotMeta (aspect 9:16) and no derived character identifiers."""
    briefs = [_make_brief(0), _make_brief(1)]
    decomps = [_make_decomp(1, variation="small", ff_vis=[])]
    nodes, edges = shots_and_edges_from_descriptions(
        briefs=briefs,
        decompositions=decomps,
        style_hint="cinematic",
        character_lookup_by_idx={},
    )
    assert len(nodes) == 2
    assert len(edges) == 1
    # First brief had no decomp -> default meta, size/move None
    assert nodes[0].shotMeta.size is None
    assert nodes[0].shotMeta.aspect == "9:16"
    # Second brief had a "small" decomp -> MCU
    assert nodes[1].shotMeta.size == "MCU"


def test_prompt_pack_combines_visual_and_ff():
    briefs = [_make_brief(0, visual="Wide park shot.")]
    decomps = [_make_decomp(0, variation="medium")]
    nodes, _ = shots_and_edges_from_descriptions(
        briefs=briefs,
        decompositions=decomps,
        style_hint="cinematic",
        character_lookup_by_idx={},
    )
    node = nodes[0]
    assert node.promptPack is not None
    assert "Wide park shot." in node.promptPack.imagePrompt
    assert "ff 0" in node.promptPack.imagePrompt
    assert node.promptPack.videoPrompt == "motion 0"
