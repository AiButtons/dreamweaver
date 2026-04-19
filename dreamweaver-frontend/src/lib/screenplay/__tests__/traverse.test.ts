import { describe, expect, it } from "bun:test";
import {
  deriveSceneHeading,
  deriveShotNumber,
  formatShotMetaSlug,
  traverseStoryboard,
} from "@/lib/screenplay/traverse";
import type {
  ScreenplayEdgeInput,
  ScreenplayInput,
  ScreenplayNodeInput,
} from "@/lib/screenplay/types";

const makeNode = (overrides: Partial<ScreenplayNodeInput> & { nodeId: string; nodeType: ScreenplayNodeInput["nodeType"] }): ScreenplayNodeInput => ({
  label: overrides.label ?? "",
  segment: overrides.segment ?? "",
  position: overrides.position ?? { x: 0, y: 0 },
  shotMeta: overrides.shotMeta,
  entityRefs: overrides.entityRefs,
  ...overrides,
});

const makeEdge = (overrides: Partial<ScreenplayEdgeInput> & { edgeId: string; sourceNodeId: string; targetNodeId: string }): ScreenplayEdgeInput => ({
  edgeType: "serial",
  ...overrides,
});

describe("traverseStoryboard", () => {
  it("groups a three-node scene → shot → shot chain correctly", () => {
    const input: ScreenplayInput = {
      title: "Test",
      nodes: [
        makeNode({ nodeId: "s1", nodeType: "scene", label: "Bedroom", position: { x: 0, y: 0 } }),
        makeNode({ nodeId: "a", nodeType: "shot", segment: "First action.", position: { x: 1, y: 0 } }),
        makeNode({ nodeId: "b", nodeType: "shot", segment: "Second action.", position: { x: 2, y: 0 } }),
      ],
      edges: [
        makeEdge({ edgeId: "e1", sourceNodeId: "s1", targetNodeId: "a", isPrimary: true }),
        makeEdge({ edgeId: "e2", sourceNodeId: "a", targetNodeId: "b", isPrimary: true }),
      ],
    };

    const scenes = traverseStoryboard(input);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].sceneNode?.nodeId).toBe("s1");
    expect(scenes[0].shots.map((s) => s.nodeId)).toEqual(["a", "b"]);
  });

  it("prefers primary edge over non-primary at a fork", () => {
    const input: ScreenplayInput = {
      title: "Fork",
      nodes: [
        makeNode({ nodeId: "s1", nodeType: "scene", label: "Room", position: { x: 0, y: 0 } }),
        makeNode({ nodeId: "primary", nodeType: "shot", segment: "Primary.", position: { x: 1, y: 0 } }),
        makeNode({ nodeId: "alt", nodeType: "shot", segment: "Alt.", position: { x: 1, y: 5 } }),
      ],
      edges: [
        makeEdge({ edgeId: "eAlt", sourceNodeId: "s1", targetNodeId: "alt", isPrimary: false, order: 0 }),
        makeEdge({ edgeId: "ePrimary", sourceNodeId: "s1", targetNodeId: "primary", isPrimary: true, order: 1 }),
      ],
    };
    const scenes = traverseStoryboard(input);
    expect(scenes).toHaveLength(1);
    // Primary should be emitted before the non-primary alt.
    expect(scenes[0].shots[0].nodeId).toBe("primary");
  });

  it("puts orphan shots under a synthetic scene", () => {
    const input: ScreenplayInput = {
      title: "Orphan",
      nodes: [
        makeNode({ nodeId: "a", nodeType: "shot", segment: "Orphan.", position: { x: 0, y: 0 } }),
      ],
      edges: [],
    };
    const scenes = traverseStoryboard(input);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].sceneNode).toBeNull();
    expect(scenes[0].shots.map((s) => s.nodeId)).toEqual(["a"]);
  });

  it("synthesises transitionOut from branch/merge nodes and excludes them from shot list", () => {
    const input: ScreenplayInput = {
      title: "Branches",
      nodes: [
        makeNode({ nodeId: "s1", nodeType: "scene", label: "Intro", position: { x: 0, y: 0 } }),
        makeNode({ nodeId: "shot1", nodeType: "shot", segment: "Seed.", position: { x: 1, y: 0 } }),
        makeNode({ nodeId: "br", nodeType: "branch", label: "FLASHBACK", position: { x: 2, y: 0 } }),
        makeNode({ nodeId: "s2", nodeType: "scene", label: "Later", position: { x: 3, y: 0 } }),
        makeNode({ nodeId: "shot2", nodeType: "shot", segment: "Next.", position: { x: 4, y: 0 } }),
      ],
      edges: [
        makeEdge({ edgeId: "e1", sourceNodeId: "s1", targetNodeId: "shot1", isPrimary: true }),
        makeEdge({ edgeId: "e2", sourceNodeId: "shot1", targetNodeId: "br", isPrimary: true }),
        makeEdge({ edgeId: "e3", sourceNodeId: "br", targetNodeId: "s2", isPrimary: true, edgeType: "branch" }),
        makeEdge({ edgeId: "e4", sourceNodeId: "s2", targetNodeId: "shot2", isPrimary: true }),
      ],
    };
    const scenes = traverseStoryboard(input);
    expect(scenes).toHaveLength(2);
    // Branch must not appear in shot list for scene 1.
    expect(scenes[0].shots.some((s) => s.nodeId === "br")).toBe(false);
    expect(scenes[0].transitionOut).toBe("FLASHBACK TO:");
    expect(scenes[1].shots.map((s) => s.nodeId)).toEqual(["shot2"]);
  });

  it("skips character_ref and background_ref nodes in the walk", () => {
    const input: ScreenplayInput = {
      title: "Structural",
      nodes: [
        makeNode({ nodeId: "c1", nodeType: "character_ref", label: "HERO", position: { x: 0, y: 0 } }),
        makeNode({ nodeId: "s1", nodeType: "scene", label: "Room", position: { x: 1, y: 0 } }),
        makeNode({ nodeId: "a", nodeType: "shot", segment: "Action.", position: { x: 2, y: 0 } }),
      ],
      edges: [
        makeEdge({ edgeId: "e1", sourceNodeId: "c1", targetNodeId: "s1", isPrimary: true }),
        makeEdge({ edgeId: "e2", sourceNodeId: "s1", targetNodeId: "a", isPrimary: true }),
      ],
    };
    const scenes = traverseStoryboard(input);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].sceneNode?.nodeId).toBe("s1");
    expect(scenes[0].shots.map((s) => s.nodeId)).toEqual(["a"]);
  });
});

describe("deriveSceneHeading", () => {
  it("passes through labels that already start with INT./EXT.", () => {
    const node: ScreenplayNodeInput = makeNode({
      nodeId: "s", nodeType: "scene", label: "ext. rooftop - night",
    });
    expect(deriveSceneHeading(node, 1)).toBe("EXT. ROOFTOP - NIGHT");
  });

  it("wraps bare labels as INT. LABEL - DAY", () => {
    const node: ScreenplayNodeInput = makeNode({
      nodeId: "s", nodeType: "scene", label: "Bedroom",
    });
    expect(deriveSceneHeading(node, 1)).toBe("INT. BEDROOM - DAY");
  });

  it("falls back to INT. SCENE N - DAY when node is null", () => {
    expect(deriveSceneHeading(null, 3)).toBe("INT. SCENE 3 - DAY");
  });
});

describe("deriveShotNumber", () => {
  it("prefers existing shotMeta.number", () => {
    const shot = makeNode({
      nodeId: "x", nodeType: "shot",
      shotMeta: { number: "7C" },
    });
    expect(deriveShotNumber(shot, 1, 0)).toBe("7C");
  });
  it("auto-numbers as {scene}{A-Z}", () => {
    const shot = makeNode({ nodeId: "x", nodeType: "shot" });
    expect(deriveShotNumber(shot, 2, 0)).toBe("2A");
    expect(deriveShotNumber(shot, 2, 3)).toBe("2D");
  });
});

describe("formatShotMetaSlug", () => {
  it("returns null for undefined meta", () => {
    expect(formatShotMetaSlug(undefined)).toBeNull();
  });
  it("formats a full meta into a compact slug", () => {
    const slug = formatShotMetaSlug({
      size: "MS",
      angle: "low",
      lensMm: 35,
      tStop: "T2.8",
      move: "push_in",
      aspect: "9:16",
      durationS: 4.5,
    });
    expect(slug).toBe("MS, low, 35mm T2.8, push_in, 9:16, 4.5s");
  });
});
