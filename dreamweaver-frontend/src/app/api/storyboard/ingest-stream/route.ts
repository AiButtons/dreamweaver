/**
 * ViMax M3 #2 — unified SSE ingestion route (screenplay + idea).
 *
 * POST { mode: "screenplay" | "idea", storyboardId?, title?, style?,
 *        userRequirement?, screenplay?, idea? }
 *   → creates a fresh storyboard (or reuses one)
 *   → opens an SSE stream to Python's /script-ingest-stream or
 *     /idea-ingest-stream, forwarding each `stage` event to the client
 *   → interleaves its own events during portrait generation + Convex
 *     writes so the progress bar stays meaningful past the Python phase
 *   → emits a final `done` event with { storyboardId, counts, durationMs }
 *
 * Event protocol (all frames are `event: <type>\ndata: <json>\n\n`):
 *   - `open`              — heartbeat, signals the connection is live
 *   - `stage`             — { stage, percentComplete, statusMessage, ...extra }
 *   - `portraits_progress`— { done, total, phase: "front" | "side_back" }
 *   - `writing_identities`— { done, total }
 *   - `writing_portraits` — { done, total }
 *   - `writing_graph`     — { phase: "nodes" | "edges", done, total }
 *   - `done`              — { storyboardId, ...counts, durationMs }
 *   - `error`             — { message, type? } — terminal
 *
 * The client closes the stream on `done` or `error`.
 */

import { NextRequest } from "next/server";
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

type IngestMode = "screenplay" | "idea";
type PortraitView = "front" | "side" | "back" | "three_quarter" | "custom";

interface IngestStreamBody {
  mode?: IngestMode;
  title?: string;
  style?: string;
  userRequirement?: string;
  screenplay?: string;
  idea?: string;
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

// ---------- helpers (shared with blocking routes — candidate for extract) ----------

const stripNulls = <T>(value: T): T => {
  if (value === null) return undefined as unknown as T;
  if (Array.isArray(value)) return value.map((v) => stripNulls(v)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(value as Record<string, unknown>)) {
      const scrubbed = stripNulls(raw);
      if (scrubbed !== undefined) out[k] = scrubbed;
    }
    return out as T;
  }
  return value;
};

const cheapDnaFromCharacter = (c: PythonIngestedCharacter) =>
  JSON.stringify({
    sourceIdentifier: c.identifier,
    staticFeatures: c.staticFeatures,
    dynamicFeatures: c.dynamicFeatures,
    textSummary: [c.staticFeatures, c.dynamicFeatures].filter(Boolean).join(" ").slice(0, 500),
  });

const sseFrame = (eventType: string, data: unknown): string => {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
};

async function generatePortraitImage(
  origin: string,
  prompt: string,
  cookieHeader: string | null,
  referenceImageUrls?: string[],
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PORTRAIT_TIMEOUT_MS);
    try {
      const res = await fetch(`${origin}/api/media/generate`, {
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
            referenceImageUrls && referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { url?: string };
      return data.url && data.url.length > 0 ? data.url : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

// ---------- main handler ----------

export async function POST(request: NextRequest): Promise<Response> {
  const token = await getToken();
  if (!token) {
    return new Response(
      sseFrame("error", { message: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  let body: IngestStreamBody;
  try {
    body = (await request.json()) as IngestStreamBody;
  } catch {
    return new Response(sseFrame("error", { message: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const mode: IngestMode = body.mode === "idea" ? "idea" : "screenplay";
  const title = (body.title ?? "").trim() || (mode === "idea" ? "Untitled idea" : "Untitled screenplay");
  const style = (body.style ?? "").trim() || "Cinematic, natural lighting";
  const userRequirement = (body.userRequirement ?? "").trim();
  const payloadText =
    mode === "idea" ? (body.idea ?? "").trim() : (body.screenplay ?? "").trim();
  const minLen = mode === "idea" ? 5 : 20;
  const maxLen = mode === "idea" ? 4_000 : 60_000;

  if (payloadText.length < minLen || payloadText.length > maxLen) {
    return new Response(
      sseFrame("error", {
        message: `${mode} body must be ${minLen}-${maxLen} chars (got ${payloadText.length})`,
      }),
      { status: 400, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return new Response(
      sseFrame("error", { message: "NEXT_PUBLIC_CONVEX_URL not configured" }),
      { status: 500, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  const origin = request.nextUrl.origin;
  const cookieHeader = request.headers.get("cookie");

  const startedAt = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (eventType: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseFrame(eventType, data)));
      };

      try {
        send("open", { ok: true, mode });

        // 1. Create storyboard.
        send("stage", {
          stage: "creating_storyboard",
          percentComplete: 0.5,
          statusMessage: "Creating storyboard",
        });
        let storyboardId: string;
        try {
          storyboardId = (await client.mutation(mutationRef("storyboards:createStoryboard"), {
            title,
            mode: "agent_draft",
          })) as string;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "createStoryboard failed";
          send("error", { message: msg });
          controller.close();
          return;
        }

        // 2. Proxy Python SSE.
        const pythonEndpoint =
          mode === "idea" ? "/idea-ingest-stream" : "/script-ingest-stream";
        const pythonBody =
          mode === "idea"
            ? { storyboardId, idea: payloadText, style, userRequirement, mediaBaseUrl: origin }
            : { storyboardId, screenplay: payloadText, style, userRequirement, mediaBaseUrl: origin };

        let pythonResult: PythonIngestionResult | null = null;
        const pythonAbort = new AbortController();
        const pythonTimeout = setTimeout(() => pythonAbort.abort(), INGEST_TIMEOUT_MS);
        try {
          const res = await fetch(`${PYTHON_BASE_URL}${pythonEndpoint}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(pythonBody),
            signal: pythonAbort.signal,
          });
          if (!res.ok || !res.body) {
            const text = await res.text().catch(() => "");
            send("error", {
              message: `storyboard-agent returned ${res.status}: ${text.slice(0, 500)}`,
            });
            controller.close();
            return;
          }
          // Parse the SSE stream from Python.
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // SSE frames are separated by `\n\n`.
            let idx = buffer.indexOf("\n\n");
            while (idx !== -1) {
              const rawFrame = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              idx = buffer.indexOf("\n\n");
              let eventType = "message";
              const dataLines: string[] = [];
              for (const line of rawFrame.split("\n")) {
                if (line.startsWith("event:")) eventType = line.slice(6).trim();
                else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
              }
              if (dataLines.length === 0) continue;
              const payload = dataLines.join("\n");
              if (eventType === "stage") {
                // Rescale Python's 0-65% range into 5-50% of the overall
                // flow so downstream steps have room in the progress bar.
                try {
                  const parsed = JSON.parse(payload) as {
                    percentComplete?: number;
                    [k: string]: unknown;
                  };
                  const scaled = {
                    ...parsed,
                    percentComplete:
                      typeof parsed.percentComplete === "number"
                        ? 5 + (parsed.percentComplete / 65) * 45
                        : undefined,
                  };
                  send("stage", scaled);
                } catch {
                  send("stage", { statusMessage: payload });
                }
              } else if (eventType === "result") {
                try {
                  pythonResult = JSON.parse(payload) as PythonIngestionResult;
                } catch {
                  send("error", { message: "Failed to parse Python result frame" });
                  controller.close();
                  return;
                }
              } else if (eventType === "error") {
                send("error", JSON.parse(payload));
                controller.close();
                return;
              }
              // `open` and unknown event types are swallowed — Python's open
              // heartbeat is redundant since Next.js already sent one.
            }
          }
        } finally {
          clearTimeout(pythonTimeout);
        }

        if (!pythonResult) {
          send("error", { message: "Python pipeline exited without a result" });
          controller.close();
          return;
        }

        // 3. Portrait generation — two passes, as per M2.
        const portraitUrlResults: (string | null)[] = new Array(
          pythonResult.portraits.length,
        ).fill(null);
        const resolvedByCharView = new Map<string, string>();
        const keyFor = (c: string, v: PortraitView) => `${c}::${v}`;

        const pass1: number[] = [];
        const pass2: number[] = [];
        pythonResult.portraits.forEach((p, i) => {
          (p.conditionOnView ? pass2 : pass1).push(i);
        });
        const totalPortraits = pythonResult.portraits.length;

        send("stage", {
          stage: "generating_portraits",
          percentComplete: 52,
          statusMessage: `Generating ${totalPortraits} portrait${totalPortraits === 1 ? "" : "s"} (front-view first)`,
          totalPortraits,
        });

        let portraitsDone = 0;
        await Promise.all(
          pass1.map(async (i) => {
            const p = pythonResult!.portraits[i];
            const url = await generatePortraitImage(origin, p.prompt, cookieHeader);
            portraitUrlResults[i] = url;
            if (url) resolvedByCharView.set(keyFor(p.characterIdentifier, p.view), url);
            portraitsDone += 1;
            send("portraits_progress", {
              done: portraitsDone,
              total: totalPortraits,
              phase: "front",
            });
          }),
        );

        send("stage", {
          stage: "generating_portraits",
          percentComplete: 62,
          statusMessage: "Conditioning side + back views on front portraits",
        });
        await Promise.all(
          pass2.map(async (i) => {
            const p = pythonResult!.portraits[i];
            const refView = (p.conditionOnView ?? null) as PortraitView | null;
            const refUrl = refView
              ? resolvedByCharView.get(keyFor(p.characterIdentifier, refView))
              : undefined;
            const url = await generatePortraitImage(
              origin,
              p.prompt,
              cookieHeader,
              refUrl ? [refUrl] : undefined,
            );
            portraitUrlResults[i] = url;
            if (url) resolvedByCharView.set(keyFor(p.characterIdentifier, p.view), url);
            portraitsDone += 1;
            send("portraits_progress", {
              done: portraitsDone,
              total: totalPortraits,
              phase: "side_back",
            });
          }),
        );

        // 4. Identity packs.
        send("stage", {
          stage: "writing_to_convex",
          percentComplete: 74,
          statusMessage: `Writing ${pythonResult.characters.length} identity pack${pythonResult.characters.length === 1 ? "" : "s"}`,
        });
        const packIdByCharacter = new Map<string, string>();
        let identityWritten = 0;
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
            const hit = bundle?.identityPacks?.find((r) => r.packId === packAppId);
            if (hit) packIdByCharacter.set(c.identifier, hit._id);
            identityWritten += 1;
            send("writing_identities", {
              done: identityWritten,
              total: pythonResult.characters.length,
            });
          } catch (err) {
            console.warn("identity pack write failed", err);
          }
        }

        // 5. Portraits → Convex.
        let portraitRowsWritten = 0;
        const portraitsToWrite = portraitUrlResults.filter((u) => u != null).length;
        if (portraitsToWrite > 0) {
          send("stage", {
            stage: "writing_to_convex",
            percentComplete: 84,
            statusMessage: `Attaching ${portraitsToWrite} portrait reference${portraitsToWrite === 1 ? "" : "s"}`,
          });
        }
        for (let i = 0; i < pythonResult.portraits.length; i += 1) {
          const p = pythonResult.portraits[i];
          const url = portraitUrlResults[i];
          if (!url) continue;
          const ownerPackId = packIdByCharacter.get(p.characterIdentifier);
          if (!ownerPackId) continue;
          try {
            await client.mutation(mutationRef("identityReferences:addIdentityPortrait"), {
              storyboardId,
              ownerPackId,
              portraitView: p.view,
              sourceUrl: url,
              prompt: p.prompt,
              modelId: "llm-factory",
            });
            portraitRowsWritten += 1;
            send("writing_portraits", { done: portraitRowsWritten, total: portraitsToWrite });
          } catch (err) {
            console.warn("portrait write failed", err);
          }
        }

        // 6. Nodes + edges.
        send("stage", {
          stage: "writing_to_convex",
          percentComplete: 92,
          statusMessage: `Writing ${pythonResult.nodes.length} shot${pythonResult.nodes.length === 1 ? "" : "s"} + ${pythonResult.edges.length} edge${pythonResult.edges.length === 1 ? "" : "s"}`,
        });
        let nodesWritten = 0;
        let edgesWritten = 0;
        try {
          if (pythonResult.nodes.length > 0) {
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
            const res = (await client.mutation(mutationRef("storyboards:bulkCreateNodes"), {
              storyboardId: storyboardId as Id<"storyboards">,
              nodes: scrubbedNodes,
            })) as { total?: number } | undefined;
            nodesWritten = res?.total ?? pythonResult.nodes.length;
            send("writing_graph", {
              phase: "nodes",
              done: nodesWritten,
              total: pythonResult.nodes.length,
            });
          }
          if (pythonResult.edges.length > 0) {
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
            const res = (await client.mutation(mutationRef("storyboards:bulkCreateEdges"), {
              storyboardId: storyboardId as Id<"storyboards">,
              edges: scrubbedEdges,
            })) as { total?: number } | undefined;
            edgesWritten = res?.total ?? pythonResult.edges.length;
            send("writing_graph", {
              phase: "edges",
              done: edgesWritten,
              total: pythonResult.edges.length,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "graph write failed";
          send("error", { message: msg, storyboardId });
          controller.close();
          return;
        }

        // 7. Done.
        const durationMs = Date.now() - startedAt;
        send("stage", {
          stage: "complete",
          percentComplete: 100,
          statusMessage: "Opening storyboard",
        });
        send("done", {
          storyboardId,
          characterCount: pythonResult.characters.length,
          identityPacksWritten: packIdByCharacter.size,
          portraitCount: portraitRowsWritten,
          nodeCount: nodesWritten,
          edgeCount: edgesWritten,
          llmCallCount: pythonResult.llmCallCount,
          pipelineDurationMs: pythonResult.pipelineDurationMs,
          totalDurationMs: durationMs,
          preprocessed: pythonResult.preprocessed,
        });
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          controller.enqueue(
            encoder.encode(sseFrame("error", { message: msg })),
          );
        } catch {
          // already closed — nothing to do
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
