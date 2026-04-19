import { describe, expect, it } from "bun:test";
import { checkEyelineMismatch } from "@/lib/continuity-validators/eyeline";
import type { ValidatorInput, ValidatorNode } from "@/lib/continuity-validators/types";
import type { ShotMeta } from "@/app/storyboard/types";

const shot = (
  id: string,
  shotMeta: ShotMeta,
  characterIds: string[],
): ValidatorNode => ({
  nodeId: id,
  nodeType: "shot",
  label: id,
  shotMeta,
  entityRefs: { characterIds },
});

const linear = (nodes: ValidatorNode[]): ValidatorInput => ({
  nodes,
  edges: nodes.slice(0, -1).map((n, i) => ({
    sourceNodeId: n.nodeId,
    targetNodeId: nodes[i + 1].nodeId,
    isPrimary: true,
    order: i,
  })),
});

describe("checkEyelineMismatch", () => {
  it("flags a reverse-shot pair where both face the same direction", () => {
    const input = linear([
      shot("a", { axisLineId: "ax1", screenDirection: "left_to_right" }, ["hero"]),
      shot("b", { axisLineId: "ax1", screenDirection: "left_to_right" }, ["villain"]),
    ]);
    const violations = checkEyelineMismatch(input);
    expect(violations.length).toBe(1);
    expect(violations[0].code).toBe("SHOT_EYELINE_MISMATCH");
    expect(violations[0].severity).toBe("medium");
  });

  it("does not flag when directions are opposite (correct eyeline)", () => {
    const input = linear([
      shot("a", { axisLineId: "ax1", screenDirection: "left_to_right" }, ["hero"]),
      shot("b", { axisLineId: "ax1", screenDirection: "right_to_left" }, ["villain"]),
    ]);
    expect(checkEyelineMismatch(input)).toEqual([]);
  });

  it("does not flag when both shots show the same character (not a reverse)", () => {
    const input = linear([
      shot("a", { axisLineId: "ax1", screenDirection: "left_to_right" }, ["hero"]),
      shot("b", { axisLineId: "ax1", screenDirection: "left_to_right" }, ["hero"]),
    ]);
    expect(checkEyelineMismatch(input)).toEqual([]);
  });

  it("does not flag when axisLineIds differ", () => {
    const input = linear([
      shot("a", { axisLineId: "ax1", screenDirection: "left_to_right" }, ["hero"]),
      shot("b", { axisLineId: "ax2", screenDirection: "left_to_right" }, ["villain"]),
    ]);
    expect(checkEyelineMismatch(input)).toEqual([]);
  });
});
