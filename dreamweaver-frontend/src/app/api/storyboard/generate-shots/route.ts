/**
 * ViMax M2 Phase 3 — bulk "Generate all shots" route.
 *
 * POST { storyboardId, skipExisting?: boolean, concurrency?: number }
 *   → fetches snapshot + resolves every shot's `entityRefs.characterIds` to
 *     active portrait URLs
 *   → fires `/api/media/generate` per shot with `reference_image_urls`
 *     populated from the best portrait view for that shot
 *   → writes `mediaAssets` (pending → completed) + patches the node's media
 *     via the existing `startMediaGeneration` + `completeMediaGeneration`
 *     pair
 *   → returns `{ total, succeeded, failed, skipped, shotResults }`
 *
 * Bounded concurrency keeps the backend ordered. For a 10-shot batch at
 * concurrency 3, expect ~30–60s wall-clock depending on the image model.
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { getToken } from "@/lib/auth-server";
import { mutationRef, queryRef } from "@/lib/convexRefs";
import {
  collectShotReferenceUrls,
  type AvailablePortrait,
  type PortraitView,
} from "@/lib/shot-batch";
import type { ShotMeta, NodeType } from "@/app/storyboard/types";

export const runtime = "nodejs";
export const maxDuration = 600;

const DEFAULT_CONCURRENCY = 3;
const PER_SHOT_TIMEOUT_MS = 120_000;
const MAX_REFERENCE_URLS_PER_SHOT = 3;

interface GenerateShotsBody {
  storyboardId?: string;
  skipExisting?: boolean;
  concurrency?: number;
}

interface SnapshotNode {
  nodeId: string;
  nodeType: NodeType;
  label: string;
  segment: string;
  shotMeta?: ShotMeta;
  entityRefs?: {
    characterIds: string[];
  };
  promptPack?: {
    imagePrompt?: string;
  };
  media?: {
    activeImageId?: string;
  };
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

type ShotStatus =
  | { kind: "skipped"; nodeId: string; reason: string }
  | { kind: "succeeded"; nodeId: string; sourceUrl: string; referenceUrls: string[] }
  | { kind: "failed"; nodeId: string; error: string };

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

/** Bounded-concurrency map. Resolves with an array of T in input order. */
async function boundedAll<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Promote the first "portrait" row in each group (first-created-wins, since
 *  active fronts are inserted first) into an AvailablePortrait[] keyed by
 *  characterId for the selector to consume. */
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

const deriveShotPrompt = (node: SnapshotNode): string | null => {
  const pack = node.promptPack?.imagePrompt?.trim();
  if (pack) return pack;
  const seg = (node.segment ?? "").trim();
  return seg.length > 0 ? seg : null;
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: GenerateShotsBody;
  try {
    body = (await request.json()) as GenerateShotsBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const storyboardId = body.storyboardId?.trim();
  if (!storyboardId) {
    return NextResponse.json({ error: "storyboardId is required" }, { status: 400 });
  }
  const skipExisting = body.skipExisting !== false; // default true
  const concurrency = Math.min(
    Math.max(1, body.concurrency ?? DEFAULT_CONCURRENCY),
    6,
  );

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_CONVEX_URL not configured" },
      { status: 500 },
    );
  }
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);

  // Fetch snapshot + portraits in parallel.
  let snapshot: StoryboardSnapshot | null;
  let portraitResponse: PortraitGroupsResponse | null = null;
  try {
    const [snap, portraits] = await Promise.all([
      client.query(queryRef("storyboards:getStoryboardSnapshot"), {
        storyboardId,
      }) as Promise<StoryboardSnapshot | null>,
      client.query(queryRef("identityReferences:listPortraitsForStoryboard"), {
        storyboardId,
      }) as Promise<PortraitGroupsResponse | null>,
    ]);
    snapshot = snap;
    portraitResponse = portraits;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  if (!snapshot || !snapshot.storyboard) {
    return NextResponse.json({ error: "Storyboard not found" }, { status: 404 });
  }

  const shots = snapshot.nodes.filter((n) => n.nodeType === "shot");
  const portraitsByCharacter = buildPortraitsByCharacter(
    portraitResponse?.groups ?? {},
  );

  const origin = request.nextUrl.origin;
  const cookieHeader = request.headers.get("cookie");

  const startedAt = Date.now();
  const shotResults: ShotStatus[] = await boundedAll(
    shots,
    concurrency,
    async (shot) => {
      const nodeId = shot.nodeId;
      // Skip shots that already have an active image.
      if (skipExisting && shot.media?.activeImageId) {
        return { kind: "skipped", nodeId, reason: "already has active image" } as ShotStatus;
      }
      const prompt = deriveShotPrompt(shot);
      if (!prompt) {
        return { kind: "skipped", nodeId, reason: "no prompt available" } as ShotStatus;
      }

      const characterIds = shot.entityRefs?.characterIds ?? [];
      const referenceUrls = collectShotReferenceUrls(
        shot.shotMeta,
        characterIds,
        portraitsByCharacter,
        MAX_REFERENCE_URLS_PER_SHOT,
      );

      // 1) Register a pending mediaAssets row so the UI reflects the gen in
      //    progress + the failure-sweeper can clean it up if we crash.
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
        const msg = err instanceof Error ? err.message : "startMediaGeneration failed";
        return { kind: "failed", nodeId, error: msg } as ShotStatus;
      }

      // 2) Call the in-process media generator with our reference images.
      let generatedUrl: string | null = null;
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
              config: { aspect_ratio: shot.shotMeta?.aspect ?? "9:16" },
              reference_image_urls: referenceUrls.length > 0 ? referenceUrls : undefined,
            }),
          },
          PER_SHOT_TIMEOUT_MS,
        );
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`media/generate ${res.status}: ${text.slice(0, 200)}`);
        }
        const data = (await res.json()) as { url?: string };
        generatedUrl = data.url ?? null;
        if (!generatedUrl) throw new Error("media/generate returned no url");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "media generation failed";
        try {
          await client.mutation(mutationRef("mediaAssets:failMediaGeneration"), {
            mediaAssetId,
            errorMessage: msg.slice(0, 500),
          });
        } catch {
          // Swallow — the row will be swept as stale after 30 min.
        }
        return { kind: "failed", nodeId, error: msg } as ShotStatus;
      }

      // 3) Flip pending → completed + patch the node's media.
      try {
        await client.mutation(mutationRef("mediaAssets:completeMediaGeneration"), {
          mediaAssetId,
          sourceUrl: generatedUrl,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "completeMediaGeneration failed";
        return { kind: "failed", nodeId, error: msg } as ShotStatus;
      }

      return {
        kind: "succeeded",
        nodeId,
        sourceUrl: generatedUrl,
        referenceUrls,
      } as ShotStatus;
    },
  );

  const total = shots.length;
  const succeeded = shotResults.filter((r) => r.kind === "succeeded").length;
  const failed = shotResults.filter((r) => r.kind === "failed").length;
  const skipped = shotResults.filter((r) => r.kind === "skipped").length;
  const durationMs = Date.now() - startedAt;

  console.log(
    `[generate-shots] storyboard=${storyboardId} total=${total} ok=${succeeded} fail=${failed} skip=${skipped} ${durationMs}ms concurrency=${concurrency}`,
  );

  return NextResponse.json({
    storyboardId,
    total,
    succeeded,
    failed,
    skipped,
    durationMs,
    shotResults,
  });
}
