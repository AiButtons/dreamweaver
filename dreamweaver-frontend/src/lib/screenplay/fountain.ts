import type { ScreenplayDocument, ScreenplayInput } from "./types";
import {
  deriveSceneHeading,
  deriveShotNumber,
  formatShotMetaSlug,
  traverseStoryboard,
} from "./traverse";
import { formatReviewRound } from "@/lib/cut-tier";

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

const escapeBoneyard = (text: string): string => text.replace(/\/\*/g, "/ *").replace(/\*\//g, "* /");

const boneyardLine = (text: string): string => `/* ${escapeBoneyard(text)} */`;

const normalizeSegment = (segment: string): string => {
  const trimmed = (segment ?? "").trim();
  if (!trimmed) return "";
  // Fountain action is any paragraph not matching another element; we escape
  // boneyard openers in user text so they don't accidentally swallow following lines.
  return escapeBoneyard(trimmed);
};

export const toFountain = (input: ScreenplayInput): ScreenplayDocument => {
  const lines: string[] = [];

  const notesLine = formatCutAndRoundNote(input.cutTier, input.reviewRound);
  const hasTitlePage =
    Boolean(input.author) || Boolean(input.draftDate) || Boolean(notesLine);
  if (hasTitlePage || input.title) {
    if (input.title) lines.push(`Title: ${input.title}`);
    if (input.author) lines.push(`Author: ${input.author}`);
    if (input.draftDate) lines.push(`Draft date: ${input.draftDate}`);
    if (notesLine) lines.push(`Notes: ${notesLine}`);
  }
  if (hasTitlePage) {
    lines.push("");
    lines.push("====");
    lines.push("");
  } else if (input.title) {
    // Single title line only — separate from body with blank line.
    lines.push("");
  }

  const scenes = traverseStoryboard(input);

  scenes.forEach((scene, sceneIdx) => {
    const heading = deriveSceneHeading(scene.sceneNode, scene.sceneIndex);
    // Fountain requires a blank line before a scene heading.
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push(heading);
    lines.push("");

    if (scene.sceneNode?.label) {
      lines.push(boneyardLine(`Scene ${scene.sceneIndex} — ${scene.sceneNode.label}`));
      lines.push("");
    }

    const sceneAction = normalizeSegment(scene.sceneNode?.segment ?? "");
    if (sceneAction) {
      lines.push(sceneAction);
      lines.push("");
    }

    scene.shots.forEach((shot, shotIdx) => {
      const shotNumber = deriveShotNumber(shot, scene.sceneIndex, shotIdx);
      const slug = formatShotMetaSlug(shot.shotMeta);
      const header = slug
        ? `Shot ${shotNumber} — ${slug}`
        : `Shot ${shotNumber}`;
      lines.push(boneyardLine(header));
      const meta = shot.shotMeta;
      if (meta?.blockingNotes) {
        lines.push(boneyardLine(`Blocking: ${meta.blockingNotes}`));
      }
      if (meta?.props && meta.props.length > 0) {
        lines.push(boneyardLine(`Props: ${meta.props.join(", ")}`));
      }
      if (meta?.sfx && meta.sfx.length > 0) {
        lines.push(boneyardLine(`SFX: ${meta.sfx.join(", ")}`));
      }
      if (meta?.vfx && meta.vfx.length > 0) {
        lines.push(boneyardLine(`VFX: ${meta.vfx.join(", ")}`));
      }
      lines.push("");
      const action = normalizeSegment(shot.segment ?? "");
      if (action) {
        lines.push(action);
        lines.push("");
      }
    });

    const isLast = sceneIdx === scenes.length - 1;
    if (scene.transitionOut && !isLast) {
      lines.push(scene.transitionOut);
      lines.push("");
    }
  });

  // Collapse runs of >2 blank lines and trim trailing blanks.
  const normalized: string[] = [];
  for (const line of lines) {
    if (line === "" && normalized[normalized.length - 1] === "") continue;
    normalized.push(line);
  }
  while (normalized.length > 0 && normalized[normalized.length - 1] === "") {
    normalized.pop();
  }
  const content = `${normalized.join("\n")}\n`;

  return {
    content,
    mimeType: "text/plain",
    fileExtension: "fountain",
  };
};
