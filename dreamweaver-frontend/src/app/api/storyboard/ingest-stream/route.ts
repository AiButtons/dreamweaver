/**
 * ViMax M3 #2 — unified SSE ingestion route (screenplay + idea).
 *
 * POST { mode: "screenplay" | "idea", title?, style?, userRequirement?,
 *        screenplay?, idea? }
 *
 * Emits SSE events for each pipeline stage. The portrait + Convex write
 * tail delegates to `processIngestionResult` with a real emitter so its
 * own fine-grained events (portraits_progress, writing_*) propagate
 * through to the client with zero duplication of logic from the blocking
 * routes.
 *
 * Heartbeat: an `event: ping` is emitted every 15 s to keep intermediate
 * proxies from closing idle connections on long ingestions.
 *
 * Event protocol (all frames are `event: <type>\ndata: <json>\n\n`):
 *   - `open`              — connection live
 *   - `ping`              — heartbeat, carries { elapsedMs } — client ignores
 *   - `stage`             — { stage, percentComplete, statusMessage, ...extra }
 *   - `portraits_progress`— { done, total, phase: "front" | "side_back" }
 *   - `writing_identities`— { done, total }
 *   - `writing_portraits` — { done, total }
 *   - `writing_graph`     — { phase: "nodes" | "edges", done, total }
 *   - `done`              — { storyboardId, ...counts, durationMs }
 *   - `error`             — { message, type? } — terminal
 */

import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { getToken } from "@/lib/auth-server";
import { mutationRef } from "@/lib/convexRefs";
import {
  processIngestionResult,
  sseFrame,
  type PostProcessEmit,
  type PythonIngestionResult,
} from "@/lib/ingest-postprocess";
import { createLogger, resolveRequestId } from "@/lib/observability";

export const runtime = "nodejs";
// 15 minutes — idea mode chains two extra LLM passes (develop_story +
// write_script_based_on_story) before the M1 ingester runs, and GPT-5.4
// `develop_story` can easily spend 2-3 minutes on a one-liner before
// writing a 20k-char narrative. Screenplay mode finishes well inside this.
export const maxDuration = 900;

const PYTHON_BASE_URL =
  process.env.STORYBOARD_AGENT_BASE_URL || "http://localhost:8123";
// Matches maxDuration minus a small grace window so the abort fires before
// the platform kills the request, and the client sees a clean error instead
// of a half-flushed stream. Raised from 5min → 12min after a dogfooding run
// where the idea flow consistently hit the old ceiling during storyboard-
// design on a single-scene idea.
const INGEST_TIMEOUT_MS = 12 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 15_000;

type IngestMode = "screenplay" | "idea";

interface IngestStreamBody {
  mode?: IngestMode;
  title?: string;
  style?: string;
  userRequirement?: string;
  screenplay?: string;
  idea?: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  // Request correlation — every log line + SSE event + Python sub-call
  // carries the same id so operators can grep a full run across services.
  const requestId = resolveRequestId(request.headers);
  const log = createLogger({ service: "ingest-stream", requestId });

  const token = await getToken();
  if (!token) {
    log.warn("unauthorized", { reason: "no_session_token" });
    return new Response(
      sseFrame("error", { message: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "text/event-stream", "x-request-id": requestId } },
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
  const title =
    (body.title ?? "").trim() ||
    (mode === "idea" ? "Untitled idea" : "Untitled screenplay");
  const style = (body.style ?? "").trim() || "Cinematic, natural lighting";
  const userRequirement = (body.userRequirement ?? "").trim();
  const payloadText =
    mode === "idea"
      ? (body.idea ?? "").trim()
      : (body.screenplay ?? "").trim();
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
      let closed = false;
      const send = (eventType: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(eventType, data)));
        } catch {
          // controller may already be closed by the client disconnecting
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      // Heartbeat keepalive — prevents idle-connection timeouts at proxies.
      const heartbeat = setInterval(() => {
        send("ping", { elapsedMs: Date.now() - startedAt });
      }, HEARTBEAT_INTERVAL_MS);

      // P0 QA: if we create a storyboard row but the pipeline later aborts
      // (timeout, Python crash, network blip), we were leaving an orphan
      // "0 nodes, 0 images" card in the library. Track the id here so the
      // finally block can trash it on any non-success exit.
      let createdStoryboardId: string | null = null;
      let ingestSucceeded = false;

      try {
        // Echo the request id in the SSE handshake so the client (and
        // downstream log shipping) can correlate this stream.
        send("open", { ok: true, mode, requestId });
        log.info("ingest_started", {
          mode,
          titleLength: title.length,
          payloadLength: payloadText.length,
        });

        // 1. Create storyboard.
        send("stage", {
          stage: "creating_storyboard",
          percentComplete: 0.5,
          statusMessage: "Creating storyboard",
        });
        let storyboardId: string;
        try {
          storyboardId = (await client.mutation(
            mutationRef("storyboards:createStoryboard"),
            { title, mode: "agent_draft" },
          )) as string;
          createdStoryboardId = storyboardId;
          log.info("storyboard_created", { storyboardId });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "createStoryboard failed";
          log.error("create_storyboard_failed", { error: msg });
          send("error", { message: msg });
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
              // Thread the id into the storyboard-agent so its logs
              // correlate with this route's logs for an end-to-end trace.
              "X-Request-Id": requestId,
            },
            body: JSON.stringify(pythonBody),
            signal: pythonAbort.signal,
          });
          if (!res.ok || !res.body) {
            const text = await res.text().catch(() => "");
            send("error", {
              message: `storyboard-agent returned ${res.status}: ${text.slice(0, 500)}`,
            });
            return;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
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
                  return;
                }
              } else if (eventType === "error") {
                try {
                  send("error", JSON.parse(payload));
                } catch {
                  send("error", { message: payload });
                }
                return;
              }
              // `open`, `ping`, unknown event types are swallowed.
            }
          }
        } finally {
          clearTimeout(pythonTimeout);
        }

        if (!pythonResult) {
          send("error", { message: "Python pipeline exited without a result" });
          return;
        }

        // 3. Delegate the portrait + Convex tail to the shared helper.
        const emit: PostProcessEmit = (eventType, payload) => {
          send(eventType, payload);
        };
        const outcome = await processIngestionResult({
          client,
          storyboardId,
          origin,
          cookieHeader,
          pythonResult,
          emit,
        });

        // 4. Done.
        const totalDurationMs = Date.now() - startedAt;
        send("stage", {
          stage: "complete",
          percentComplete: 100,
          statusMessage: "Opening storyboard",
        });
        send("done", {
          storyboardId: outcome.storyboardId,
          characterCount: outcome.characterCount,
          identityPacksWritten: outcome.identityPacksWritten,
          portraitCount: outcome.portraitCount,
          portraitFailureCount: outcome.portraitFailures.length,
          portraitFailures: outcome.portraitFailures,
          nodeCount: outcome.nodeCount,
          edgeCount: outcome.edgeCount,
          llmCallCount: pythonResult.llmCallCount,
          pipelineDurationMs: pythonResult.pipelineDurationMs,
          totalDurationMs,
          preprocessed: pythonResult.preprocessed,
        });
        // Only mark success once the done event has been sent — any earlier
        // `return;` path (e.g. Python returned non-200) leaves
        // `ingestSucceeded = false` so the finally block trashes the
        // orphan. We also only treat a run as successful if at least one
        // node landed; a storyboard with 0 nodes is still useless to the
        // producer.
        ingestSucceeded = outcome.nodeCount > 0;
        log.info("ingest_completed", {
          storyboardId,
          nodeCount: outcome.nodeCount,
          edgeCount: outcome.edgeCount,
          characterCount: outcome.characterCount,
          portraitCount: outcome.portraitCount,
          portraitFailureCount: outcome.portraitFailures.length,
          totalDurationMs,
          pipelineDurationMs: pythonResult.pipelineDurationMs,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("ingest_failed", {
          error: msg,
          createdStoryboardId: createdStoryboardId ?? undefined,
        });
        send("error", { message: msg });
      } finally {
        clearInterval(heartbeat);
        // Orphan cleanup: if we never reached a successful done, trash the
        // storyboard row we created so the library page doesn't fill up
        // with empty "0 nodes" cards. Best-effort — if the trash mutation
        // itself errors we swallow it; the user can always trash manually.
        if (!ingestSucceeded && createdStoryboardId) {
          try {
            await client.mutation(mutationRef("storyboards:trashStoryboard"), {
              storyboardId: createdStoryboardId as Id<"storyboards">,
            });
            log.warn("orphan_storyboard_trashed", {
              storyboardId: createdStoryboardId,
            });
          } catch (trashErr) {
            log.warn("orphan_trash_failed", {
              storyboardId: createdStoryboardId,
              error: trashErr instanceof Error ? trashErr.message : String(trashErr),
            });
          }
        }
        close();
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
      "X-Request-Id": requestId,
    },
  });
}
