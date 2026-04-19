import { describe, expect, it } from "bun:test";
import { walkShotsInPrimaryOrder, shotsShareCharacter } from "@/lib/continuity-validators/walk";
import type { ValidatorInput, ValidatorNode } from "@/lib/continuity-validators/types";

const shot = (id: string, extra: Partial<ValidatorNode> = {}): ValidatorNode => ({
  nodeId: id,
  nodeType: "shot",
  label: id,
  ...extra,
});

describe("walkShotsInPrimaryOrder", () => {
  it("walks a linear 3-shot chain", () => {
    const input: ValidatorInput = {
      nodes: [shot("a"), shot("b"), shot("c")],
      edges: [
        { sourceNodeId: "a", targetNodeId: "b", isPrimary: true },
        { sourceNodeId: "b", targetNodeId: "c", isPrimary: true },
      ],
    };
    const result = walkShotsInPrimaryOrder(input);
    expect(result.map((n) => n.nodeId)).toEqual(["a", "b", "c"]);
  });

  it("follows primary edge first at a branch point", () => {
    const input: ValidatorInput = {
      nodes: [shot("a"), shot("b"), shot("c")],
      edges: [
        { sourceNodeId: "a", targetNodeId: "c", isPrimary: false, order: 2 },
        { sourceNodeId: "a", targetNodeId: "b", isPrimary: true, order: 1 },
      ],
    };
    const result = walkShotsInPrimaryOrder(input);
    expect(result.map((n) => n.nodeId)).toEqual(["a", "b", "c"]);
  });

  it("handles isolated nodes with no edges", () => {
    const input: ValidatorInput = {
      nodes: [shot("a"), shot("b")],
      edges: [],
    };
    const result = walkShotsInPrimaryOrder(input);
    expect(result.map((n) => n.nodeId).sort()).toEqual(["a", "b"]);
  });

  it("does not infinite-loop on a cycle", () => {
    const input: ValidatorInput = {
      nodes: [shot("a"), shot("b"), shot("c")],
      edges: [
        { sourceNodeId: "a", targetNodeId: "b" },
        { sourceNodeId: "b", targetNodeId: "c" },
        { sourceNodeId: "c", targetNodeId: "a" },
      ],
    };
    const result = walkShotsInPrimaryOrder(input);
    // a is first by declaration order; every node visited once.
    expect(result.map((n) => n.nodeId)).toEqual(["a", "b", "c"]);
  });

  it("filters non-shot nodes but still traverses through them", () => {
    const input: ValidatorInput = {
      nodes: [
        { nodeId: "s1", nodeType: "scene", label: "scene 1" },
        shot("a"),
        { nodeId: "cr", nodeType: "character_ref", label: "hero ref" },
        shot("b"),
      ],
      edges: [
        { sourceNodeId: "s1", targetNodeId: "a", isPrimary: true },
        { sourceNodeId: "a", targetNodeId: "cr", isPrimary: true },
        { sourceNodeId: "cr", targetNodeId: "b", isPrimary: true },
      ],
    };
    const result = walkShotsInPrimaryOrder(input);
    expect(result.map((n) => n.nodeId)).toEqual(["a", "b"]);
  });
});

describe("shotsShareCharacter", () => {
  it("returns true when both shots share at least one character id", () => {
    const a = shot("a", { entityRefs: { characterIds: ["hero", "sidekick"] } });
    const b = shot("b", { entityRefs: { characterIds: ["villain", "hero"] } });
    expect(shotsShareCharacter(a, b)).toBe(true);
  });

  it("returns false when no overlap", () => {
    const a = shot("a", { entityRefs: { characterIds: ["hero"] } });
    const b = shot("b", { entityRefs: { characterIds: ["villain"] } });
    expect(shotsShareCharacter(a, b)).toBe(false);
  });

  it("returns false when either shot is non-shot", () => {
    const a = { nodeId: "a", nodeType: "scene" as const, label: "s", entityRefs: { characterIds: ["hero"] } };
    const b = shot("b", { entityRefs: { characterIds: ["hero"] } });
    expect(shotsShareCharacter(a, b)).toBe(false);
  });
});
