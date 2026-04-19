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

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

type ParagraphType =
  | "Scene Heading"
  | "Action"
  | "General"
  | "Transition"
  | "Title"
  | "Author";

const paragraph = (type: ParagraphType, text: string, indent = "    "): string[] => {
  return [
    `${indent}<Paragraph Type="${type}">`,
    `${indent}  <Text>${escapeXml(text)}</Text>`,
    `${indent}</Paragraph>`,
  ];
};

export const toFdx = (input: ScreenplayInput): ScreenplayDocument => {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>');
  lines.push('<FinalDraft DocumentType="Script" Template="No" Version="5">');
  lines.push("  <Content>");

  const scenes = traverseStoryboard(input);

  scenes.forEach((scene, sceneIdx) => {
    const heading = deriveSceneHeading(scene.sceneNode, scene.sceneIndex);
    lines.push(...paragraph("Scene Heading", heading));

    const sceneAction = (scene.sceneNode?.segment ?? "").trim();
    if (sceneAction) {
      lines.push(...paragraph("Action", sceneAction));
    }

    scene.shots.forEach((shot, shotIdx) => {
      const shotNumber = deriveShotNumber(shot, scene.sceneIndex, shotIdx);
      const slug = formatShotMetaSlug(shot.shotMeta);
      const shotLabel = slug
        ? `[Shot ${shotNumber} — ${slug}]`
        : `[Shot ${shotNumber}]`;
      lines.push(...paragraph("General", shotLabel));
      const meta = shot.shotMeta;
      if (meta?.blockingNotes) {
        lines.push(...paragraph("General", `[Blocking: ${meta.blockingNotes}]`));
      }
      if (meta?.props && meta.props.length > 0) {
        lines.push(...paragraph("General", `[Props: ${meta.props.join(", ")}]`));
      }
      if (meta?.sfx && meta.sfx.length > 0) {
        lines.push(...paragraph("General", `[SFX: ${meta.sfx.join(", ")}]`));
      }
      if (meta?.vfx && meta.vfx.length > 0) {
        lines.push(...paragraph("General", `[VFX: ${meta.vfx.join(", ")}]`));
      }
      const action = (shot.segment ?? "").trim();
      if (action) {
        lines.push(...paragraph("Action", action));
      }
    });

    const isLast = sceneIdx === scenes.length - 1;
    if (scene.transitionOut && !isLast) {
      lines.push(...paragraph("Transition", scene.transitionOut));
    }
  });

  lines.push("  </Content>");

  const notesLine = formatCutAndRoundNote(input.cutTier, input.reviewRound);
  const hasTitlePage = Boolean(input.title) || Boolean(input.author) || Boolean(notesLine);
  if (hasTitlePage) {
    lines.push("  <TitlePage>");
    lines.push("    <Content>");
    if (input.title) {
      lines.push(...paragraph("Title", input.title, "      "));
    }
    if (input.author) {
      lines.push(...paragraph("Author", input.author, "      "));
    }
    if (notesLine) {
      lines.push(...paragraph("General", notesLine, "      "));
    }
    lines.push("    </Content>");
    lines.push("  </TitlePage>");
  }

  lines.push("</FinalDraft>");
  lines.push("");

  return {
    content: lines.join("\n"),
    mimeType: "application/xml",
    fileExtension: "fdx",
  };
};
