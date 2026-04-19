import type { ShotMeta, NodeType } from "@/app/storyboard/types";

export type ValidatorSeverity = "low" | "medium" | "high" | "critical";

export type ValidatorCode =
  | "SHOT_AXIS_LINE_BREAK"
  | "SHOT_SCREEN_DIRECTION_REVERSE"
  | "SHOT_THIRTY_DEGREE_RULE"
  | "SHOT_EYELINE_MISMATCH";

/**
 * Code prefixes owned by the shot-validator family. The mutation that
 * persists fresh validator rows uses these prefixes to soft-clear stale
 * rows while leaving unrelated continuity violations (e.g. the LLM critic
 * in Enhancement #6) untouched.
 *
 * keep in sync with convex/continuityOS.ts SHOT_VALIDATOR_CODE_PREFIXES.
 */
export const SHOT_VALIDATOR_CODE_PREFIXES: readonly string[] = [
  "SHOT_AXIS_LINE_BREAK",
  "SHOT_SCREEN_DIRECTION_REVERSE",
  "SHOT_THIRTY_DEGREE_RULE",
  "SHOT_EYELINE_MISMATCH",
] as const;

export interface ValidatorNode {
  nodeId: string;
  nodeType: NodeType;
  label: string;
  shotMeta?: ShotMeta;
  entityRefs?: {
    characterIds: string[];
    backgroundId?: string;
    sceneId?: string;
    shotId?: string;
  };
}

export interface ValidatorEdge {
  sourceNodeId: string;
  targetNodeId: string;
  edgeType?: "serial" | "parallel" | "branch" | "merge";
  isPrimary?: boolean;
  order?: number;
}

export interface ValidatorInput {
  nodes: ValidatorNode[];
  edges: ValidatorEdge[];
}

export interface ValidatorViolation {
  code: ValidatorCode;
  severity: ValidatorSeverity;
  message: string;
  nodeIds: string[];
  edgeIds: string[];
  suggestedFix?: string;
}

export type ValidatorFn = (input: ValidatorInput) => ValidatorViolation[];
