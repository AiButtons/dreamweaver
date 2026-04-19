"""Smoke tests for the Phase 2 Pydantic types."""

from __future__ import annotations

from viMax_port.types import (
    IngestedCharacter,
    IngestedEdge,
    IngestedShotNode,
    IngestionResult,
    PromptPackOut,
    ShotMetaOut,
)


def test_ingestion_result_minimal():
    result = IngestionResult(
        storyboardId="sb_123",
        screenplayLength=42,
        characters=[],
        portraits=[],
        nodes=[],
        edges=[],
        pipelineDurationMs=0,
        llmCallCount=0,
        preprocessed=False,
    )
    assert result.storyboardId == "sb_123"
    assert result.preprocessed is False


def test_ingested_character_defaults():
    c = IngestedCharacter(
        identifier="Alice",
        staticFeatures="",
        dynamicFeatures="",
        isVisible=True,
        identityPackName="Alice",
    )
    assert c.identifier == "Alice"


def test_ingested_edge_defaults_are_serial():
    e = IngestedEdge(edgeId="e_1", sourceNodeId="n_1", targetNodeId="n_2")
    assert e.edgeType == "serial"
    assert e.isPrimary is True


def test_ingested_shot_node_accepts_meta_and_prompt_pack():
    node = IngestedShotNode(
        nodeId="n_1",
        nodeType="shot",
        label="Shot 1",
        segment="a wide park",
        position={"x": 0.0, "y": 0.0},
        shotMeta=ShotMetaOut(size="WS", aspect="9:16", durationS=3.0),
        promptPack=PromptPackOut(imagePrompt="a wide park"),
    )
    assert node.shotMeta.size == "WS"
    assert node.promptPack.imagePrompt == "a wide park"
