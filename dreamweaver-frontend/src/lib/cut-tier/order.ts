export type CutTier =
  | "assembly"
  | "editors"
  | "directors"
  | "producers"
  | "pictureLock"
  | "online"
  | "delivered";

export const CUT_TIER_ORDER: Record<CutTier, number> = {
  assembly: 0,
  editors: 1,
  directors: 2,
  producers: 3,
  pictureLock: 4,
  online: 5,
  delivered: 6,
};

export const CUT_TIER_LABELS: Record<CutTier, string> = {
  assembly: "Assembly",
  editors: "Editor's Cut",
  directors: "Director's Cut",
  producers: "Producer's Cut",
  pictureLock: "Picture Lock",
  online: "Online / Color",
  delivered: "Delivered",
};

/** Monotonic progression: to-tier order must be >= from-tier order.
 *  If `from` is undefined, any `to` is allowed. */
export const canPromoteCutTier = (from: CutTier | undefined, to: CutTier): boolean => {
  if (!from) return true;
  return CUT_TIER_ORDER[to] >= CUT_TIER_ORDER[from];
};

/** Returns the next tier in the ladder, or null if already at "delivered" or no current tier. */
export const nextCutTier = (current: CutTier | undefined): CutTier | null => {
  const order: CutTier[] = [
    "assembly",
    "editors",
    "directors",
    "producers",
    "pictureLock",
    "online",
    "delivered",
  ];
  if (!current) return "assembly";
  const idx = order.indexOf(current);
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
};

/** Render a review round number as "R1", "R2", … */
export const formatReviewRound = (round: number | undefined | null): string | null => {
  if (round == null) return null;
  if (!Number.isFinite(round) || round < 1) return null;
  return `R${Math.floor(round)}`;
};
