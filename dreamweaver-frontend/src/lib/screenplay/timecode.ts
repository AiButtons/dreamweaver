/**
 * SMPTE timecode helpers for EDL / FCP7 XML emitters.
 *
 * MVP: non-drop-frame only. 29.97 / 59.94 / 23.976 accepted but encoded as
 * their rounded-integer timebase with the ntsc flag (the FCP7 XML consumer
 * handles the discrepancy).
 */

export const ACCEPTED_FRAME_RATES = [
  23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60,
] as const;
export type FrameRate = (typeof ACCEPTED_FRAME_RATES)[number];

export const DEFAULT_FRAME_RATE: FrameRate = 24;
export const DEFAULT_SEQUENCE_START = "01:00:00:00";

/** Return the closest accepted frame rate; falls back to DEFAULT_FRAME_RATE when undefined. */
export const normalizeFrameRate = (fps: number | undefined): FrameRate => {
  if (fps === undefined || !Number.isFinite(fps) || fps <= 0) return DEFAULT_FRAME_RATE;
  let best: FrameRate = DEFAULT_FRAME_RATE;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const rate of ACCEPTED_FRAME_RATES) {
    const diff = Math.abs(rate - fps);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = rate;
    }
  }
  return best;
};

/** Is this frame rate NTSC (23.976 / 29.97 / 59.94)? */
export const isNtscFrameRate = (fps: number): boolean => {
  return fps === 23.976 || fps === 29.97 || fps === 59.94;
};

/** Integer timebase used by FCP7 XML (rounds 23.976 → 24, 29.97 → 30, 59.94 → 60). */
export const frameRateTimebase = (fps: number): number => Math.round(fps);

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** Seconds → integer frames (rounded to nearest). */
export const secondsToFrames = (seconds: number, fps: number): number => {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.round(seconds * fps);
};

/** Frames → "HH:MM:SS:FF" (non-drop-frame). */
export const framesToSmpte = (totalFrames: number, fps: number): string => {
  const tb = frameRateTimebase(fps);
  const safe = Math.max(0, Math.floor(totalFrames));
  const frames = safe % tb;
  const totalSeconds = Math.floor(safe / tb);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}:${pad2(frames)}`;
};

/** Seconds → "HH:MM:SS:FF". */
export const secondsToSmpte = (seconds: number, fps: number): string => {
  return framesToSmpte(secondsToFrames(seconds, fps), fps);
};

const SMPTE_REGEX = /^(\d{1,3}):(\d{2}):(\d{2}):(\d{2})$/;

/** Parse "HH:MM:SS:FF" → total frames. Returns NaN on malformed input. */
export const smpteToFrames = (tc: string, fps: number): number => {
  const tb = frameRateTimebase(fps);
  const match = SMPTE_REGEX.exec((tc ?? "").trim());
  if (!match) return Number.NaN;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3]);
  const f = Number(match[4]);
  if (m >= 60 || s >= 60 || f >= tb) return Number.NaN;
  return ((h * 60 + m) * 60 + s) * tb + f;
};
