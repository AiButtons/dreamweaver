import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { getToken } from "@/lib/auth-server";
import { queryRef } from "@/lib/convexRefs";
import {
  exportScreenplay,
  type ScreenplayEdgeInput,
  type ScreenplayFormat,
  type ScreenplayInput,
  type ScreenplayNodeInput,
} from "@/lib/screenplay";
import type { NodeType } from "@/app/storyboard/types";
import { CUT_TIER_LABELS, type CutTier } from "@/lib/cut-tier";

export const runtime = "nodejs";

interface ExportRequestBody {
  storyboardId?: string;
  format?: string;
  title?: string;
  author?: string;
  draftDate?: string;
  frameRate?: number;
  sequenceStart?: string;
  defaultShotDurationS?: number;
}

const SUPPORTED_FORMATS: ReadonlySet<ScreenplayFormat> = new Set([
  "fountain",
  "fdx",
  "edl",
  "fcpxml",
]);

const slugifyTitle = (raw: string | undefined): string => {
  const base = (raw ?? "").toLowerCase().trim();
  const slug = base
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.length > 0 ? slug : "storyboard";
};

type SnapshotNode = {
  nodeId: string;
  nodeType: NodeType;
  label: string;
  segment: string;
  position: { x: number; y: number };
  shotMeta?: ScreenplayNodeInput["shotMeta"];
  entityRefs?: ScreenplayNodeInput["entityRefs"];
};

type SnapshotEdge = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: ScreenplayEdgeInput["edgeType"];
  isPrimary?: boolean;
  order?: number;
  branchId?: string;
};

type StoryboardSnapshot = {
  storyboard: { title?: string } | null;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
} | null;

const mapSnapshotToInput = (
  snapshot: NonNullable<StoryboardSnapshot>,
  overrides: {
    title?: string;
    author?: string;
    draftDate?: string;
    cutTier?: string;
    reviewRound?: number;
    frameRate?: number;
    sequenceStart?: string;
    defaultShotDurationS?: number;
  },
): ScreenplayInput => {
  const title = overrides.title?.trim() || snapshot.storyboard?.title?.trim() || "Untitled";
  return {
    title,
    author: overrides.author,
    draftDate: overrides.draftDate,
    cutTier: overrides.cutTier,
    reviewRound: overrides.reviewRound,
    frameRate: overrides.frameRate,
    sequenceStart: overrides.sequenceStart,
    defaultShotDurationS: overrides.defaultShotDurationS,
    nodes: snapshot.nodes.map((n) => ({
      nodeId: n.nodeId,
      nodeType: n.nodeType,
      label: n.label,
      segment: n.segment,
      position: n.position,
      shotMeta: n.shotMeta,
      entityRefs: n.entityRefs,
    })),
    edges: snapshot.edges.map((e) => ({
      edgeId: e.edgeId,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      edgeType: e.edgeType,
      isPrimary: e.isPrimary,
      order: e.order,
      branchId: e.branchId,
    })),
  };
};

export const POST = async (request: NextRequest) => {
  let body: ExportRequestBody;
  try {
    body = (await request.json()) as ExportRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const storyboardId = body.storyboardId?.trim();
  const format = body.format as ScreenplayFormat | undefined;
  if (!storyboardId) {
    return NextResponse.json({ error: "storyboardId is required." }, { status: 400 });
  }
  if (!format || !SUPPORTED_FORMATS.has(format)) {
    return NextResponse.json(
      { error: `format must be one of: fountain, fdx, edl, fcpxml.` },
      { status: 400 },
    );
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_CONVEX_URL is not configured." },
      { status: 500 },
    );
  }

  const token = await getToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);

  let snapshot: StoryboardSnapshot;
  try {
    snapshot = (await client.query(queryRef("storyboards:getStoryboardSnapshot"), {
      storyboardId,
    })) as StoryboardSnapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch storyboard.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!snapshot || !snapshot.storyboard) {
    return NextResponse.json({ error: "Storyboard not found." }, { status: 404 });
  }

  // Best-effort enrichment: pull the default branch's cutTier and its head
  // commit's reviewRound for the title page. Any failure falls back silently.
  let cutTierLabel: string | undefined;
  let reviewRound: number | undefined;
  try {
    const branches = (await client.query(
      queryRef("narrativeGit:listBranches"),
      { storyboardId },
    )) as Array<{
      branchId: string;
      isDefault: boolean;
      headCommitId?: string;
      cutTier?: CutTier;
    }> | null;
    const defaultBranch = Array.isArray(branches)
      ? branches.find((row) => row.isDefault)
      : undefined;
    if (defaultBranch?.cutTier) {
      cutTierLabel = CUT_TIER_LABELS[defaultBranch.cutTier];
    }
    if (defaultBranch?.headCommitId) {
      try {
        const commits = (await client.query(
          queryRef("narrativeGit:listBranchCommits"),
          { storyboardId, branchId: defaultBranch.branchId, limit: 1 },
        )) as Array<{ commitId: string; reviewRound?: number }> | null;
        if (Array.isArray(commits)) {
          const head = commits.find((row) => row.commitId === defaultBranch.headCommitId);
          if (head && typeof head.reviewRound === "number") {
            reviewRound = head.reviewRound;
          }
        }
      } catch {
        // best-effort; ignore failures
      }
    }
  } catch {
    // best-effort; ignore failures
  }

  const input = mapSnapshotToInput(snapshot, {
    title: body.title,
    author: body.author,
    draftDate: body.draftDate,
    cutTier: cutTierLabel,
    reviewRound,
    frameRate: typeof body.frameRate === "number" ? body.frameRate : undefined,
    sequenceStart: typeof body.sequenceStart === "string" ? body.sequenceStart : undefined,
    defaultShotDurationS:
      typeof body.defaultShotDurationS === "number" ? body.defaultShotDurationS : undefined,
  });

  let document;
  try {
    document = exportScreenplay(input, format);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const filename = `${slugifyTitle(input.title)}.${document.fileExtension}`;
  return new NextResponse(document.content, {
    status: 200,
    headers: {
      "Content-Type": `${document.mimeType}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
