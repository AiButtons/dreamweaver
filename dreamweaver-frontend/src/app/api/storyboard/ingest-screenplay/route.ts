/**
 * ViMax M1 — screenplay ingestion route.
 *
 * POST { title, screenplay, style, userRequirement? }
 *   → creates a fresh storyboard
 *   → calls the Python storyboard-agent `/script-ingest` (:8123 by default)
 *   → generates front-view portraits via our in-process `/api/media/generate`
 *   → writes identityPacks + portrait refs + nodes + edges into Convex
 *   → returns `{ storyboardId }` to the client
 *
 * All Convex writes are issued through the user's Better Auth session token
 * via `ConvexHttpClient.setAuth`. The Python service is called with the same
 * token as a Bearer value — it only validates the header format; its own
 * LLM calls are authed by its server-side `OPENAI_API_KEY`.
 *
 * Long timeout: Python ingestion is blocking and can take 30–90 s for a
 * typical 1-page scene; we cap fetch timeouts at 5 minutes.
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { getToken } from "@/lib/auth-server";
import { mutationRef, queryRef } from "@/lib/convexRefs";

export const runtime = "nodejs";
// Next.js default request-handler timeout is 300 s — the Python service can
// take up to ~3 min on a 20-shot script plus portrait generation.
export const maxDuration = 600;

const PYTHON_BASE_URL =
  process.env.STORYBOARD_AGENT_BASE_URL || "http://localhost:8123";
const INGEST_TIMEOUT_MS = 5 * 60 * 1000;
const PORTRAIT_TIMEOUT_MS = 90 * 1000;

interface IngestRequestBody {
  title?: string;
  screenplay?: string;
  style?: string;
  userRequirement?: string;
}

interface PythonIngestedCharacter {
  identifier: string;
  staticFeatures: string;
  dynamicFeatures: string;
  isVisible: boolean;
  identityPackName: string;
}

interface PythonIngestedPortrait {
  characterIdentifier: string;
  view: "front" | "side" | "back" | "three_quarter" | "custom";
  sourceUrl: string; // empty from Python — we fill it
  prompt: string;
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

const cheapDnaFromCharacter = (c: PythonIngestedCharacter) => {
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
  // 1. Auth.
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse body.
  let body: IngestRequestBody;
  try {
    body = (await request.json()) as IngestRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const title = (body.title ?? "").trim() || "Untitled screenplay";
  const screenplay = (body.screenplay ?? "").trim();
  const style = (body.style ?? "").trim() || "Cinematic, natural lighting";
  const userRequirement = (body.userRequirement ?? "").trim();
  if (screenplay.length < 20) {
    return NextResponse.json(
      { error: "screenplay must be at least 20 characters" },
      { status: 400 },
    );
  }
  if (screenplay.length > 60_000) {
    return NextResponse.json(
      { error: "screenplay must be under 60,000 characters" },
      { status: 400 },
    );
  }

  // 3. Authed Convex client.
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_CONVEX_URL not configured" },
      { status: 500 },
    );
  }
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);

  // 4. Create a fresh storyboard.
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

  // 5. Invoke Python ingestion pipeline.
  let pythonResult: PythonIngestionResult;
  try {
    const res = await fetchWithTimeout(
      `${PYTHON_BASE_URL}/script-ingest`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          storyboardId,
          screenplay,
          style,
          userRequirement,
          // Retained for M2; unused in Phase 3.
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
    const msg = err instanceof Error ? err.message : "script-ingest failed";
    return NextResponse.json(
      { error: `storyboard-agent unreachable: ${msg}`, storyboardId },
      { status: 502 },
    );
  }

  // 6. Generate portraits in parallel via in-process /api/media/generate.
  // Uses the user's session cookie since that route has no explicit auth
  // gate but lives in the same Next.js process behind the same middleware.
  const cookieHeader = request.headers.get("cookie");
  const origin = request.nextUrl.origin;
  const portraitUrlResults = await Promise.all(
    pythonResult.portraits.map((p) =>
      generatePortraitImage(origin, p.prompt, cookieHeader),
    ),
  );

  // 7. Write identity packs. Track identifier → pack _id for the portrait
  // FK writes below.
  const packIdByCharacter = new Map<string, string>();
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
      // upsertIdentityPack doesn't return the row _id, so refetch the
      // bundle and resolve by the app-level packId we just wrote.
      const bundle = (await client.query(
        queryRef("continuityOS:listConstraintBundle"),
        { storyboardId },
      )) as {
        identityPacks?: Array<{ _id: string; packId: string }>;
      } | null;
      const hit = bundle?.identityPacks?.find((row) => row.packId === packAppId);
      if (hit) packIdByCharacter.set(c.identifier, hit._id);
    } catch (err) {
      console.warn(`identity pack upsert failed for ${c.identifier}`, err);
    }
  }

  // 8. Write portrait references for resolved URLs.
  let portraitsWritten = 0;
  for (let i = 0; i < pythonResult.portraits.length; i += 1) {
    const p = pythonResult.portraits[i];
    const sourceUrl = portraitUrlResults[i];
    if (!sourceUrl) continue;
    const ownerPackId = packIdByCharacter.get(p.characterIdentifier);
    if (!ownerPackId) continue;
    try {
      await client.mutation(
        mutationRef("identityReferences:addIdentityPortrait"),
        {
          storyboardId,
          ownerPackId,
          portraitView: p.view,
          sourceUrl,
          prompt: p.prompt,
          modelId: "llm-factory",
        },
      );
      portraitsWritten += 1;
    } catch (err) {
      console.warn(`portrait write failed for ${p.characterIdentifier}`, err);
    }
  }

  // 9. Bulk-insert nodes + edges.
  let nodesWritten = 0;
  let edgesWritten = 0;
  if (pythonResult.nodes.length > 0) {
    try {
      const res = (await client.mutation(
        mutationRef("storyboards:bulkCreateNodes"),
        {
          storyboardId,
          nodes: pythonResult.nodes.map((n) => ({
            nodeId: n.nodeId,
            nodeType: n.nodeType,
            label: n.label,
            segment: n.segment,
            position: n.position,
            shotMeta: n.shotMeta ?? undefined,
            promptPack: n.promptPack ?? undefined,
          })),
        },
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
      const res = (await client.mutation(
        mutationRef("storyboards:bulkCreateEdges"),
        {
          storyboardId,
          edges: pythonResult.edges.map((e) => ({
            edgeId: e.edgeId,
            sourceNodeId: e.sourceNodeId,
            targetNodeId: e.targetNodeId,
            edgeType: e.edgeType,
            isPrimary: e.isPrimary,
            order: e.order ?? undefined,
          })),
        },
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

  return NextResponse.json({
    storyboardId,
    characterCount: pythonResult.characters.length,
    portraitCount: portraitsWritten,
    nodeCount: nodesWritten,
    edgeCount: edgesWritten,
    llmCallCount: pythonResult.llmCallCount,
    pipelineDurationMs: pythonResult.pipelineDurationMs,
    preprocessed: pythonResult.preprocessed,
  });
}
