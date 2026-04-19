import type { PortraitView } from "./types";
import { CANONICAL_PORTRAIT_VIEWS } from "./types";

/**
 * Canonical sort rank for portrait views. Lower ranks sort first. Portraits
 * whose view is undefined are ranked after all known views so they fall to
 * the bottom of any displayed list.
 */
const VIEW_RANK: Record<PortraitView, number> = {
  front: 0,
  three_quarter: 1,
  side: 2,
  back: 3,
  custom: 4,
};

const UNKNOWN_VIEW_RANK = 100;

const rankFor = (view: PortraitView | undefined): number =>
  view === undefined ? UNKNOWN_VIEW_RANK : VIEW_RANK[view];

/**
 * Stable order for rendering a pack's portrait grid:
 * front → three_quarter → side → back → custom → (no view set),
 * with ties broken by ascending createdAt so duplicates within the same view
 * appear in insertion order.
 */
export const orderPortraitsCanonically = <
  T extends { portraitView?: PortraitView; createdAt: number },
>(
  portraits: T[],
): T[] => {
  return [...portraits].sort((a, b) => {
    const rankDelta = rankFor(a.portraitView) - rankFor(b.portraitView);
    if (rankDelta !== 0) return rankDelta;
    return a.createdAt - b.createdAt;
  });
};

export interface PortraitSetStatus {
  /** All distinct views present in the set (duplicates collapsed). */
  presentViews: PortraitView[];
  hasFront: boolean;
  hasSide: boolean;
  hasBack: boolean;
  /** True when front + side + back are all present. Ignores three_quarter / custom. */
  hasCanonicalThreeView: boolean;
  /** Missing canonical views in canonical order, for UI hints. */
  missingCanonical: PortraitView[];
}

/**
 * Compute which canonical ViMax views (front / side / back) are covered by a
 * set of portraits. Callers use this to render a "Front / Side / Back" tick
 * indicator and to decide when an identity pack is ready for 3-view
 * conditioning.
 */
export const portraitSetStatus = <T extends { portraitView?: PortraitView }>(
  portraits: T[],
): PortraitSetStatus => {
  const seen = new Set<PortraitView>();
  for (const portrait of portraits) {
    if (portrait.portraitView !== undefined) {
      seen.add(portrait.portraitView);
    }
  }

  // Preserve the canonical ordering in `presentViews` so renderers can trust
  // it without extra sorting. Unknown views fall at the end in enum order.
  const ordered: PortraitView[] = [];
  const allViews: PortraitView[] = [
    "front",
    "three_quarter",
    "side",
    "back",
    "custom",
  ];
  for (const view of allViews) {
    if (seen.has(view)) ordered.push(view);
  }

  const hasFront = seen.has("front");
  const hasSide = seen.has("side");
  const hasBack = seen.has("back");

  const missingCanonical = CANONICAL_PORTRAIT_VIEWS.filter(
    (view) => !seen.has(view),
  );

  return {
    presentViews: ordered,
    hasFront,
    hasSide,
    hasBack,
    hasCanonicalThreeView: hasFront && hasSide && hasBack,
    missingCanonical,
  };
};
