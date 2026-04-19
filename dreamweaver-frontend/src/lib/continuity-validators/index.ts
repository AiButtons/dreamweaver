export * from "./types";
export * from "./walk";
export { checkAxisLineBreak, checkScreenDirectionReversal } from "./axis";
export { checkThirtyDegreeRule } from "./thirty-degree";
export { checkEyelineMismatch } from "./eyeline";

import type { ValidatorFn, ValidatorInput, ValidatorViolation } from "./types";
import { checkAxisLineBreak, checkScreenDirectionReversal } from "./axis";
import { checkThirtyDegreeRule } from "./thirty-degree";
import { checkEyelineMismatch } from "./eyeline";

export const DEFAULT_VALIDATORS: ValidatorFn[] = [
  checkAxisLineBreak,
  checkScreenDirectionReversal,
  checkThirtyDegreeRule,
  checkEyelineMismatch,
];

export const runShotValidators = (
  input: ValidatorInput,
  validators: ValidatorFn[] = DEFAULT_VALIDATORS,
): ValidatorViolation[] => validators.flatMap((v) => v(input));
