/**
 * M5 #3 — reel manifest: ordered list of shot media that the ReelPlayer
 * plays back-to-back. Serializes the storyboard's shot graph into a
 * linear edit decision list (EDL) using the existing
 * `storyboards:getStoryboardSnapshot` query — no new mutations, no
 * ffmpeg, no heavy client bundle.
 *
 * Order: shots are sorted by `shotMeta.number` parsed as "<episode>-<n>"
 * or "<n>" so a 5-episode novel ingest produces a sensible playthrough.
 * Shots without numbers fall through to their position in the snapshot
 * (which is insertion order).
 *
 * Response shape:
 *   {
 *     storyboardId, title,
 *     totalDurationS,   // sum of shot durations
 *     shots: [
 *       { nodeId, index, number?, label, durationS, videoUrl?,
 *         imageUrl?, audioUrl?, prompt? },
 *       ...
 *     ]
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { getToken } from "@/lib/auth-server";
import { queryRef } from "@/lib/convexRefs";
import { createLogger, resolveRequestId } from "@/lib/observability";
import type { NodeType, ShotMeta } from "@/app/storyboard/types";

export const runtime = "nodejs";
export const maxDuration = 30;

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
  promptPack?: { imagePrompt?: string };
  media?: {
    images?: MediaVariant[];
    videos?: MediaVariant[];
    audios?: MediaVariant[];
    activeImageId?: string;
    activeVideoId?: string;
    activeAudioId?: string;
  };
}

interface StoryboardSnapshot {
  storyboard: { _id: string; title?: string } | null;
  nodes: SnapshotNode[];
}

export interface ReelShot {
  nodeId: string;
  index: number;
  number: string | null;
  label: string;
  /** Seconds; clamped to [1, 30] even when shotMeta says something wild. */
  durationS: number;
  videoUrl: string | null;
  imageUrl: string | null;
  audioUrl: string | null;
  prompt: string | null;
}

export interface ReelManifest {
  storyboardId: string;
  title: string;
  totalDurationS: number;
  shots: ReelShot[];
}

/** Parse "Ep2-5" / "5" / "5.1" style shot numbers into a sortable tuple
 *  `[episodeOrdinal, shotOrdinal]`. Unknown shapes return [Infinity,
 *  Infinity] so they sort to the end without blocking playback. */
export const parseShotNumber = (
  raw: string | undefined,
): [number, number] => {
  if (!raw) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const ep = raw.match(/^Ep(\d+)-(\d+(?:\.\d+)?)$/i);
  if (ep) {
    return [Number.parseInt(ep[1], 10), Number.parseFloat(ep[2])];
  }
  const n = Number.parseFloat(raw);
  if (Number.isFinite(n)) {
    return [0, n];
  }
  return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
};

/** Resolve a specific mediaAsset-id to its URL from the node's
 *  media.{images|videos|audios} array. Returns null when the id is
 *  missing or doesn't match any variant. Exported for unit tests. */
export const resolveActiveMediaUrl = (
  variants: MediaVariant[] | undefined,
  activeId: string | undefined,
): string | null => {
  if (!activeId || !variants || variants.length === 0) return null;
  const hit = variants.find((v) => v.mediaAssetId === activeId);
  return hit?.url ?? null;
};

/** Build the manifest from a snapshot. Pure function — exported for
 *  tests. Expects shots pre-filtered (nodeType === "shot"). */
export const buildReelManifest = (
  storyboardId: string,
  title: string,
  shots: SnapshotNode[],
): ReelManifest => {
  const withOrder = shots
    .map((shot, originalIndex) => ({
      shot,
      originalIndex,
      sortKey: parseShotNumber(shot.shotMeta?.number),
    }))
    .sort((a, b) => {
      if (a.sortKey[0] !== b.sortKey[0]) return a.sortKey[0] - b.sortKey[0];
      if (a.sortKey[1] !== b.sortKey[1]) return a.sortKey[1] - b.sortKey[1];
      return a.originalIndex - b.originalIndex;
    });

  const reelShots: ReelShot[] = withOrder.map(({ shot }, index) => {
    const rawDuration = shot.shotMeta?.durationS;
    const durationS = Math.max(
      1,
      Math.min(
        30,
        typeof rawDuration === "number" && Number.isFinite(rawDuration)
          ? rawDuration
          : 5,
      ),
    );
    return {
      nodeId: shot.nodeId,
      index,
      number: shot.shotMeta?.number ?? null,
      label: shot.label,
      durationS,
      videoUrl: resolveActiveMediaUrl(
        shot.media?.videos,
        shot.media?.activeVideoId,
      ),
      imageUrl: resolveActiveMediaUrl(
        shot.media?.images,
        shot.media?.activeImageId,
      ),
      audioUrl: resolveActiveMediaUrl(
        shot.media?.audios,
        shot.media?.activeAudioId,
      ),
      prompt: shot.promptPack?.imagePrompt ?? shot.segment ?? null,
    };
  });
  const totalDurationS = reelShots.reduce((sum, s) => sum + s.durationS, 0);
  return { storyboardId, title, totalDurationS, shots: reelShots };
};

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = resolveRequestId(request.headers);
  const log = createLogger({ service: "reel-manifest", requestId });

  const token = await getToken();
  if (!token) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "X-Request-Id": requestId } },
    );
  }
  const storyboardId = request.nextUrl.searchParams.get("storyboardId");
  if (!storyboardId) {
    return NextResponse.json(
      { error: "storyboardId query param is required" },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_CONVEX_URL not configured" },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);

  const snapshot = (await client.query(
    queryRef("storyboards:getStoryboardSnapshot"),
    { storyboardId },
  )) as StoryboardSnapshot | null;
  if (!snapshot || !snapshot.storyboard) {
    return NextResponse.json(
      { error: "Storyboard not found" },
      { status: 404, headers: { "X-Request-Id": requestId } },
    );
  }

  const shots = snapshot.nodes.filter((n) => n.nodeType === "shot");
  const manifest = buildReelManifest(
    storyboardId,
    snapshot.storyboard.title ?? "Untitled",
    shots,
  );
  log.info("reel_manifest_built", {
    storyboardId,
    shotCount: manifest.shots.length,
    totalDurationS: manifest.totalDurationS,
    shotsWithVideo: manifest.shots.filter((s) => !!s.videoUrl).length,
    shotsWithImage: manifest.shots.filter((s) => !!s.imageUrl).length,
    shotsWithAudio: manifest.shots.filter((s) => !!s.audioUrl).length,
  });

  return NextResponse.json(manifest, {
    status: 200,
    headers: { "X-Request-Id": requestId },
  });
}
