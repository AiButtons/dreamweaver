/**
 * Streaming variant of /api/storyboard/generate-shots.
 *
 * Emits per-shot SSE events as a bounded-concurrency pool of workers
 * processes the shot list — client sees each shot flip from queued →
 * running → succeeded / failed / skipped in real time.
 *
 * Event protocol:
 *   - `open`               — { total }
 *   - `ping`               — { elapsedMs } every 15s
 *   - `shot_started`       — { nodeId, index, total }
 *   - `shot_succeeded`     — { nodeId, index, sourceUrl, referenceUrls }
 *   - `shot_failed`        — { nodeId, index, error }
 *   - `shot_skipped`       — { nodeId, index, reason }
 *   - `done`               — { total, succeeded, failed, skipped, durationMs }
 *   - `error`              — terminal
 */

import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { getToken } from "@/lib/auth-server";
import { mutationRef, queryRef } from "@/lib/convexRefs";
import {
  collectShotReferenceUrls,
  type AvailablePortrait,
  type CharacterFacing,
  type PortraitView,
} from "@/lib/shot-batch";
import { sseFrame } from "@/lib/ingest-postprocess";
import type { ShotMeta, NodeType } from "@/app/storyboard/types";

export const runtime = "nodejs";
export const maxDuration = 600;

const DEFAULT_CONCURRENCY = 3;
const PER_SHOT_TIMEOUT_MS = 120_000;
const MAX_REFERENCE_URLS_PER_SHOT = 3;
const HEARTBEAT_INTERVAL_MS = 15_000;

interface GenerateShotsBody {
  storyboardId?: string;
  skipExisting?: boolean;
  concurrency?: number;
  /** M5 dailies review: when true, skip the normal skipExisting check
   *  AND restrict the batch to shots whose active image is flagged NG.
   *  Used by the Regenerate-flagged button. Shots with no NG flag are
   *  emitted as `shot_skipped` with reason "not flagged". */
  flaggedOnly?: boolean;
  /** Explicit allowlist — when set, process ONLY these nodeIds. Takes
   *  precedence over flaggedOnly. Useful for targeted re-renders driven
   *  from the agent or a future "re-render this shot" button. */
  nodeIds?: string[];
}

interface SnapshotNode {
  nodeId: string;
  nodeType: NodeType;
  label: string;
  segment: string;
  shotMeta?: ShotMeta;
  entityRefs?: {
    characterIds: string[];
    /** Parallel array of per-character facings emitted by the ViMax
     *  storyboard_artist during ingestion (loose end #4). */
    characterFacings?: Array<{ characterId: string; facing: CharacterFacing }>;
  };
  promptPack?: { imagePrompt?: string };
  media?: { activeImageId?: string };
}

interface StoryboardSnapshot {
  storyboard: { _id: string; title?: string } | null;
  nodes: SnapshotNode[];
}

interface PortraitGroupsResponse {
  groups: Record<
    string,
    Array<{ _id: string; portraitView?: string; sourceUrl: string; createdAt: number }>
  >;
  packCount: number;
}

const buildPortraitsByCharacter = (
  groups: PortraitGroupsResponse["groups"],
): Map<string, AvailablePortrait[]> => {
  const map = new Map<string, AvailablePortrait[]>();
  for (const [charKey, rows] of Object.entries(groups)) {
    const portraits: AvailablePortrait[] = [];
    for (const row of rows) {
      if (!row.sourceUrl) continue;
      const view = (row.portraitView ?? "custom") as PortraitView;
      portraits.push({ view, sourceUrl: row.sourceUrl });
    }
    if (portraits.length > 0) map.set(charKey, portraits);
  }
  return map;
};

/**
 * Build the final image-generation prompt for a shot.
 *
 * Core prompt: `promptPack.imagePrompt` (producer-overridable via the
 * Media tab) falls back to `segment` (the shot's visual_desc from the
 * LLM ingester).
 *
 * M5 scaffolding for multi-character composed shots: when
 * `shotMeta.blockingNotes` is set, append it as an explicit
 * "COMPOSITION:" suffix. Producers now have a dedicated lever for
 * staging 3+ characters without having to edit the full prompt.
 * Safe when the field is blank (no change to existing behavior).
 */
export const deriveShotPrompt = (node: SnapshotNode): string | null => {
  const core = node.promptPack?.imagePrompt?.trim() || node.segment?.trim();
  if (!core) return null;
  const blocking = node.shotMeta?.blockingNotes?.trim();
  if (!blocking) return core;
  return `${core}\n\nCOMPOSITION: ${blocking}`;
};

export async function POST(request: NextRequest): Promise<Response> {
  const token = await getToken();
  if (!token) {
    return new Response(sseFrame("error", { message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  let body: GenerateShotsBody;
  try {
    body = (await request.json()) as GenerateShotsBody;
  } catch {
    return new Response(sseFrame("error", { message: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  const storyboardId = body.storyboardId?.trim();
  if (!storyboardId) {
    return new Response(
      sseFrame("error", { message: "storyboardId is required" }),
      { status: 400, headers: { "Content-Type": "text/event-stream" } },
    );
  }
  const skipExisting = body.skipExisting !== false;
  const concurrency = Math.min(Math.max(1, body.concurrency ?? DEFAULT_CONCURRENCY), 6);
  const flaggedOnly = body.flaggedOnly === true;
  const explicitNodeIds =
    Array.isArray(body.nodeIds) && body.nodeIds.length > 0
      ? new Set(body.nodeIds.filter((id) => typeof id === "string"))
      : null;

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
        // Fetch snapshot + portraits in parallel.
        // In flaggedOnly mode we also pre-fetch the list of flagged
        // nodeIds so the worker can skip everything else without reading
        // each mediaAsset individually.
        const [snapshot, portraitResponse, flaggedResponse] = await Promise.all([
          client.query(queryRef("storyboards:getStoryboardSnapshot"), {
            storyboardId,
          }) as Promise<StoryboardSnapshot | null>,
          client.query(queryRef("identityReferences:listPortraitsForStoryboard"), {
            storyboardId,
          }) as Promise<PortraitGroupsResponse | null>,
          flaggedOnly
            ? (client.query(queryRef("mediaAssets:listShotsWithFlaggedMedia"), {
                storyboardId,
              }) as Promise<{ flaggedNodeIds?: string[] } | null>)
            : Promise.resolve(null),
        ]);
        if (!snapshot || !snapshot.storyboard) {
          send("error", { message: "Storyboard not found" });
          return;
        }
        const flaggedSet = flaggedOnly
          ? new Set(flaggedResponse?.flaggedNodeIds ?? [])
          : null;

        const shots = snapshot.nodes.filter((n) => n.nodeType === "shot");
        const portraitsByCharacter = buildPortraitsByCharacter(
          portraitResponse?.groups ?? {},
        );
        const total = shots.length;
        send("open", {
          total,
          concurrency,
          flaggedOnly,
          flaggedCount: flaggedSet?.size ?? null,
          explicitNodeIdCount: explicitNodeIds?.size ?? null,
        });

        const counts = { succeeded: 0, failed: 0, skipped: 0 };

        // Bounded-concurrency workers. Each pops the next shot from a
        // shared cursor and processes it fully before grabbing another.
        let cursor = 0;
        const worker = async () => {
          while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= shots.length) return;
            const shot = shots[index];
            const nodeId = shot.nodeId;

            // Allowlist filters take precedence. `explicitNodeIds`
            // (caller-supplied) beats `flaggedOnly` (derived from
            // Convex) — matches the expected "agent targeted this
            // specific shot" semantics.
            if (explicitNodeIds && !explicitNodeIds.has(nodeId)) {
              counts.skipped += 1;
              send("shot_skipped", {
                nodeId,
                index,
                reason: "not in requested nodeIds",
              });
              continue;
            }
            if (!explicitNodeIds && flaggedSet && !flaggedSet.has(nodeId)) {
              counts.skipped += 1;
              send("shot_skipped", {
                nodeId,
                index,
                reason: "not flagged",
              });
              continue;
            }

            // When we're targeting specific shots (flaggedOnly or
            // explicitNodeIds), the producer's intent is to re-render
            // regardless of whether a previous image exists. Skip the
            // skipExisting gate in those modes.
            const honorSkipExisting =
              skipExisting && !flaggedOnly && !explicitNodeIds;

            if (honorSkipExisting && shot.media?.activeImageId) {
              counts.skipped += 1;
              send("shot_skipped", {
                nodeId,
                index,
                reason: "already has active image",
              });
              continue;
            }
            const prompt = deriveShotPrompt(shot);
            if (!prompt) {
              counts.skipped += 1;
              send("shot_skipped", {
                nodeId,
                index,
                reason: "no prompt available",
              });
              continue;
            }

            send("shot_started", { nodeId, index, total });

            const characterIds = shot.entityRefs?.characterIds ?? [];
            // Build facing map from the parallel-array form stored on the
            // shot row (loose end #4). When absent, the selector falls back
            // to the shot-size + angle + screenDirection heuristics.
            let facingByCharacter: Map<string, CharacterFacing> | undefined;
            const facingEntries = shot.entityRefs?.characterFacings;
            if (facingEntries && facingEntries.length > 0) {
              facingByCharacter = new Map<string, CharacterFacing>();
              for (const entry of facingEntries) {
                facingByCharacter.set(entry.characterId, entry.facing);
              }
            }
            const referenceUrls = collectShotReferenceUrls(
              shot.shotMeta,
              characterIds,
              portraitsByCharacter,
              {
                maxRefs: MAX_REFERENCE_URLS_PER_SHOT,
                facingByCharacter,
              },
            );

            let mediaAssetId: Id<"mediaAssets"> | null = null;
            try {
              mediaAssetId = (await client.mutation(
                mutationRef("mediaAssets:startMediaGeneration"),
                {
                  storyboardId: storyboardId as Id<"storyboards">,
                  nodeId,
                  kind: "image" as const,
                  modelId: "zennah-image-gen",
                  prompt,
                },
              )) as Id<"mediaAssets">;
            } catch (err) {
              counts.failed += 1;
              const msg = err instanceof Error ? err.message : "startMediaGeneration failed";
              send("shot_failed", { nodeId, index, error: msg });
              continue;
            }

            let generatedUrl: string | null = null;
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), PER_SHOT_TIMEOUT_MS);
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
                    config: { aspect_ratio: shot.shotMeta?.aspect ?? "9:16" },
                    reference_image_urls:
                      referenceUrls.length > 0 ? referenceUrls : undefined,
                  }),
                  signal: controller.signal,
                });
                if (!res.ok) {
                  const text = await res.text().catch(() => "");
                  throw new Error(`media/generate ${res.status}: ${text.slice(0, 200)}`);
                }
                const data = (await res.json()) as { url?: string };
                generatedUrl = data.url ?? null;
                if (!generatedUrl) throw new Error("media/generate returned no url");
              } finally {
                clearTimeout(timer);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : "media generation failed";
              try {
                await client.mutation(mutationRef("mediaAssets:failMediaGeneration"), {
                  mediaAssetId,
                  errorMessage: msg.slice(0, 500),
                });
              } catch {
                // swallow — sweeper will clean up
              }
              counts.failed += 1;
              send("shot_failed", { nodeId, index, error: msg });
              continue;
            }

            try {
              await client.mutation(mutationRef("mediaAssets:completeMediaGeneration"), {
                mediaAssetId,
                sourceUrl: generatedUrl,
              });
            } catch (err) {
              counts.failed += 1;
              const msg = err instanceof Error ? err.message : "completeMediaGeneration failed";
              send("shot_failed", { nodeId, index, error: msg });
              continue;
            }

            counts.succeeded += 1;
            send("shot_succeeded", {
              nodeId,
              index,
              sourceUrl: generatedUrl,
              referenceUrls,
            });
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(concurrency, total) }, () => worker()),
        );

        send("done", {
          total,
          succeeded: counts.succeeded,
          failed: counts.failed,
          skipped: counts.skipped,
          durationMs: Date.now() - startedAt,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
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
    },
  });
}
