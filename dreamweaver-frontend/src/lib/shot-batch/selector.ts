/**
 * Pure helpers for selecting which portrait view to use as an image-to-image
 * reference when generating a shot image. Consumed by
 * `/api/storyboard/generate-shots` during bulk shot generation.
 *
 * Selection priority (M2 v1 — intentionally simple; M3 can layer smarter
 * heuristics on top):
 *   1. If the shot's screenDirection is "right_to_left" AND a side portrait
 *      exists, prefer side (ViMax generates side portraits facing screen-left,
 *      matching right-to-left motion).
 *   2. Otherwise, prefer front (most reliable, highest-quality match).
 *   3. Fall back through three_quarter → side → back → any remaining view.
 *   4. Return null when the character has no active portraits.
 */

import type { ShotMeta, ScreenDirection } from "@/app/storyboard/types";

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

const FALLBACK_ORDER: PortraitView[] = [
  "front",
  "three_quarter",
  "side",
  "back",
  "custom",
];

/** Select the best portrait for a given shot. Returns null when no
 *  available portrait has a non-empty sourceUrl. */
export const selectPortraitForShot = (
  shotMeta: ShotMeta | undefined,
  availablePortraits: AvailablePortrait[],
): AvailablePortrait | null => {
  const viable = availablePortraits.filter(
    (p) => typeof p.sourceUrl === "string" && p.sourceUrl.length > 0,
  );
  if (viable.length === 0) return null;
  const byView = new Map<PortraitView, AvailablePortrait>();
  for (const p of viable) byView.set(p.view, p);

  const direction: ScreenDirection | undefined = shotMeta?.screenDirection;
  if (direction === "right_to_left" && byView.has("side")) {
    return byView.get("side")!;
  }

  for (const v of FALLBACK_ORDER) {
    const hit = byView.get(v);
    if (hit) return hit;
  }
  return viable[0];
};

/** For a shot with multiple characters, return the reference-image URLs in
 *  the order characterIds appear. Skips characters without any portrait. */
export const collectShotReferenceUrls = (
  shotMeta: ShotMeta | undefined,
  characterIds: string[],
  portraitsByCharacter: Map<string, AvailablePortrait[]>,
  maxRefs = 3,
): string[] => {
  const urls: string[] = [];
  for (const id of characterIds) {
    if (urls.length >= maxRefs) break;
    const available = portraitsByCharacter.get(id) ?? [];
    const picked = selectPortraitForShot(shotMeta, available);
    if (picked) urls.push(picked.sourceUrl);
  }
  return urls;
};
