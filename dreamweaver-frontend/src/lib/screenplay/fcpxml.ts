import type { ScreenplayDocument, ScreenplayInput, ScreenplayNodeInput } from "./types";
import { deriveShotNumber, traverseStoryboard } from "./traverse";
import {
  DEFAULT_FRAME_RATE,
  DEFAULT_SEQUENCE_START,
  frameRateTimebase,
  isNtscFrameRate,
  normalizeFrameRate,
  secondsToFrames,
  smpteToFrames,
} from "./timecode";

const DEFAULT_SHOT_DURATION_S = 3;

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const escapeUrl = (value: string): string => {
  try {
    // Preserve already-encoded URLs; only escape XML-sensitive chars.
    return escapeXml(value);
  } catch {
    return escapeXml(value);
  }
};

const slugifyClipName = (raw: string): string => {
  const base = (raw ?? "").toLowerCase().trim();
  const slug = base
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return slug.slice(0, 64) || "shot";
};

const rateBlock = (tb: number, ntsc: boolean, indent: string): string[] => [
  `${indent}<rate>`,
  `${indent}  <timebase>${tb}</timebase>`,
  `${indent}  <ntsc>${ntsc ? "TRUE" : "FALSE"}</ntsc>`,
  `${indent}</rate>`,
];

export const toFcpXml = (input: ScreenplayInput): ScreenplayDocument => {
  const fps = normalizeFrameRate(input.frameRate ?? DEFAULT_FRAME_RATE);
  const tb = frameRateTimebase(fps);
  const ntsc = isNtscFrameRate(fps);
  const defaultDuration = input.defaultShotDurationS ?? DEFAULT_SHOT_DURATION_S;
  const sequenceStartStr = input.sequenceStart ?? DEFAULT_SEQUENCE_START;
  const sequenceStartFramesRaw = smpteToFrames(sequenceStartStr, fps);
  const sequenceStartFrames = Number.isFinite(sequenceStartFramesRaw)
    ? sequenceStartFramesRaw
    : smpteToFrames(DEFAULT_SEQUENCE_START, fps);

  const scenes = traverseStoryboard(input);

  type FcpShotEntry = {
    shot: ScreenplayNodeInput;
    sceneIndex: number;
    shotInScene: number;
  };
  const shots: FcpShotEntry[] = [];
  for (const scene of scenes) {
    scene.shots.forEach((shot, shotIdx) => {
      shots.push({ shot, sceneIndex: scene.sceneIndex, shotInScene: shotIdx });
    });
  }

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<!DOCTYPE xmeml>");
  lines.push('<xmeml version="5">');
  lines.push("  <sequence>");
  lines.push(`    <name>${escapeXml(input.title || "Untitled")}</name>`);

  // Compute total duration (frames) from the shot list.
  let running = 0;
  const clipFrames: number[] = [];
  for (const entry of shots) {
    const d = entry.shot.shotMeta?.durationS ?? defaultDuration;
    const frames = Math.max(1, secondsToFrames(d, fps));
    clipFrames.push(frames);
    running += frames;
  }
  lines.push(`    <duration>${running}</duration>`);
  lines.push(...rateBlock(tb, ntsc, "    "));

  lines.push("    <timecode>");
  lines.push(...rateBlock(tb, ntsc, "      "));
  lines.push(`      <string>${sequenceStartStr}</string>`);
  lines.push(`      <frame>${sequenceStartFrames}</frame>`);
  lines.push("      <displayformat>NDF</displayformat>");
  lines.push("    </timecode>");

  lines.push("    <media>");
  lines.push("      <video>");
  lines.push("        <track>");

  let cursor = 0;
  shots.forEach((entry, idx) => {
    const { shot, sceneIndex, shotInScene } = entry;
    const shotNumber = deriveShotNumber(shot, sceneIndex, shotInScene);
    const clipName = slugifyClipName(`${shotNumber}_${shot.label || "shot"}`);
    const frames = clipFrames[idx] ?? secondsToFrames(defaultDuration, fps);
    const recStart = cursor;
    const recEnd = cursor + frames;
    const clipId = `clipitem-${idx + 1}`;
    const fileId = `file-${idx + 1}`;
    const pathUrl = `file:///placeholder/${clipName}.mov`;

    lines.push(`          <clipitem id="${clipId}">`);
    lines.push(`            <name>${escapeXml(clipName)}</name>`);
    lines.push(`            <duration>${frames}</duration>`);
    lines.push(...rateBlock(tb, ntsc, "            "));
    lines.push(`            <in>0</in>`);
    lines.push(`            <out>${frames}</out>`);
    lines.push(`            <start>${recStart}</start>`);
    lines.push(`            <end>${recEnd}</end>`);
    lines.push(`            <file id="${fileId}">`);
    lines.push(`              <name>${escapeXml(clipName)}</name>`);
    lines.push(`              <pathurl>${escapeUrl(pathUrl)}</pathurl>`);
    lines.push(...rateBlock(tb, ntsc, "              "));
    lines.push(`              <duration>${frames}</duration>`);
    lines.push(`            </file>`);
    lines.push(`          </clipitem>`);

    cursor += frames;
  });

  lines.push("        </track>");
  lines.push("      </video>");
  lines.push("    </media>");
  lines.push("  </sequence>");
  lines.push("</xmeml>");
  lines.push("");

  return {
    content: lines.join("\n"),
    mimeType: "application/xml",
    fileExtension: "xml",
  };
};
