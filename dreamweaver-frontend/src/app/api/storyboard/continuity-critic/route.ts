import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { getToken } from "@/lib/auth-server";
import { mutationRef, queryRef } from "@/lib/convexRefs";
import { LLMFactory } from "@/lib/llm/LLMFactory";
import {
  buildCriticPrompt,
  CRITIC_RESPONSE_SCHEMA,
  parseCriticResponse,
  type CriticPromptEdge,
  type CriticPromptInput,
  type CriticPromptNode,
  type CriticResponse,
} from "@/lib/continuity-critic";
import { formatShotMetaSlug } from "@/lib/screenplay/traverse";
import { CUT_TIER_LABELS, type CutTier } from "@/lib/cut-tier";
import type { NodeType, ShotMeta } from "@/app/storyboard/types";

export const runtime = "nodejs";

/**
 * Model choice: `gemini-2.5-flash` — the same reasoning-tier model used by
 * `GeminiProvider.generateStructure` for schema-constrained JSON. Fast and
 * cheap; good enough for continuity criticism at storyboard density.
 */

interface CriticRequestBody {
  storyboardId?: string;
  branchId?: string;
}

type SnapshotNode = {
  nodeId: string;
  nodeType: NodeType;
  label: string;
  segment: string;
  shotMeta?: ShotMeta;
  entityRefs?: {
    characterIds?: string[];
  };
  continuity?: {
    wardrobeVariantIds?: string[];
  };
  historyContext?: {
    rollingSummary?: string;
  };
};

type SnapshotEdge = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  isPrimary?: boolean;
  order?: number;
};

type StoryboardSnapshot = {
  storyboard: { title?: string } | null;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
} | null;

const toPromptNode = (n: SnapshotNode): CriticPromptNode => {
  const slug = formatShotMetaSlug(n.shotMeta) ?? undefined;
  return {
    nodeId: n.nodeId,
    nodeType: n.nodeType,
    label: n.label,
    segment: n.segment,
    characterIds: n.entityRefs?.characterIds,
    wardrobeVariantIds: n.continuity?.wardrobeVariantIds,
    rollingSummary: n.historyContext?.rollingSummary,
    shotMetaSlug: slug,
  };
};

const toPromptEdge = (e: SnapshotEdge): CriticPromptEdge => ({
  sourceNodeId: e.sourceNodeId,
  targetNodeId: e.targetNodeId,
  isPrimary: e.isPrimary,
  order: e.order,
});

export const POST = async (request: NextRequest) => {
  let body: CriticRequestBody;
  try {
    body = (await request.json()) as CriticRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const storyboardId = body.storyboardId?.trim();
  if (!storyboardId) {
    return NextResponse.json(
      { error: "storyboardId is required." },
      { status: 400 },
    );
  }

  if (!process.env.GEMINI_API_KEY && !process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "LLM not configured" },
      { status: 503 },
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
    snapshot = (await client.query(
      queryRef("storyboards:getStoryboardSnapshot"),
      { storyboardId },
    )) as StoryboardSnapshot;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch storyboard.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!snapshot || !snapshot.storyboard) {
    return NextResponse.json(
      { error: "Storyboard not found." },
      { status: 404 },
    );
  }

  // Best-effort enrichment: pull cutTier + reviewRound from the default branch
  // and its head commit. Any failure silently falls back to undefined.
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
          {
            storyboardId,
            branchId: defaultBranch.branchId,
            limit: 1,
          },
        )) as Array<{ commitId: string; reviewRound?: number }> | null;
        if (Array.isArray(commits)) {
          const head = commits.find(
            (row) => row.commitId === defaultBranch.headCommitId,
          );
          if (head && typeof head.reviewRound === "number") {
            reviewRound = head.reviewRound;
          }
        }
      } catch {
        // best-effort; ignore
      }
    }
  } catch {
    // best-effort; ignore
  }

  const input: CriticPromptInput = {
    storyboardTitle: snapshot.storyboard.title?.trim() || "Untitled",
    cutTierLabel,
    reviewRound,
    nodes: snapshot.nodes.map(toPromptNode),
    edges: snapshot.edges.map(toPromptEdge),
    maxNodes: 80,
  };

  const built = buildCriticPrompt(input);
  const knownNodeIds = new Set(snapshot.nodes.map((n) => n.nodeId));

  // Invoke Gemini through the shared LLM provider. The provider already
  // supports JSON-schema-constrained structured output — see
  // GeminiProvider.generateStructure (responseMimeType + responseSchema).
  let parsed: CriticResponse;
  try {
    const provider = LLMFactory.getProvider();
    const structured = await provider.generateStructure<unknown>(
      built.userPrompt,
      CRITIC_RESPONSE_SCHEMA,
      { systemInstruction: built.systemPrompt },
    );
    parsed = parseCriticResponse(
      (structured ?? {}) as object,
      knownNodeIds,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "LLM call failed.";
    // Soft-fail: return 200 so the UI button doesn't show a destructive
    // error. The user can simply retry.
    return NextResponse.json(
      {
        cleared: 0,
        inserted: 0,
        truncated: built.truncated,
        error: message,
      },
      { status: 200 },
    );
  }

  let cleared = 0;
  let inserted = 0;
  try {
    const result = (await client.mutation(
      mutationRef("continuityOS:recordContinuityCriticViolations"),
      {
        storyboardId,
        branchId: body.branchId,
        violations: parsed.violations,
      },
    )) as { cleared?: number; inserted?: number } | null;
    cleared = result?.cleared ?? 0;
    inserted = result?.inserted ?? 0;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Persistence failed.";
    return NextResponse.json(
      {
        cleared: 0,
        inserted: 0,
        truncated: built.truncated,
        error: message,
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      cleared,
      inserted,
      truncated: built.truncated,
    },
    { status: 200 },
  );
};
