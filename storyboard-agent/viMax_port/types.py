"""Pydantic schemas for the Phase 2 ingestion result.

These shapes are the contract between the storyboard-agent /script-ingest
endpoint and the Next.js Phase 3 route that writes into Convex via bulk
mutations. Field names are camelCase so the TS side can forward them through
to `bulkCreateNodes` / `bulkCreateEdges` without remapping.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class ShotMetaOut(BaseModel):
    number: Optional[str] = None
    size: Optional[Literal["ECU", "CU", "MCU", "MS", "MLS", "WS", "EWS"]] = None
    angle: Optional[
        Literal["eye_level", "high", "low", "dutch", "birds_eye", "worms_eye"]
    ] = None
    lensMm: Optional[float] = None
    tStop: Optional[str] = None
    move: Optional[
        Literal[
            "static",
            "push_in",
            "pull_out",
            "dolly",
            "track",
            "tilt",
            "pan",
            "whip_pan",
            "handheld",
            "steadicam",
            "crane",
            "drone",
        ]
    ] = None
    aspect: Optional[
        Literal["2.39:1", "1.85:1", "16:9", "9:16", "4:5", "1:1", "2:1"]
    ] = None
    durationS: Optional[float] = None
    screenDirection: Optional[
        Literal["left_to_right", "right_to_left", "neutral"]
    ] = None
    blockingNotes: Optional[str] = None


class PromptPackOut(BaseModel):
    imagePrompt: Optional[str] = None
    videoPrompt: Optional[str] = None
    negativePrompt: Optional[str] = None
    continuityDirectives: Optional[List[str]] = None


class IngestedCharacter(BaseModel):
    identifier: str
    staticFeatures: str
    dynamicFeatures: str
    isVisible: bool
    identityPackName: str


class IngestedPortrait(BaseModel):
    characterIdentifier: str
    view: Literal["front", "side", "back", "three_quarter", "custom"]
    sourceUrl: str
    prompt: str
    # M2: when set, the Next.js route should fulfill this prompt with the
    # already-generated portrait of the referenced view (same character) as a
    # `reference_image_urls` conditioning input. Enables the ViMax 3-view
    # trick: side + back are conditioned on the front portrait.
    conditionOnView: Optional[
        Literal["front", "side", "back", "three_quarter", "custom"]
    ] = None


class IngestedShotNode(BaseModel):
    nodeId: str
    nodeType: Literal["scene", "shot"]
    label: str
    segment: str
    position: dict
    shotMeta: Optional[ShotMetaOut] = None
    promptPack: Optional[PromptPackOut] = None
    characterIdentifiers: List[str] = Field(default_factory=list)


class IngestedEdge(BaseModel):
    edgeId: str
    sourceNodeId: str
    targetNodeId: str
    edgeType: Literal["serial", "parallel", "branch", "merge"] = "serial"
    isPrimary: bool = True
    order: Optional[int] = None


class IngestionResult(BaseModel):
    storyboardId: str
    screenplayLength: int
    characters: List[IngestedCharacter]
    portraits: List[IngestedPortrait]
    nodes: List[IngestedShotNode]
    edges: List[IngestedEdge]
    pipelineDurationMs: int
    llmCallCount: int
    preprocessed: bool
