/**
 * Pure helpers for selecting which portrait view to use as an image-to-image
 * reference when generating a shot image. Consumed by
 * `/api/storyboard/generate-shots-stream` during bulk shot generation.
 *
 * Selection strategy (M3 v2 — context-aware scoring):
 *
 * Each available portrait view is scored against the shot context. The
 * view with the highest score wins; ties break on the fallback order.
 *
 * Signals considered, in priority:
 *
 *   1. Shot size — close-ups want front (face fidelity); wides tolerate
 *      three_quarter or side (silhouette + stance matter more than face).
 *
 *   2. Shot angle — high/bird's-eye angles look better with three_quarter
 *      or back (the subject's head visibility matches the elevated POV);
 *      low/worm's-eye angles prefer front (upward face visibility); dutch
 *      is neutral.
 *
 *   3. Character facing — if the caller knows the character's facing
 *      direction in the shot (toward camera, away, screen-left, etc.) the
 *      matching view wins. This is the strongest signal when provided.
 *
 *   4. Screen direction — legacy M2 heuristic: right-to-left motion + side
 *      portrait = bonus. Preserved for backward compatibility.
 *
 *   5. Multi-character shots — when >= 3 characters appear together, the
 *      reference carries less per-character fidelity; prefer three_quarter
 *      over a tight front portrait so the model has silhouette headroom.
 *
 * The simpler `selectPortraitForShot(shotMeta, available)` API from M2 is
 * preserved as a thin wrapper so existing callers keep working.
 */

import type { ShotMeta, ShotAngle, ShotSize, ScreenDirection } from "@/app/storyboard/types";

export type PortraitView =
  | "front"
  | "side"
  | "back"
  | "three_quarter"
  | "custom";

export interface AvailablePortrait {
  view: PortraitView;
  sourceUrl: string;
}

/** Which way the character is facing inside the shot. Optional — if
 *  omitted, we fall back to screenDirection + shot size heuristics. */
export type CharacterFacing =
  | "toward_camera"
  | "away_from_camera"
  | "screen_left"
  | "screen_right"
  | "three_quarter_left"
  | "three_quarter_right";

export interface ShotContext {
  shotMeta?: ShotMeta;
  /** Total characters present in the shot — used to back off close-ups. */
  characterCount?: number;
  /** Facing direction of THIS character in this shot, if known. */
  characterFacing?: CharacterFacing;
}

export interface RankedPortrait {
  portrait: AvailablePortrait;
  score: number;
  /** Short reason tag — useful for debugging why a view won. */
  reason: string;
}

const FALLBACK_ORDER: PortraitView[] = [
  "front",
  "three_quarter",
  "side",
  "back",
  "custom",
];

const FALLBACK_ORDER_RANK: Map<PortraitView, number> = new Map(
  FALLBACK_ORDER.map((view, index) => [view, FALLBACK_ORDER.length - index]),
);

const CLOSE_UP_SIZES: ReadonlySet<ShotSize> = new Set<ShotSize>(["ECU", "CU", "MCU"]);
const WIDE_SIZES: ReadonlySet<ShotSize> = new Set<ShotSize>(["MLS", "WS", "EWS"]);
const ELEVATED_ANGLES: ReadonlySet<ShotAngle> = new Set<ShotAngle>(["high", "birds_eye"]);
const LOW_ANGLES: ReadonlySet<ShotAngle> = new Set<ShotAngle>(["low", "worms_eye"]);

/** Score a single view against the shot context. Higher is better. */
const scoreView = (
  view: PortraitView,
  context: ShotContext,
): { score: number; reason: string } => {
  const reasons: string[] = [];
  // Baseline: nudge toward FALLBACK_ORDER so ties break sensibly.
  let score = FALLBACK_ORDER_RANK.get(view) ?? 0;

  const shotMeta = context.shotMeta;
  const size: ShotSize | undefined = shotMeta?.size;
  const angle: ShotAngle | undefined = shotMeta?.angle;
  const direction: ScreenDirection | undefined = shotMeta?.screenDirection;
  const facing = context.characterFacing;
  const characterCount = context.characterCount ?? 1;

  // -- 1. Shot size --
  if (size && CLOSE_UP_SIZES.has(size)) {
    if (view === "front") {
      score += 10;
      reasons.push(`closeup:${size}→front`);
    } else if (view === "three_quarter") {
      score += 4;
      reasons.push(`closeup:${size}→three_quarter`);
    } else if (view === "back") {
      score -= 8;
      reasons.push(`closeup:${size}→back penalty`);
    }
  } else if (size && WIDE_SIZES.has(size)) {
    if (view === "three_quarter") {
      score += 6;
      reasons.push(`wide:${size}→three_quarter`);
    } else if (view === "side") {
      score += 3;
      reasons.push(`wide:${size}→side`);
    } else if (view === "front") {
      score += 1;
      reasons.push(`wide:${size}→front`);
    }
  }

  // -- 2. Shot angle --
  if (angle && ELEVATED_ANGLES.has(angle)) {
    if (view === "three_quarter" || view === "back") {
      score += 3;
      reasons.push(`angle:${angle}→${view}`);
    } else if (view === "front") {
      // Front still OK but less ideal under an overhead angle.
      score -= 1;
      reasons.push(`angle:${angle} mild front penalty`);
    }
  } else if (angle && LOW_ANGLES.has(angle)) {
    if (view === "front") {
      score += 3;
      reasons.push(`angle:${angle}→front`);
    } else if (view === "back") {
      score -= 2;
      reasons.push(`angle:${angle}→back penalty`);
    }
  }

  // -- 3. Character facing (strongest signal when known) --
  // These bonuses are tuned to dominate shot-size + angle signals so a
  // known facing direction wins even for close-ups that would otherwise
  // demand a front view.
  if (facing) {
    if (facing === "toward_camera" && view === "front") {
      score += 18;
      reasons.push("facing:toward_camera→front");
    } else if (facing === "away_from_camera" && view === "back") {
      score += 18;
      reasons.push("facing:away→back");
    } else if (
      (facing === "screen_left" || facing === "screen_right") &&
      view === "side"
    ) {
      score += 16;
      reasons.push(`facing:${facing}→side`);
    } else if (
      (facing === "three_quarter_left" || facing === "three_quarter_right") &&
      view === "three_quarter"
    ) {
      score += 16;
      reasons.push(`facing:${facing}→three_quarter`);
    } else if (facing === "away_from_camera" && view === "front") {
      // Away-facing character with a front-only reference is a bad match.
      score -= 10;
      reasons.push("facing:away + front penalty");
    } else if (facing === "toward_camera" && view === "back") {
      score -= 12;
      reasons.push("facing:toward + back penalty");
    }
  }

  // -- 4. Screen direction (legacy M2 signal; weaker than facing) --
  if (!facing && direction === "right_to_left" && view === "side") {
    score += 4;
    reasons.push("screenDir:right_to_left→side");
  } else if (!facing && direction === "left_to_right" && view === "side") {
    // ViMax generates side facing screen-left, so for left-to-right motion
    // the side portrait is counter-directional. Penalize lightly.
    score -= 2;
    reasons.push("screenDir:left_to_right mild side penalty");
  }

  // -- 5. Multi-character shot (3+ subjects) --
  if (characterCount >= 3 && view === "three_quarter") {
    score += 2;
    reasons.push("multichar→three_quarter");
  }

  return {
    score,
    reason: reasons.length > 0 ? reasons.join("; ") : "fallback order",
  };
};

const filterViable = (portraits: AvailablePortrait[]): AvailablePortrait[] =>
  portraits.filter(
    (p) => typeof p.sourceUrl === "string" && p.sourceUrl.length > 0,
  );

/**
 * Rank the viable portraits by descending score. Ties break by FALLBACK_ORDER.
 * Exposed for tests + UI debugging. Returns [] when no viable portrait.
 */
export const rankPortraitsForShot = (
  context: ShotContext,
  availablePortraits: AvailablePortrait[],
): RankedPortrait[] => {
  const viable = filterViable(availablePortraits);
  if (viable.length === 0) return [];
  const ranked = viable.map((portrait) => {
    const { score, reason } = scoreView(portrait.view, context);
    return { portrait, score, reason };
  });
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const rankA = FALLBACK_ORDER_RANK.get(a.portrait.view) ?? 0;
    const rankB = FALLBACK_ORDER_RANK.get(b.portrait.view) ?? 0;
    return rankB - rankA;
  });
  return ranked;
};

/**
 * Context-aware selector. Returns the best portrait for the shot, or null
 * when the character has no active portraits.
 */
export const selectPortraitForShotWithContext = (
  context: ShotContext,
  availablePortraits: AvailablePortrait[],
): AvailablePortrait | null => {
  const ranked = rankPortraitsForShot(context, availablePortraits);
  return ranked.length > 0 ? ranked[0].portrait : null;
};

/**
 * M2 API preserved as a thin wrapper for callers that haven't migrated to
 * the richer context form. Equivalent to
 * `selectPortraitForShotWithContext({ shotMeta }, available)`.
 */
export const selectPortraitForShot = (
  shotMeta: ShotMeta | undefined,
  availablePortraits: AvailablePortrait[],
): AvailablePortrait | null =>
  selectPortraitForShotWithContext({ shotMeta }, availablePortraits);

export interface CollectReferenceUrlsOptions {
  /** Maximum number of reference URLs to return. Defaults to 3. */
  maxRefs?: number;
  /** Optional per-character facing map (characterId → facing). */
  facingByCharacter?: Map<string, CharacterFacing>;
}

/**
 * For a shot with multiple characters, return the best-matching reference-image
 * URL per character in the order characterIds appear. Skips characters without
 * any portrait. Honors `facingByCharacter` when provided.
 *
 * The legacy positional overload `(shotMeta, characterIds, portraitsByCharacter, maxRefs?)`
 * is preserved for callers that haven't migrated yet.
 */
export function collectShotReferenceUrls(
  shotMeta: ShotMeta | undefined,
  characterIds: string[],
  portraitsByCharacter: Map<string, AvailablePortrait[]>,
  maxRefs?: number,
): string[];
export function collectShotReferenceUrls(
  shotMeta: ShotMeta | undefined,
  characterIds: string[],
  portraitsByCharacter: Map<string, AvailablePortrait[]>,
  options: CollectReferenceUrlsOptions,
): string[];
export function collectShotReferenceUrls(
  shotMeta: ShotMeta | undefined,
  characterIds: string[],
  portraitsByCharacter: Map<string, AvailablePortrait[]>,
  fourth?: number | CollectReferenceUrlsOptions,
): string[] {
  const isOptions = typeof fourth === "object" && fourth !== null;
  const maxRefs = isOptions
    ? fourth.maxRefs ?? 3
    : typeof fourth === "number"
      ? fourth
      : 3;
  const facingByCharacter = isOptions ? fourth.facingByCharacter : undefined;
  const characterCount = characterIds.length;

  const urls: string[] = [];
  for (const id of characterIds) {
    if (urls.length >= maxRefs) break;
    const available = portraitsByCharacter.get(id) ?? [];
    const picked = selectPortraitForShotWithContext(
      {
        shotMeta,
        characterCount,
        characterFacing: facingByCharacter?.get(id),
      },
      available,
    );
    if (picked) urls.push(picked.sourceUrl);
  }
  return urls;
}
