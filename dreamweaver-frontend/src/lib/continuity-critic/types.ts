export type CriticCode =
  | "CRITIC_NARRATIVE_TIMELINE"
  | "CRITIC_WARDROBE"
  | "CRITIC_CHARACTER_ARC"
  | "CRITIC_LOCATION"
  | "CRITIC_CONTINUITY_BREAK"
  | "CRITIC_OTHER";

export type CriticSeverity = "low" | "medium" | "high" | "critical";

/**
 * Code prefixes owned by the LLM continuity-critic family. The persistence
 * mutation uses these prefixes to soft-clear stale rows while leaving
 * unrelated continuity violations (e.g. the deterministic shot validators)
 * untouched.
 *
 * keep in sync with convex/continuityOS.ts CONTINUITY_CRITIC_CODE_PREFIXES.
 */
export const CONTINUITY_CRITIC_CODE_PREFIXES: readonly string[] = [
  "CRITIC_NARRATIVE_TIMELINE",
  "CRITIC_WARDROBE",
  "CRITIC_CHARACTER_ARC",
  "CRITIC_LOCATION",
  "CRITIC_CONTINUITY_BREAK",
  "CRITIC_OTHER",
] as const;

/** Minimal structural node shape the prompt builder needs. Framework-agnostic. */
export interface CriticPromptNode {
  nodeId: string;
  nodeType: string;
  label: string;
  segment: string;
  characterIds?: string[];
  wardrobeVariantIds?: string[];
  rollingSummary?: string;
  /** Pre-formatted short line describing shot metadata (size, angle, lens, ...). */
  shotMetaSlug?: string;
}

export interface CriticPromptEdge {
  sourceNodeId: string;
  targetNodeId: string;
  isPrimary?: boolean;
  order?: number;
}

export interface CriticPromptInput {
  storyboardTitle: string;
  cutTierLabel?: string;
  reviewRound?: number;
  nodes: CriticPromptNode[];
  edges: CriticPromptEdge[];
  /** Truncation safety (default 80). */
  maxNodes?: number;
}

export interface CriticViolation {
  code: CriticCode;
  severity: CriticSeverity;
  message: string;
  nodeIds: string[];
  edgeIds: string[];
  suggestedFix?: string;
}

export interface CriticResponse {
  violations: CriticViolation[];
  truncated?: boolean;
}
