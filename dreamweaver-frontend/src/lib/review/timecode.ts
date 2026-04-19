/**
 * Pure helpers for timecode formatting/parsing and for grouping/ordering
 * review comments for display. No DOM / React / Convex deps — safe to import
 * from both the UI layer and tests.
 */

/**
 * Format a ms offset as `M:SS.mmm` (or `H:MM:SS.mmm` when >= 1 hour).
 * `undefined` / `null` / non-finite → the em-dash placeholder "—".
 * Negative inputs are clamped to 0 so a malformed call doesn't crash the UI.
 */
export const formatTimecode = (ms: number | undefined | null): string => {
  if (ms === undefined || ms === null) return "—";
  if (!Number.isFinite(ms)) return "—";
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const millis = safe % 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const pad3 = (n: number) => n.toString().padStart(3, "0");
  if (hours >= 1) {
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
  }
  return `${minutes}:${pad2(seconds)}.${pad3(millis)}`;
};

/**
 * Parse "1:23.456", "1:23", "83.456", "83" → ms. Returns null on invalid
 * or empty input. Accepts an optional leading hour component ("1:02:03.500").
 * Whitespace is trimmed.
 */
export const parseTimecode = (input: string): number | null => {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // Split on colons: could be "ss(.mmm)" | "mm:ss(.mmm)" | "hh:mm:ss(.mmm)"
  const parts = trimmed.split(":");
  if (parts.length > 3) return null;

  // Validate the final ss(.mmm) piece separately so "1:2a" fails fast.
  const last = parts[parts.length - 1];
  if (!/^\d+(\.\d+)?$/.test(last)) return null;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!/^\d+$/.test(parts[i])) return null;
  }

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 1) {
    seconds = Number(parts[0]);
  } else if (parts.length === 2) {
    minutes = Number(parts[0]);
    seconds = Number(parts[1]);
  } else {
    hours = Number(parts[0]);
    minutes = Number(parts[1]);
    seconds = Number(parts[2]);
  }
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  return Math.round(totalSeconds * 1000);
};

export interface SortableComment {
  _id: string;
  parentCommentId?: string | null;
  timecodeMs?: number | null;
  createdAt: number;
}

/**
 * Sort top-level comments (`parentCommentId` absent / null) by timecode
 * ascending with null timecodes sorted last. Within the same timecode
 * bucket, ties break by `createdAt` ascending. Replies are filtered out —
 * callers are expected to render them grouped under their parent.
 */
export const sortTopLevelByTimecode = <T extends SortableComment>(rows: T[]): T[] => {
  const topLevel = rows.filter((r) => !r.parentCommentId);
  return [...topLevel].sort((a, b) => {
    const aTc = a.timecodeMs;
    const bTc = b.timecodeMs;
    const aHas = aTc !== undefined && aTc !== null;
    const bHas = bTc !== undefined && bTc !== null;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (aHas && bHas) {
      if ((aTc as number) !== (bTc as number)) {
        return (aTc as number) - (bTc as number);
      }
    }
    return a.createdAt - b.createdAt;
  });
};

/**
 * Split a flat comment list into `topLevel` (sorted by timecode / createdAt)
 * and a `repliesByParent` lookup table (each list sorted by createdAt asc).
 */
export const groupComments = <T extends SortableComment>(
  rows: T[],
): { topLevel: T[]; repliesByParent: Map<string, T[]> } => {
  const topLevel = sortTopLevelByTimecode(rows);
  const repliesByParent = new Map<string, T[]>();
  for (const row of rows) {
    const parent = row.parentCommentId;
    if (!parent) continue;
    const bucket = repliesByParent.get(parent);
    if (bucket) {
      bucket.push(row);
    } else {
      repliesByParent.set(parent, [row]);
    }
  }
  for (const [, replies] of repliesByParent) {
    replies.sort((a, b) => a.createdAt - b.createdAt);
  }
  return { topLevel, repliesByParent };
};
