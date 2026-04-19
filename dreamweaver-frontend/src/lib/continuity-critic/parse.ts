import type {
  CriticCode,
  CriticResponse,
  CriticSeverity,
  CriticViolation,
} from "./types";

const VALID_CODES: ReadonlySet<CriticCode> = new Set<CriticCode>([
  "CRITIC_NARRATIVE_TIMELINE",
  "CRITIC_WARDROBE",
  "CRITIC_CHARACTER_ARC",
  "CRITIC_LOCATION",
  "CRITIC_CONTINUITY_BREAK",
  "CRITIC_OTHER",
]);

const VALID_SEVERITIES: ReadonlySet<CriticSeverity> = new Set<CriticSeverity>([
  "low",
  "medium",
  "high",
  "critical",
]);

const DEFAULT_MAX_VIOLATIONS = 50;

/** Strip markdown fences / surrounding prose and return the JSON substring. */
const stripFences = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return trimmed;
  // ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
};

/**
 * Normalize an arbitrary severity value to our enum. Unknown values become
 * `"medium"` (mid-weight default).
 */
const normalizeSeverity = (raw: unknown): CriticSeverity => {
  if (typeof raw !== "string") return "medium";
  const lower = raw.trim().toLowerCase();
  if (VALID_SEVERITIES.has(lower as CriticSeverity)) {
    return lower as CriticSeverity;
  }
  return "medium";
};

/**
 * Normalize a code value. Exact match wins; a prefix-free match like
 * `"NARRATIVE_TIMELINE"` also succeeds (we re-add the `CRITIC_`). Anything
 * else falls through to `"CRITIC_OTHER"`.
 */
const normalizeCode = (raw: unknown): CriticCode => {
  if (typeof raw !== "string") return "CRITIC_OTHER";
  const upper = raw.trim().toUpperCase();
  if (VALID_CODES.has(upper as CriticCode)) return upper as CriticCode;
  const prefixed = `CRITIC_${upper}`;
  if (VALID_CODES.has(prefixed as CriticCode)) return prefixed as CriticCode;
  return "CRITIC_OTHER";
};

const asStringArray = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === "string" && v.trim().length > 0) out.push(v);
  }
  return out;
};

/**
 * Parse the raw LLM response into validated `CriticViolation[]`.
 *
 * - Tolerates plaintext JSON, fenced JSON, or already-parsed objects.
 * - Accepts either `{ violations: [...] }` or a bare array at the root.
 * - Drops any violation whose code/severity is unknown (codes normalize to
 *   `CRITIC_OTHER` when close-but-not-exact, severities to `"medium"`).
 * - Drops any nodeId not in `knownNodeIds` (hallucinations); violations
 *   with no surviving nodeIds are dropped entirely.
 * - Clamps violations to a max count (default 50).
 * - Returns an empty list on unparseable input — never throws.
 */
export const parseCriticResponse = (
  raw: string | object,
  knownNodeIds: Set<string>,
  options?: { maxViolations?: number },
): CriticResponse => {
  const maxViolations =
    typeof options?.maxViolations === "number" && options.maxViolations > 0
      ? options.maxViolations
      : DEFAULT_MAX_VIOLATIONS;

  let parsed: unknown;
  if (typeof raw === "string") {
    const stripped = stripFences(raw);
    if (stripped.length === 0) return { violations: [] };
    try {
      parsed = JSON.parse(stripped);
    } catch {
      return { violations: [] };
    }
  } else if (raw && typeof raw === "object") {
    parsed = raw;
  } else {
    return { violations: [] };
  }

  let rawViolations: unknown;
  if (Array.isArray(parsed)) {
    rawViolations = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    rawViolations = obj.violations;
  } else {
    return { violations: [] };
  }

  if (!Array.isArray(rawViolations)) return { violations: [] };

  const out: CriticViolation[] = [];
  for (const item of rawViolations) {
    if (out.length >= maxViolations) break;
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;

    const code = normalizeCode(obj.code);
    const severity = normalizeSeverity(obj.severity);
    const message =
      typeof obj.message === "string" ? obj.message.trim() : "";
    if (message.length === 0) continue;

    const nodeIds = asStringArray(obj.nodeIds).filter((id) =>
      knownNodeIds.has(id),
    );
    if (nodeIds.length === 0) continue;

    const edgeIds = asStringArray(obj.edgeIds);
    const suggestedFix =
      typeof obj.suggestedFix === "string" && obj.suggestedFix.trim().length > 0
        ? obj.suggestedFix.trim()
        : undefined;

    out.push({
      code,
      severity,
      message,
      nodeIds,
      edgeIds,
      suggestedFix,
    });
  }

  return { violations: out };
};
