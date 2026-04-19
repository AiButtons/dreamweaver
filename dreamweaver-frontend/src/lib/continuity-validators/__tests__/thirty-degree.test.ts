import { describe, expect, it } from "bun:test";
import { checkThirtyDegreeRule } from "@/lib/continuity-validators/thirty-degree";
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

describe("checkThirtyDegreeRule", () => {
  it("flags two same-size same-angle shots of the same character", () => {
    const input = linear([
      shot("a", { size: "CU", angle: "eye_level" }, ["hero"]),
      shot("b", { size: "CU", angle: "eye_level" }, ["hero"]),
    ]);
    const violations = checkThirtyDegreeRule(input);
    expect(violations.length).toBe(1);
    expect(violations[0].code).toBe("SHOT_THIRTY_DEGREE_RULE");
    expect(violations[0].severity).toBe("medium");
  });

  it("does not flag when characters differ and no shared axis", () => {
    const input = linear([
      shot("a", { size: "CU", angle: "eye_level" }, ["hero"]),
      shot("b", { size: "CU", angle: "eye_level" }, ["villain"]),
    ]);
    expect(checkThirtyDegreeRule(input)).toEqual([]);
  });

  it("does not flag when size changes (CU → MS)", () => {
    const input = linear([
      shot("a", { size: "CU", angle: "eye_level" }, ["hero"]),
      shot("b", { size: "MS", angle: "eye_level" }, ["hero"]),
    ]);
    expect(checkThirtyDegreeRule(input)).toEqual([]);
  });

  it("flags two same-size same-angle shots sharing only an axisLineId", () => {
    const input = linear([
      shot("a", { size: "MS", angle: "low", axisLineId: "ax1" }),
      shot("b", { size: "MS", angle: "low", axisLineId: "ax1" }),
    ]);
    expect(checkThirtyDegreeRule(input).length).toBe(1);
  });
});
