/**
 * ViMax M3 Phase 1 — Idea2Video ingestion route.
 *
 * POST { title, idea, style, userRequirement? }
 *   → creates a fresh storyboard (mode="agent_draft")
 *   → calls the Python storyboard-agent `/idea-ingest` (:8123 by default)
 *     which internally runs Screenwriter.develop_story + write_script +
 *     M1's screenplay_ingester — returns the same IngestionResult shape as
 *     /ingest-screenplay
 *   → generates 3-view portraits (front + conditioned side/back) + writes
 *     identityPacks + portrait refs + nodes + edges into Convex
 *   → returns `{ storyboardId, ... }` to the client
 *
 * Shares the portrait + Convex write pipeline with /ingest-screenplay. The
 * only differences are the Python endpoint and the request body (idea
 * instead of screenplay). A future refactor can extract the shared
 * "process IngestionResult → write to Convex" helper; for now duplication
 * keeps each route readable as a single file.
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { getToken } from "@/lib/auth-server";
import { mutationRef, queryRef } from "@/lib/convexRefs";

export const runtime = "nodejs";
export const maxDuration = 600;

const PYTHON_BASE_URL =
  process.env.STORYBOARD_AGENT_BASE_URL || "http://localhost:8123";
const INGEST_TIMEOUT_MS = 5 * 60 * 1000;
const PORTRAIT_TIMEOUT_MS = 90 * 1000;

interface IngestIdeaRequestBody {
  title?: string;
  idea?: string;
  style?: string;
  userRequirement?: string;
}

type PortraitView = "front" | "side" | "back" | "three_quarter" | "custom";

interface PythonIngestedCharacter {
  identifier: string;
  staticFeatures: string;
  dynamicFeatures: string;
  isVisible: boolean;
  identityPackName: string;
}

interface PythonIngestedPortrait {
  characterIdentifier: string;
  view: PortraitView;
  sourceUrl: string;
  prompt: string;
  conditionOnView?: PortraitView | null;
}

interface PythonIngestedShotNode {
  nodeId: string;
  nodeType: "scene" | "shot";
  label: string;
  segment: string;
  position: { x: number; y: number };
  shotMeta: Record<string, unknown> | null;
  promptPack: Record<string, unknown> | null;
  characterIdentifiers: string[];
}

interface PythonIngestedEdge {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: "serial" | "parallel" | "branch" | "merge";
  isPrimary: boolean;
  order: number | null;
}

interface PythonIngestionResult {
  storyboardId: string;
  screenplayLength: number;
  characters: PythonIngestedCharacter[];
  portraits: PythonIngestedPortrait[];
  nodes: PythonIngestedShotNode[];
  edges: PythonIngestedEdge[];
  pipelineDurationMs: number;
  llmCallCount: number;
  preprocessed: boolean;
}

const stripNulls = <T>(value: T): T => {
  if (value === null) return undefined as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => stripNulls(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const scrubbed = stripNulls(raw);
      if (scrubbed !== undefined) out[key] = scrubbed;
    }
    return out as T;
  }
  return value;
};

const cheapDnaFromCharacter = (c: PythonIngestedCharacter): string => {
  const tokens = [c.staticFeatures, c.dynamicFeatures]
    .filter((s) => s && s.length > 0)
    .join(" ");
  return JSON.stringify({
    sourceIdentifier: c.identifier,
    staticFeatures: c.staticFeatures,
    dynamicFeatures: c.dynamicFeatures,
    textSummary: tokens.slice(0, 500),
  });
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const generatePortraitImage = async (
  origin: string,
  prompt: string,
  cookieHeader: string | null,
  referenceImageUrls?: string[],
): Promise<string | null> => {
  try {
    const res = await fetchWithTimeout(
      `${origin}/api/media/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        body: JSON.stringify({
          prompt,
          type: "image",
          config: { aspect_ratio: "9:16" },
          reference_image_urls:
            referenceImageUrls && referenceImageUrls.length > 0
              ? referenceImageUrls
              : undefined,
        }),
      },
      PORTRAIT_TIMEOUT_MS,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`portrait gen failed: ${res.status} ${text.slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { url?: string };
    return data.url && data.url.length > 0 ? data.url : null;
  } catch (err) {
    console.warn("portrait gen exception", err);
    return null;
  }
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: IngestIdeaRequestBody;
  try {
    body = (await request.json()) as IngestIdeaRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const title = (body.title ?? "").trim() || "Untitled idea";
  const idea = (body.idea ?? "").trim();
  const style = (body.style ?? "").trim() || "Cinematic, natural lighting";
  const userRequirement = (body.userRequirement ?? "").trim();
  if (idea.length < 5) {
    return NextResponse.json(
      { error: "idea must be at least 5 characters" },
      { status: 400 },
    );
  }
  if (idea.length > 4000) {
    return NextResponse.json(
      { error: "idea must be under 4,000 characters" },
      { status: 400 },
    );
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_CONVEX_URL not configured" },
      { status: 500 },
    );
  }
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);

  // Create a fresh storyboard first so we can surface it to the user even
  // if the Python pipeline fails mid-flight.
  let storyboardId: string;
  try {
    storyboardId = (await client.mutation(
      mutationRef("storyboards:createStoryboard"),
      { title, mode: "agent_draft" },
    )) as string;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "createStoryboard failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Call Python /idea-ingest — runs Screenwriter + screenplay_ingester end-to-end.
  let pythonResult: PythonIngestionResult;
  try {
    const res = await fetchWithTimeout(
      `${PYTHON_BASE_URL}/idea-ingest`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          storyboardId,
          idea,
          style,
          userRequirement,
          mediaBaseUrl: request.nextUrl.origin,
        }),
      },
      INGEST_TIMEOUT_MS,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        {
          error: `storyboard-agent returned ${res.status}: ${text.slice(0, 500)}`,
          storyboardId,
        },
        { status: 502 },
      );
    }
    pythonResult = (await res.json()) as PythonIngestionResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "idea-ingest failed";
    return NextResponse.json(
      { error: `storyboard-agent unreachable: ${msg}`, storyboardId },
      { status: 502 },
    );
  }

  // --- From here on, this flow is identical to /ingest-screenplay. A future
  // --- refactor can extract the shared tail into a helper.
  const cookieHeader = request.headers.get("cookie");
  const origin = request.nextUrl.origin;
  const portraitUrlResults: (string | null)[] = new Array(
    pythonResult.portraits.length,
  ).fill(null);
  const resolvedPortraitUrls = new Map<string, string>();
  const portraitKey = (characterId: string, view: PortraitView): string =>
    `${characterId}::${view}`;

  const pass1Indices: number[] = [];
  const pass2Indices: number[] = [];
  pythonResult.portraits.forEach((p, i) => {
    if (p.conditionOnView) pass2Indices.push(i);
    else pass1Indices.push(i);
  });

  await Promise.all(
    pass1Indices.map(async (i) => {
      const p = pythonResult.portraits[i];
      const url = await generatePortraitImage(origin, p.prompt, cookieHeader);
      portraitUrlResults[i] = url;
      if (url) resolvedPortraitUrls.set(portraitKey(p.characterIdentifier, p.view), url);
    }),
  );

  await Promise.all(
    pass2Indices.map(async (i) => {
      const p = pythonResult.portraits[i];
      const refView = (p.conditionOnView ?? null) as PortraitView | null;
      const refUrl = refView
        ? resolvedPortraitUrls.get(portraitKey(p.characterIdentifier, refView))
        : undefined;
      if (refView && !refUrl) {
        console.warn(
          `[ingest-idea] portrait "${p.characterIdentifier}/${p.view}" needed ${refView} reference — skipping`,
        );
        portraitUrlResults[i] = null;
        return;
      }
      const url = await generatePortraitImage(
        origin,
        p.prompt,
        cookieHeader,
        refUrl ? [refUrl] : undefined,
      );
      portraitUrlResults[i] = url;
      if (url) resolvedPortraitUrls.set(portraitKey(p.characterIdentifier, p.view), url);
    }),
  );

  const packIdByCharacter = new Map<string, string>();
  const identityPackFailures: string[] = [];
  for (const c of pythonResult.characters) {
    try {
      const packAppId = `pack_${c.identifier.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}_${Date.now().toString(36)}`;
      await client.mutation(mutationRef("continuityOS:upsertIdentityPack"), {
        storyboardId,
        packId: packAppId,
        name: c.identityPackName || c.identifier,
        description: `${c.staticFeatures}\n\n${c.dynamicFeatures}`.trim(),
        dnaJson: cheapDnaFromCharacter(c),
        sourceCharacterId: c.identifier,
        visibility: "project",
      });
      const bundle = (await client.query(
        queryRef("continuityOS:listConstraintBundle"),
        { storyboardId },
      )) as {
        identityPacks?: Array<{ _id: string; packId: string }>;
      } | null;
      const hit = bundle?.identityPacks?.find((row) => row.packId === packAppId);
      if (hit) packIdByCharacter.set(c.identifier, hit._id);
      else identityPackFailures.push(`${c.identifier}: pack row not found after upsert`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      identityPackFailures.push(`${c.identifier}: ${msg}`);
    }
  }

  let portraitsWritten = 0;
  for (let i = 0; i < pythonResult.portraits.length; i += 1) {
    const p = pythonResult.portraits[i];
    const sourceUrl = portraitUrlResults[i];
    if (!sourceUrl) continue;
    const ownerPackId = packIdByCharacter.get(p.characterIdentifier);
    if (!ownerPackId) continue;
    try {
      await client.mutation(mutationRef("identityReferences:addIdentityPortrait"), {
        storyboardId,
        ownerPackId,
        portraitView: p.view,
        sourceUrl,
        prompt: p.prompt,
        modelId: "llm-factory",
      });
      portraitsWritten += 1;
    } catch (err) {
      console.warn(`portrait write failed for ${p.characterIdentifier}`, err);
    }
  }

  let nodesWritten = 0;
  let edgesWritten = 0;
  if (pythonResult.nodes.length > 0) {
    try {
      const scrubbedNodes = pythonResult.nodes.map((n) =>
        stripNulls({
          nodeId: n.nodeId,
          nodeType: n.nodeType,
          label: n.label,
          segment: n.segment,
          position: n.position,
          shotMeta: n.shotMeta ?? undefined,
          promptPack: n.promptPack ?? undefined,
          characterIds:
            n.characterIdentifiers && n.characterIdentifiers.length > 0
              ? n.characterIdentifiers
              : undefined,
        }),
      );
      const res = (await client.mutation(
        mutationRef("storyboards:bulkCreateNodes"),
        { storyboardId: storyboardId as Id<"storyboards">, nodes: scrubbedNodes },
      )) as { total?: number } | undefined;
      nodesWritten = res?.total ?? pythonResult.nodes.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "bulkCreateNodes failed";
      return NextResponse.json(
        { error: `node write failed: ${msg}`, storyboardId },
        { status: 500 },
      );
    }
  }
  if (pythonResult.edges.length > 0) {
    try {
      const scrubbedEdges = pythonResult.edges.map((e) =>
        stripNulls({
          edgeId: e.edgeId,
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          edgeType: e.edgeType,
          isPrimary: e.isPrimary,
          order: e.order ?? undefined,
        }),
      );
      const res = (await client.mutation(
        mutationRef("storyboards:bulkCreateEdges"),
        { storyboardId: storyboardId as Id<"storyboards">, edges: scrubbedEdges },
      )) as { total?: number } | undefined;
      edgesWritten = res?.total ?? pythonResult.edges.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "bulkCreateEdges failed";
      return NextResponse.json(
        { error: `edge write failed: ${msg}`, storyboardId },
        { status: 500 },
      );
    }
  }

  console.log(
    `[ingest-idea] storyboard=${storyboardId} characters=${pythonResult.characters.length} portraits=${portraitsWritten}/${pythonResult.portraits.length} nodes=${nodesWritten} edges=${edgesWritten} llmCalls=${pythonResult.llmCallCount} ${pythonResult.pipelineDurationMs}ms`,
  );

  return NextResponse.json({
    storyboardId,
    characterCount: pythonResult.characters.length,
    identityPacksWritten: packIdByCharacter.size,
    identityPackFailures,
    portraitCount: portraitsWritten,
    nodeCount: nodesWritten,
    edgeCount: edgesWritten,
    llmCallCount: pythonResult.llmCallCount,
    pipelineDurationMs: pythonResult.pipelineDurationMs,
    preprocessed: pythonResult.preprocessed,
  });
}
