/**
 * ViMax M3 Phase 1 — blocking Idea2Video ingestion route.
 *
 * POST { title, idea, style, userRequirement? }
 *   → creates a storyboard
 *   → calls Python /idea-ingest (Screenwriter + M1 screenplay_ingester)
 *   → delegates the portrait + Convex write tail to
 *     `processIngestionResult` from src/lib/ingest-postprocess
 *
 * For live per-stage progress use /api/storyboard/ingest-stream with
 * `{ mode: "idea" }` instead.
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { getToken } from "@/lib/auth-server";
import { mutationRef } from "@/lib/convexRefs";
import {
  processIngestionResult,
  type PythonIngestionResult,
} from "@/lib/ingest-postprocess";

export const runtime = "nodejs";
export const maxDuration = 600;

const PYTHON_BASE_URL =
  process.env.STORYBOARD_AGENT_BASE_URL || "http://localhost:8123";
const INGEST_TIMEOUT_MS = 5 * 60 * 1000;

interface IngestIdeaRequestBody {
  title?: string;
  idea?: string;
  style?: string;
  userRequirement?: string;
}

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

  const outcome = await processIngestionResult({
    client,
    storyboardId,
    origin: request.nextUrl.origin,
    cookieHeader: request.headers.get("cookie"),
    pythonResult,
  });

  console.log(
    `[ingest-idea] storyboard=${storyboardId} characters=${outcome.characterCount} portraits=${outcome.portraitCount}/${pythonResult.portraits.length} nodes=${outcome.nodeCount} edges=${outcome.edgeCount} llmCalls=${pythonResult.llmCallCount} postprocess=${outcome.durationMs}ms`,
  );

  return NextResponse.json({
    storyboardId: outcome.storyboardId,
    characterCount: outcome.characterCount,
    identityPacksWritten: outcome.identityPacksWritten,
    identityPackFailures: outcome.identityPackFailures,
    portraitCount: outcome.portraitCount,
    nodeCount: outcome.nodeCount,
    edgeCount: outcome.edgeCount,
    llmCallCount: pythonResult.llmCallCount,
    pipelineDurationMs: pythonResult.pipelineDurationMs,
    preprocessed: pythonResult.preprocessed,
  });
}
