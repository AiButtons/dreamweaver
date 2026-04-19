import type { ValidatorFn, ValidatorViolation } from "./types";
import { shotsShareCharacter, walkShotsInPrimaryOrder } from "./walk";

/**
 * 180° rule — consecutive shots sharing an axisLineId must not flip
 * screenDirection without a neutral shot in between.
 */
export const checkAxisLineBreak: ValidatorFn = (input) => {
  const shots = walkShotsInPrimaryOrder(input);
  const violations: ValidatorViolation[] = [];
  for (let i = 0; i < shots.length - 1; i += 1) {
    const a = shots[i];
    const b = shots[i + 1];
    const axisA = a.shotMeta?.axisLineId;
    const axisB = b.shotMeta?.axisLineId;
    if (!axisA || !axisB || axisA !== axisB) continue;
    const dirA = a.shotMeta?.screenDirection;
    const dirB = b.shotMeta?.screenDirection;
    if (!dirA || !dirB) continue;
    if (dirA === "neutral" || dirB === "neutral") continue;
    if (dirA === dirB) continue;
    violations.push({
      code: "SHOT_AXIS_LINE_BREAK",
      severity: "critical",
      message: `180° line broken on axis '${axisA}' between shot ${a.label} and ${b.label}.`,
      nodeIds: [a.nodeId, b.nodeId],
      edgeIds: [],
      suggestedFix: "Insert a neutral cutaway or reverse the coverage order.",
    });
  }
  return violations;
};

/**
 * Screen-direction reversal — same subject's motion/facing direction flips
 * across a cut (even when axisLineId differs or is unset).
 * Complements the stricter axis-line check with a looser subject-based
 * heuristic; we dedupe pairs that the axis-line rule already covers.
 */
export const checkScreenDirectionReversal: ValidatorFn = (input) => {
  const shots = walkShotsInPrimaryOrder(input);
  const violations: ValidatorViolation[] = [];
  for (let i = 0; i < shots.length - 1; i += 1) {
    const a = shots[i];
    const b = shots[i + 1];
    if (!shotsShareCharacter(a, b)) continue;
    const dirA = a.shotMeta?.screenDirection;
    const dirB = b.shotMeta?.screenDirection;
    if (!dirA || !dirB) continue;
    if (dirA === "neutral" || dirB === "neutral") continue;
    if (dirA === dirB) continue;
    // Dedupe: axis-line rule already covers this pair.
    const axisA = a.shotMeta?.axisLineId;
    const axisB = b.shotMeta?.axisLineId;
    if (axisA && axisB && axisA === axisB) continue;
    violations.push({
      code: "SHOT_SCREEN_DIRECTION_REVERSE",
      severity: "high",
      message: `Screen direction flips between '${a.label}' (${dirA}) and '${b.label}' (${dirB}) for shared subject — reader may jump.`,
      nodeIds: [a.nodeId, b.nodeId],
      edgeIds: [],
      suggestedFix:
        "Maintain screen direction or add a motivated reverse (whip pan, insert).",
    });
  }
  return violations;
};
