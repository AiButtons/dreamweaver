import { describe, expect, it } from "bun:test";
import {
  checkAxisLineBreak,
  checkScreenDirectionReversal,
} from "@/lib/continuity-validators/axis";
import type { ValidatorInput, ValidatorNode } from "@/lib/continuity-validators/types";
import type { ShotMeta } from "@/app/storyboard/types";

const shot = (
  id: string,
  shotMeta: ShotMeta,
  characterIds: string[] = [],
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

describe("checkAxisLineBreak", () => {
  it("flags a same-axis flip between consecutive shots", () => {
    const input = linear([
      shot("a", { axisLineId: "ax1", screenDirection: "left_to_right" }, ["hero"]),
      shot("b", { axisLineId: "ax1", screenDirection: "right_to_left" }, ["hero"]),
    ]);
    const violations = checkAxisLineBreak(input);
    expect(violations.length).toBe(1);
    expect(violations[0].code).toBe("SHOT_AXIS_LINE_BREAK");
    expect(violations[0].severity).toBe("critical");
    expect(violations[0].nodeIds).toEqual(["a", "b"]);
  });

  it("does not flag when a neutral shot separates the reversal", () => {
    const input = linear([
      shot("a", { axisLineId: "ax1", screenDirection: "left_to_right" }),
      shot("n", { axisLineId: "ax1", screenDirection: "neutral" }),
      shot("b", { axisLineId: "ax1", screenDirection: "right_to_left" }),
    ]);
    expect(checkAxisLineBreak(input)).toEqual([]);
  });

  it("does not flag when screenDirection is missing on either shot", () => {
    const input = linear([
      shot("a", { axisLineId: "ax1" }),
      shot("b", { axisLineId: "ax1", screenDirection: "right_to_left" }),
    ]);
    expect(checkAxisLineBreak(input)).toEqual([]);
  });
});

describe("checkScreenDirectionReversal", () => {
  it("flags a shared-character flip on differing axes", () => {
    const input = linear([
      shot("a", { axisLineId: "ax1", screenDirection: "left_to_right" }, ["hero"]),
      shot("b", { axisLineId: "ax2", screenDirection: "right_to_left" }, ["hero"]),
    ]);
    const violations = checkScreenDirectionReversal(input);
    expect(violations.length).toBe(1);
    expect(violations[0].code).toBe("SHOT_SCREEN_DIRECTION_REVERSE");
    expect(violations[0].severity).toBe("high");
  });

  it("dedupes against the stricter axis-line rule when axis matches", () => {
    const input = linear([
      shot("a", { axisLineId: "ax1", screenDirection: "left_to_right" }, ["hero"]),
      shot("b", { axisLineId: "ax1", screenDirection: "right_to_left" }, ["hero"]),
    ]);
    expect(checkScreenDirectionReversal(input)).toEqual([]);
    // AXIS_LINE_BREAK still fires exactly once.
    expect(checkAxisLineBreak(input).length).toBe(1);
  });

  it("does not flag unrelated subjects", () => {
    const input = linear([
      shot("a", { screenDirection: "left_to_right" }, ["hero"]),
      shot("b", { screenDirection: "right_to_left" }, ["villain"]),
    ]);
    expect(checkScreenDirectionReversal(input)).toEqual([]);
  });
});
