import type { ValidatorFn, ValidatorViolation } from "./types";
import { walkShotsInPrimaryOrder } from "./walk";

/**
 * Eyeline mismatch (MVP heuristic) — in a reverse-shot pair (two consecutive
 * single-character shots of different characters on the same axisLineId),
 * the two characters are expected to face each other, i.e. their
 * screenDirections should be complementary. If both face the same
 * direction, flag an eyeline mismatch.
 *
 * Enhancement #7 will layer character-specific eyeline matching on top of
 * reference portraits.
 */
export const checkEyelineMismatch: ValidatorFn = (input) => {
  const shots = walkShotsInPrimaryOrder(input);
  const violations: ValidatorViolation[] = [];
  for (let i = 0; i < shots.length - 1; i += 1) {
    const a = shots[i];
    const b = shots[i + 1];
    const charsA = a.entityRefs?.characterIds ?? [];
    const charsB = b.entityRefs?.characterIds ?? [];
    if (charsA.length !== 1 || charsB.length !== 1) continue;
    const charA = charsA[0];
    const charB = charsB[0];
    if (charA === charB) continue;
    const axisA = a.shotMeta?.axisLineId;
    const axisB = b.shotMeta?.axisLineId;
    if (!axisA || !axisB || axisA !== axisB) continue;
    const dirA = a.shotMeta?.screenDirection;
    const dirB = b.shotMeta?.screenDirection;
    if (!dirA || !dirB) continue;
    if (dirA === "neutral" || dirB === "neutral") continue;
    if (dirA !== dirB) continue;
    violations.push({
      code: "SHOT_EYELINE_MISMATCH",
      severity: "medium",
      message: `Eyeline mismatch — '${a.label}' (${charA}) and '${b.label}' (${charB}) are framed as reverses but face the same way (${dirA}).`,
      nodeIds: [a.nodeId, b.nodeId],
      edgeIds: [],
      suggestedFix:
        "Flip one shot's screen direction so the characters meet eyelines.",
    });
  }
  return violations;
};
