import type { ValidatorFn, ValidatorViolation } from "./types";
import { shotsShareCharacter, walkShotsInPrimaryOrder } from "./walk";

/**
 * 30° rule — cuts between two shots of the same subject should change
 * camera angle by at least 30°. We approximate: if two adjacent shots of
 * the same subject (shared character or shared axisLineId) have identical
 * size AND identical angle, flag as a potential jump cut.
 */
export const checkThirtyDegreeRule: ValidatorFn = (input) => {
  const shots = walkShotsInPrimaryOrder(input);
  const violations: ValidatorViolation[] = [];
  for (let i = 0; i < shots.length - 1; i += 1) {
    const a = shots[i];
    const b = shots[i + 1];
    const sharesChar = shotsShareCharacter(a, b);
    const axisA = a.shotMeta?.axisLineId;
    const axisB = b.shotMeta?.axisLineId;
    const sharesAxis = !!axisA && !!axisB && axisA === axisB;
    if (!sharesChar && !sharesAxis) continue;
    const sizeA = a.shotMeta?.size;
    const sizeB = b.shotMeta?.size;
    const angleA = a.shotMeta?.angle;
    const angleB = b.shotMeta?.angle;
    if (!sizeA || !sizeB || sizeA !== sizeB) continue;
    if (!angleA || !angleB || angleA !== angleB) continue;
    violations.push({
      code: "SHOT_THIRTY_DEGREE_RULE",
      severity: "medium",
      message: `30° rule — cut between '${a.label}' and '${b.label}' keeps same size (${sizeA}) and angle (${angleA}); feels like a jump cut.`,
      nodeIds: [a.nodeId, b.nodeId],
      edgeIds: [],
      suggestedFix:
        "Change size one step or rotate angle to at least 30° off-axis.",
    });
  }
  return violations;
};
