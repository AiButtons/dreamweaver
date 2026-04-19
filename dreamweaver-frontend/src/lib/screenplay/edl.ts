import type { ScreenplayDocument, ScreenplayInput, ScreenplayNodeInput } from "./types";
import {
  deriveShotNumber,
  formatShotMetaSlug,
  traverseStoryboard,
} from "./traverse";
import { formatReviewRound } from "@/lib/cut-tier";
import {
  DEFAULT_FRAME_RATE,
  DEFAULT_SEQUENCE_START,
  framesToSmpte,
  normalizeFrameRate,
  secondsToFrames,
  smpteToFrames,
} from "./timecode";

const DEFAULT_SHOT_DURATION_S = 3;

const padEightChars = (raw: string): string => {
  const upper = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const truncated = upper.slice(0, 8);
  return truncated.padEnd(8, " ");
};

const deriveReelName = (shotNumber: string): string => {
  if (shotNumber && shotNumber.trim().length > 0) {
    return padEightChars(shotNumber);
  }
  return padEightChars("AX");
};

const slugifyClipName = (raw: string): string => {
  const base = (raw ?? "").toLowerCase().trim();
  const slug = base
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return slug.slice(0, 32);
};

const formatCutAndRoundNote = (
  cutTier: string | undefined,
  reviewRound: number | undefined,
): string | null => {
  const tier = cutTier?.trim() || undefined;
  const round = formatReviewRound(reviewRound);
  if (tier && round) return `${tier} (${round})`;
  if (tier) return tier;
  if (round) return round;
  return null;
};

const padEditNumber = (n: number): string => {
  if (n < 10) return `00${n}`;
  if (n < 100) return `0${n}`;
  return `${n}`;
};

export const toEdl = (input: ScreenplayInput): ScreenplayDocument => {
  const fps = normalizeFrameRate(input.frameRate ?? DEFAULT_FRAME_RATE);
  const defaultDuration = input.defaultShotDurationS ?? DEFAULT_SHOT_DURATION_S;
  const sequenceStartStr = input.sequenceStart ?? DEFAULT_SEQUENCE_START;
  const sequenceStartFramesRaw = smpteToFrames(sequenceStartStr, fps);
  const sequenceStartFrames = Number.isFinite(sequenceStartFramesRaw)
    ? sequenceStartFramesRaw
    : smpteToFrames(DEFAULT_SEQUENCE_START, fps);

  const scenes = traverseStoryboard(input);

  // Flatten scenes into a single linear shot list for the EDL.
  type EdlShotEntry = { shot: ScreenplayNodeInput; sceneIndex: number; shotInScene: number };
  const shots: EdlShotEntry[] = [];
  for (const scene of scenes) {
    scene.shots.forEach((shot, shotIdx) => {
      shots.push({ shot, sceneIndex: scene.sceneIndex, shotInScene: shotIdx });
    });
  }

  const lines: string[] = [];
  lines.push(`TITLE: ${input.title || "Untitled"}`);
  lines.push("FCM: NON-DROP FRAME");
  lines.push("");

  let runningFrames = sequenceStartFrames;
  const notesLine = formatCutAndRoundNote(input.cutTier, input.reviewRound);

  shots.forEach((entry, idx) => {
    const { shot, sceneIndex, shotInScene } = entry;
    const shotNumber = deriveShotNumber(shot, sceneIndex, shotInScene);
    const reel = deriveReelName(shotNumber);
    const durationS = shot.shotMeta?.durationS ?? defaultDuration;
    const durationFrames = Math.max(1, secondsToFrames(durationS, fps));

    const srcIn = framesToSmpte(0, fps);
    const srcOut = framesToSmpte(durationFrames, fps);
    const recIn = framesToSmpte(runningFrames, fps);
    const recOut = framesToSmpte(runningFrames + durationFrames, fps);

    const editNumber = padEditNumber(idx + 1);
    lines.push(`${editNumber}  ${reel}  V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`);

    const clipName = slugifyClipName(`${shotNumber}_${shot.label || "shot"}`);
    lines.push(`* FROM CLIP NAME: ${clipName}`);

    const slug = formatShotMetaSlug(shot.shotMeta);
    if (slug) {
      lines.push(`* COMMENT: ${slug}`);
    }

    if (idx === 0 && notesLine) {
      lines.push(`* COMMENT: Cut: ${notesLine}`);
    }

    runningFrames += durationFrames;
  });

  if (shots.length === 0 && notesLine) {
    // Surface cut-tier/round even when there are no shots (header-only doc).
    lines.push(`* COMMENT: Cut: ${notesLine}`);
  }

  lines.push("");

  return {
    content: lines.join("\n"),
    mimeType: "text/plain",
    fileExtension: "edl",
  };
};
