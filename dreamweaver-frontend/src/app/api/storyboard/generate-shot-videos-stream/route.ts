/**
 * M4 — per-shot video generation batch (LTX-2.3 image-to-video).
 *
 * Sibling to /api/storyboard/generate-shots-stream (which renders shot
 * images). This route walks the storyboard's shots and, for each shot
 * that already has an active image, issues an I2V video render via
 * /api/media/generate with `startImage` pinned to the shot's current
 * image URL.
 *
 * Event protocol (mirrors the image batch so the client hook can share
 * render logic; see `useShotBatchStream`):
 *   - `open`           — { total, concurrency }
 *   - `ping`           — { elapsedMs } every 15s
 *   - `shot_started`   — { nodeId, index, total }
 *   - `shot_succeeded` — { nodeId, index, sourceUrl, modelId }
 *   - `shot_failed`    — { nodeId, index, error }
 *   - `shot_skipped`   — { nodeId, index, reason }
 *   - `done`           — { total, succeeded, failed, skipped, durationMs }
 *   - `error`          — terminal
 *
 * Differences from the image batch (intentional):
 *   - Requires a shot to already have `media.activeImageId`. Skipped
 *     otherwise with reason "no keyframe image"; the producer is
 *     expected to run the image batch first.
 *   - Uses `promptPack.videoPrompt` preferentially (falls back to
 *     imagePrompt, then segment) — it comes from the ViMax storyboard
 *     artist's motion_desc and describes motion, not the static frame.
 *   - Concurrency default 2 (vs. 3 for images) — LTX-2.3 takes 60–180s
 *     per shot and the ~30min stale-mediaAsset sweeper could reap
 *     in-flight rows otherwise.
 *   - Per-shot timeout 5min (vs. 2min for images).
 *   - Route maxDuration 1800s (vs. 600s) — backend budgets 1800s for
 *     LTX-2.3 keyframe interpolation.
 */

import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { getToken } from "@/lib/auth-server";
import { mutationRef, queryRef } from "@/lib/convexRefs";
import { sseFrame } from "@/lib/ingest-postprocess";
import { createLogger, resolveRequestId } from "@/lib/observability";
import type { ShotMeta, NodeType } from "@/app/storyboard/types";

export const runtime = "nodejs";
// 30 minutes — gives 2-worker concurrency room to process a 20-shot
// batch at ~180s each without the Vercel/platform-level timeout firing.
export const maxDuration = 1800;

const DEFAULT_CONCURRENCY = 2;
const PER_SHOT_TIMEOUT_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_VIDEO_MODEL = "ltx-2.3";

interface GenerateShotVideosBody {
  storyboardId?: string;
  /** When true (default), shots that already have an `activeVideoId`
   *  are skipped. When false, every shot is re-rendered. */
  skipExisting?: boolean;
  concurrency?: number;
  /** Override the video model per-batch. Defaults to ltx-2.3. */
  videoModelId?: string;
}

interface MediaVariant {
  mediaAssetId: string;
  url: string;
  modelId: string;
  createdAt: number;
}

interface SnapshotNode {
  nodeId: string;
  nodeType: NodeType;
  label: string;
  segment: string;
  shotMeta?: ShotMeta;
  promptPack?: {
    imagePrompt?: string;
    videoPrompt?: string;
    negativePrompt?: string;
  };
  media?: {
    images?: MediaVariant[];
    videos?: MediaVariant[];
    activeImageId?: string;
    activeVideoId?: string;
  };
}

interface StoryboardSnapshot {
  storyboard: { _id: string; title?: string } | null;
  nodes: SnapshotNode[];
}

/** Resolve the shot's video prompt, preferring `videoPrompt` (from
 *  ViMax's motion_desc), falling back to imagePrompt, then segment.
 *  Returns null when no usable text exists — the shot is skipped.
 *  Exported for unit tests. */
export const deriveVideoPrompt = (
  node: Pick<SnapshotNode, "promptPack" | "segment">,
): string | null => {
  const vp = node.promptPack?.videoPrompt?.trim();
  if (vp) return vp;
  const ip = node.promptPack?.imagePrompt?.trim();
  if (ip) return ip;
  const seg = (node.segment ?? "").trim();
  return seg.length > 0 ? seg : null;
};

/** Find the active image URL on the shot's `media.images` array by
 *  matching against `media.activeImageId`. Returns null when no active
 *  image is linked — the shot is skipped with reason "no keyframe
 *  image". Exported for unit tests. */
export const resolveActiveImageUrl = (
  node: Pick<SnapshotNode, "media">,
): string | null => {
  const id = node.media?.activeImageId;
  if (!id) return null;
  const images = node.media?.images ?? [];
  const hit = images.find((v) => v.mediaAssetId === id);
  return hit?.url ?? null;
};

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = resolveRequestId(request.headers);
  const log = createLogger({
    service: "generate-shot-videos-stream",
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

  let body: GenerateShotVideosBody;
  try {
    body = (await request.json()) as GenerateShotVideosBody;
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
    4,
  );
  const videoModelId = (body.videoModelId ?? DEFAULT_VIDEO_MODEL).trim();

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
        const snapshot = (await client.query(
          queryRef("storyboards:getStoryboardSnapshot"),
          { storyboardId },
        )) as StoryboardSnapshot | null;
        if (!snapshot || !snapshot.storyboard) {
          send("error", { message: "Storyboard not found" });
          return;
        }

        const shots = snapshot.nodes.filter((n) => n.nodeType === "shot");
        const total = shots.length;
        send("open", { total, concurrency, requestId, videoModelId });
        log.info("shot_video_batch_started", {
          storyboardId,
          total,
          concurrency,
          skipExisting,
          videoModelId,
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

            if (skipExisting && shot.media?.activeVideoId) {
              counts.skipped += 1;
              send("shot_skipped", {
                nodeId,
                index,
                reason: "already has active video",
              });
              continue;
            }

            const startImage = resolveActiveImageUrl(shot);
            if (!startImage) {
              counts.skipped += 1;
              send("shot_skipped", {
                nodeId,
                index,
                reason: "no keyframe image — run Generate all shots first",
              });
              continue;
            }

            const prompt = deriveVideoPrompt(shot);
            if (!prompt) {
              counts.skipped += 1;
              send("shot_skipped", {
                nodeId,
                index,
                reason: "no video prompt available",
              });
              continue;
            }

            send("shot_started", { nodeId, index, total });

            let mediaAssetId: Id<"mediaAssets"> | null = null;
            try {
              mediaAssetId = (await client.mutation(
                mutationRef("mediaAssets:startMediaGeneration"),
                {
                  storyboardId: storyboardId as Id<"storyboards">,
                  nodeId,
                  kind: "video" as const,
                  modelId: videoModelId,
                  prompt,
                },
              )) as Id<"mediaAssets">;
            } catch (err) {
              counts.failed += 1;
              const msg =
                err instanceof Error ? err.message : "startMediaGeneration failed";
              send("shot_failed", { nodeId, index, error: msg });
              continue;
            }

            let generatedUrl: string | null = null;
            try {
              const abort = new AbortController();
              const timer = setTimeout(() => abort.abort(), PER_SHOT_TIMEOUT_MS);
              try {
                const res = await fetch(`${origin}/api/media/generate`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
                  },
                  body: JSON.stringify({
                    prompt,
                    type: "VIDEO",
                    config: {
                      videoModelId,
                      modelId: videoModelId,
                      aspectRatio: shot.shotMeta?.aspect ?? "9:16",
                      duration: shot.shotMeta?.durationS ?? 5,
                      startImage,
                      // Camera move hint lets LTX-2.3 bias motion in the
                      // intended direction instead of a default static
                      // push-in. Falls back to "static" when the shot
                      // doesn't declare a move.
                      cameraMovement: shot.shotMeta?.move ?? "static",
                      negativePrompt: shot.promptPack?.negativePrompt,
                      enhancePrompt: videoModelId === "ltx-2.3",
                    },
                  }),
                  signal: abort.signal,
                });
                if (!res.ok) {
                  const text = await res.text().catch(() => "");
                  throw new Error(
                    `media/generate ${res.status}: ${text.slice(0, 200)}`,
                  );
                }
                const data = (await res.json()) as { url?: string };
                generatedUrl = data.url ?? null;
                if (!generatedUrl)
                  throw new Error("media/generate returned no url");
              } finally {
                clearTimeout(timer);
              }
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : "video generation failed";
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
              modelId: videoModelId,
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
        log.info("shot_video_batch_completed", {
          storyboardId,
          ...counts,
          durationMs,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("shot_video_batch_failed", { error: msg });
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
