"""Pure tests for Novel2Video helpers. The coordinator itself hits the real
LLM end-to-end; that's exercised from integration_live.py (and will be in
Phase 3 once the UI is wired)."""

from __future__ import annotations

import pytest

from viMax_port.mapper import build_portrait
from viMax_port.novel_ingester import (
    EPISODE_X_STEP,
    _join_episode_scenes,
    _offset_episode_graph,
    _slugify,
)
from viMax_port.types import IngestedShotNode, ShotMetaOut


def test_slugify_basic():
    assert _slugify("The Fever") == "the-fever"
    assert _slugify("Episode 1: The Rooftop") == "episode-1-the-rooftop"
    assert _slugify("") == "untitled"
    assert _slugify("   ") == "untitled"


def test_slugify_caps_at_40_chars():
    long = "A very long episode title that would otherwise overflow"
    assert len(_slugify(long)) <= 40


def test_slugify_strips_special_chars():
    assert _slugify("Don't & won't!") == "dont-wont"


def test_join_episode_scenes_single():
    assert _join_episode_scenes(["INT. KITCHEN - DAY\n\nAction."]) == "INT. KITCHEN - DAY\n\nAction."


def test_join_episode_scenes_multiple_adds_cut_to():
    scenes = ["scene 1", "scene 2", "scene 3"]
    joined = _join_episode_scenes(scenes)
    for s in scenes:
        assert s in joined
    assert joined.count("CUT TO:") == 2


def test_join_episode_scenes_filters_empty():
    joined = _join_episode_scenes(["", "scene 1", "   ", "scene 2", ""])
    assert "scene 1" in joined
    assert "scene 2" in joined
    assert joined.count("CUT TO:") == 1  # only between the two real scenes


def test_join_episode_scenes_empty_input():
    assert _join_episode_scenes([]) == ""
    assert _join_episode_scenes(["", "   ", ""]) == ""


def _make_node(x: float = 0.0, y: float = 0.0, number: str = "1") -> IngestedShotNode:
    return IngestedShotNode(
        nodeId=f"n_{number}",
        nodeType="shot",
        label=f"Shot {number}",
        segment="segment",
        position={"x": x, "y": y},
        shotMeta=ShotMetaOut(number=number, aspect="9:16"),
        characterIdentifiers=[],
    )


def test_offset_episode_graph_shifts_x_by_episode_index():
    nodes = [_make_node(x=0), _make_node(x=400), _make_node(x=800)]
    _offset_episode_graph(episode_index=2, nodes=nodes)
    # Episode 2 → x_offset = 2 * EPISODE_X_STEP
    assert nodes[0].position["x"] == 2 * EPISODE_X_STEP
    assert nodes[1].position["x"] == 2 * EPISODE_X_STEP + 400
    assert nodes[2].position["x"] == 2 * EPISODE_X_STEP + 800
    # Y is unchanged.
    for node in nodes:
        assert node.position["y"] == 0


def test_offset_episode_graph_prefixes_shot_numbers():
    nodes = [_make_node(number="1A"), _make_node(number="2B")]
    _offset_episode_graph(episode_index=0, nodes=nodes)
    assert nodes[0].shotMeta.number == "Ep1-1A"
    assert nodes[1].shotMeta.number == "Ep1-2B"
    # Episode 3 prefix
    nodes2 = [_make_node(number="1A")]
    _offset_episode_graph(episode_index=2, nodes=nodes2)
    assert nodes2[0].shotMeta.number == "Ep3-1A"


def test_offset_episode_graph_handles_missing_shot_meta():
    node = IngestedShotNode(
        nodeId="n_bare",
        nodeType="shot",
        label="Bare",
        segment="seg",
        position={"x": 100, "y": 50},
        shotMeta=None,
        characterIdentifiers=[],
    )
    _offset_episode_graph(episode_index=1, nodes=[node])
    assert node.position["x"] == EPISODE_X_STEP + 100
    assert node.shotMeta is None  # still None, no crash


def test_offset_episode_graph_handles_none_number():
    node = _make_node(x=0)
    node.shotMeta.number = None
    _offset_episode_graph(episode_index=1, nodes=[node])
    # With None number, prefix is skipped — node still shifted.
    assert node.position["x"] == EPISODE_X_STEP
    assert node.shotMeta.number is None


def test_build_portrait_still_accepts_novel_ingester_pattern():
    # Sanity check the coordinator's portrait-building flow matches the
    # mapper contract.
    p = build_portrait(
        character_id="KAI",
        source_url="",
        prompt="front portrait of KAI",
        view="front",
        condition_on_view=None,
    )
    assert p.view == "front"
    assert p.conditionOnView is None
    assert p.characterIdentifier == "KAI"
