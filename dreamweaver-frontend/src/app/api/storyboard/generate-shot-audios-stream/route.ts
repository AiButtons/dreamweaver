/**
 * M5 #2 — per-shot TTS batch.
 *
 * Mirrors the image + video batch routes. For each shot, derives a
 * narration text (first 2 sentences of `segment`, or
 * `promptPack.imagePrompt` as fallback), calls the single-shot
 * /api/media/generate-audio endpoint, and attaches the returned URL as
 * a completed `kind="audio"` mediaAsset.
 *
 * Event protocol mirrors the other batches so the useShotBatchStream
 * hook can subscribe with the same code path.
 */

import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { getToken } from "@/lib/auth-server";
import { mutationRef, queryRef } from "@/lib/convexRefs";
import { sseFrame } from "@/lib/ingest-postprocess";
import { createLogger, resolveRequestId } from "@/lib/observability";
import {
  decidePrimarySpeaker,
  extractDialogue,
  type SpeakerVoiceMap,
} from "@/lib/dialogue-extract";
import type { NodeType } from "@/app/storyboard/types";

export const runtime = "nodejs";
// OpenAI TTS is fast (2-10s per shot) but we still give generous headroom
// for a 30-shot batch with concurrency=3 — worst case ~5 minutes total.
export const maxDuration = 600;

const DEFAULT_CONCURRENCY = 3;
const PER_SHOT_TIMEOUT_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_VOICE = "nova";
const DEFAULT_MODEL = "tts-1";
const MAX_TTS_CHARS = 500; // Keep per-shot narration short — LLM prose is often verbose.

interface GenerateShotAudiosBody {
  storyboardId?: string;
  skipExisting?: boolean;
  concurrency?: number;
  voice?: string;
  model?: string;
  speed?: number;
}

interface SnapshotNode {
  nodeId: string;
  nodeType: NodeType;
  label: string;
  segment: string;
  promptPack?: {
    imagePrompt?: string;
    videoPrompt?: string;
    audioDesc?: string;
  };
  media?: {
    activeImageId?: string;
    activeVideoId?: string;
    activeAudioId?: string;
  };
}

interface StoryboardSnapshot {
  storyboard: { _id: string; title?: string } | null;
  nodes: SnapshotNode[];
}

/**
 * Derive the text the TTS provider will speak. Preference order:
 *   1. An explicit `audioDesc` on the promptPack (future — Python
 *      ingester may start emitting dialogue extractions here).
 *   2. The first ~2 sentences of `segment`, capped at MAX_TTS_CHARS.
 *      Keeps narration tight so a 5-minute storyboard doesn't balloon
 *      into a 30-minute audio track.
 *   3. The imagePrompt, as a last resort.
 * Returns null when nothing usable is available.
 *
 * Exported so the route's unit tests can assert the extraction logic.
 */
export const deriveShotNarrationText = (
  node: Pick<SnapshotNode, "promptPack" | "segment">,
): string | null => {
  const explicit = node.promptPack?.audioDesc?.trim();
  if (explicit) return explicit.slice(0, MAX_TTS_CHARS);
  const seg = (node.segment ?? "").trim();
  if (seg.length > 0) {
    // Grab the first 1-2 sentences. A greedy match on `.?!` is good
    // enough for English prose; for other languages the 500-char cap
    // still prevents runaway narrations.
    const sentences: string[] = [];
    const re = /[^.!?]+[.!?]+/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(seg)) !== null && sentences.length < 2) {
      sentences.push(match[0].trim());
    }
    const condensed =
      sentences.length > 0 ? sentences.join(" ") : seg;
    return condensed.slice(0, MAX_TTS_CHARS);
  }
  const ip = node.promptPack?.imagePrompt?.trim();
  if (ip) return ip.slice(0, MAX_TTS_CHARS);
  return null;
};

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = resolveRequestId(request.headers);
  const log = createLogger({
    service: "generate-shot-audios-stream",
    requestId,
  });

  const token = await getToken();
  if (!token) {
    log.warn("unauthorized", { reason: "no_session_token" });
    return new Response(sseFrame("error", { message: "Unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "text/event-stream",
        "X-Request-Id": requestId,
      },
    });
  }

  let body: GenerateShotAudiosBody;
  try {
    body = (await request.json()) as GenerateShotAudiosBody;
  } catch {
    return new Response(sseFrame("error", { message: "Invalid JSON body" }), {
      status: 400,
      headers: {
        "Content-Type": "text/event-stream",
        "X-Request-Id": requestId,
      },
    });
  }
  const storyboardId = body.storyboardId?.trim();
  if (!storyboardId) {
    return new Response(
      sseFrame("error", { message: "storyboardId is required" }),
      {
        status: 400,
        headers: {
          "Content-Type": "text/event-stream",
          "X-Request-Id": requestId,
        },
      },
    );
  }
  const skipExisting = body.skipExisting !== false;
  const concurrency = Math.min(
    Math.max(1, body.concurrency ?? DEFAULT_CONCURRENCY),
    5,
  );
  const voice = (body.voice ?? DEFAULT_VOICE).trim() || DEFAULT_VOICE;
  const model = (body.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const speed = typeof body.speed === "number" ? body.speed : 1.0;

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return new Response(
      sseFrame("error", { message: "NEXT_PUBLIC_CONVEX_URL not configured" }),
      {
        status: 500,
        headers: {
          "Content-Type": "text/event-stream",
          "X-Request-Id": requestId,
        },
      },
    );
  }
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  const origin = request.nextUrl.origin;
  const cookieHeader = request.headers.get("cookie");
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (eventType: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(eventType, data)));
        } catch {
          // already closed
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
      const heartbeat = setInterval(
        () => send("ping", { elapsedMs: Date.now() - startedAt }),
        HEARTBEAT_INTERVAL_MS,
      );

      try {
        // Fetch snapshot + identity packs in parallel — packs carry
        // per-character voice assignments the M6 speaker-aware routing
        // needs before entering the shot loop.
        const [snapshot, constraintBundle] = await Promise.all([
          client.query(queryRef("storyboards:getStoryboardSnapshot"), {
            storyboardId,
          }) as Promise<StoryboardSnapshot | null>,
          client.query(queryRef("continuityOS:listConstraintBundle"), {
            storyboardId,
          }) as Promise<
            | { identityPacks?: Array<Record<string, unknown>> }
            | null
          >,
        ]);
        if (!snapshot || !snapshot.storyboard) {
          send("error", { message: "Storyboard not found" });
          return;
        }

        // Build a SpeakerVoiceMap keyed on the UPPERCASE character
        // identifier the dialogue extractor emits. Packs can be indexed
        // by either their explicit sourceCharacterId (ViMax ingester)
        // or the pack name — cover both so manual + ingested packs
        // both resolve.
        const speakerVoices: SpeakerVoiceMap = {};
        const allowedVoices = new Set([
          "alloy",
          "echo",
          "fable",
          "onyx",
          "nova",
          "shimmer",
        ]);
        for (const pack of constraintBundle?.identityPacks ?? []) {
          const packVoice = typeof pack.voice === "string" ? pack.voice : "";
          if (!packVoice || !allowedVoices.has(packVoice)) continue;
          const sourceId =
            typeof pack.sourceCharacterId === "string"
              ? pack.sourceCharacterId
              : "";
          const name = typeof pack.name === "string" ? pack.name : "";
          for (const candidate of [sourceId, name]) {
            const key = candidate.trim().toUpperCase();
            if (key.length > 0) speakerVoices[key] = packVoice;
          }
        }

        const shots = snapshot.nodes.filter((n) => n.nodeType === "shot");
        const total = shots.length;
        send("open", {
          total,
          concurrency,
          requestId,
          voice,
          model,
          voiceAssignments: Object.keys(speakerVoices).length,
        });
        log.info("shot_audio_batch_started", {
          storyboardId,
          total,
          concurrency,
          voice,
          model,
        });

        const counts = { succeeded: 0, failed: 0, skipped: 0 };
        let cursor = 0;
        const worker = async () => {
          while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= shots.length) return;
            const shot = shots[index];
            const nodeId = shot.nodeId;

            if (skipExisting && shot.media?.activeAudioId) {
              counts.skipped += 1;
              send("shot_skipped", {
                nodeId,
                index,
                reason: "already has active audio",
              });
              continue;
            }

            // M6 speaker-aware routing: decide whether this shot has a
            // single dominant speaker with an assigned voice. When yes
            // AND the dialogue is "solo" (no competing narration prose),
            // feed only the dialogue text to TTS in the speaker's voice
            // — much cleaner than reading the whole segment.
            const segmentText = shot.segment ?? "";
            const decision = decidePrimarySpeaker(segmentText, speakerVoices);
            let effectiveVoice = voice;
            let text: string | null;
            if (decision.speaker && decision.voice && decision.isSoloDialogue) {
              effectiveVoice = decision.voice;
              const extracted = extractDialogue(segmentText);
              const dialogueOnly = extracted.lines
                .filter((l) => l.speaker === decision.speaker)
                .map((l) => l.text)
                .join(" ")
                .trim();
              text = dialogueOnly.length > 0
                ? dialogueOnly
                : deriveShotNarrationText(shot);
            } else if (decision.speaker && decision.voice) {
              // Single speaker but narration also present — use their
              // voice to read the full derived narration for cohesion.
              effectiveVoice = decision.voice;
              text = deriveShotNarrationText(shot);
            } else {
              // Narrator-only fallback.
              text = deriveShotNarrationText(shot);
            }
            if (!text) {
              counts.skipped += 1;
              send("shot_skipped", {
                nodeId,
                index,
                reason: "no narration text available",
              });
              continue;
            }

            send("shot_started", {
              nodeId,
              index,
              total,
              speaker: decision.speaker,
              voice: effectiveVoice,
            });

            let mediaAssetId: Id<"mediaAssets"> | null = null;
            try {
              mediaAssetId = (await client.mutation(
                mutationRef("mediaAssets:startMediaGeneration"),
                {
                  storyboardId: storyboardId as Id<"storyboards">,
                  nodeId,
                  kind: "audio" as const,
                  modelId: model,
                  prompt: text,
                },
              )) as Id<"mediaAssets">;
            } catch (err) {
              counts.failed += 1;
              const msg =
                err instanceof Error
                  ? err.message
                  : "startMediaGeneration failed";
              send("shot_failed", { nodeId, index, error: msg });
              continue;
            }

            let generatedUrl: string | null = null;
            try {
              const abort = new AbortController();
              const timer = setTimeout(() => abort.abort(), PER_SHOT_TIMEOUT_MS);
              try {
                const res = await fetch(`${origin}/api/media/generate-audio`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
                  },
                  body: JSON.stringify({
                    text,
                    voice: effectiveVoice,
                    model,
                    speed,
                  }),
                  signal: abort.signal,
                });
                if (!res.ok) {
                  const bodyText = await res.text().catch(() => "");
                  throw new Error(
                    `generate-audio ${res.status}: ${bodyText.slice(0, 200)}`,
                  );
                }
                const data = (await res.json()) as { url?: string };
                generatedUrl = data.url ?? null;
                if (!generatedUrl)
                  throw new Error("generate-audio returned no url");
              } finally {
                clearTimeout(timer);
              }
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : "audio generation failed";
              try {
                await client.mutation(
                  mutationRef("mediaAssets:failMediaGeneration"),
                  {
                    mediaAssetId,
                    errorMessage: msg.slice(0, 500),
                  },
                );
              } catch {
                // sweeper will clean up
              }
              counts.failed += 1;
              send("shot_failed", { nodeId, index, error: msg });
              continue;
            }

            try {
              await client.mutation(
                mutationRef("mediaAssets:completeMediaGeneration"),
                {
                  mediaAssetId,
                  sourceUrl: generatedUrl,
                },
              );
            } catch (err) {
              counts.failed += 1;
              const msg =
                err instanceof Error
                  ? err.message
                  : "completeMediaGeneration failed";
              send("shot_failed", { nodeId, index, error: msg });
              continue;
            }

            counts.succeeded += 1;
            send("shot_succeeded", {
              nodeId,
              index,
              sourceUrl: generatedUrl,
              modelId: model,
              speaker: decision.speaker,
              voice: effectiveVoice,
            });
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(concurrency, total) }, () => worker()),
        );

        const durationMs = Date.now() - startedAt;
        send("done", {
          total,
          succeeded: counts.succeeded,
          failed: counts.failed,
          skipped: counts.skipped,
          durationMs,
        });
        log.info("shot_audio_batch_completed", {
          storyboardId,
          ...counts,
          durationMs,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("shot_audio_batch_failed", { error: msg });
        send("error", { message: msg });
      } finally {
        clearInterval(heartbeat);
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
