/**
 * M5 #6 — real mp4 export of the reel.
 *
 * Flow:
 *   1. Resolve the reel manifest (same logic as the player's preview).
 *   2. Download each shot's video/image/audio to a per-request tmp dir.
 *   3. Run ffmpeg per shot to normalize into a uniform 1920x1080@30
 *      mp4 (silent video, video+narration, still-image+narration, or
 *      silent black — see `planShotDownloads`).
 *   4. Run ffmpeg concat demuxer to stitch every normalized clip.
 *   5. Upload the final mp4 to Convex `_storage`, return `{ url,
 *      storageId, durationS, shotCount }`.
 *   6. Clean up the tmp dir.
 *
 * Host requirement: `ffmpeg` must be on PATH. If it isn't, the route
 * returns HTTP 501 with an actionable message instead of crashing.
 * The launcher scripts document how to install it locally.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { getToken } from "@/lib/auth-server";
import { mutationRef, queryRef } from "@/lib/convexRefs";
import { createLogger, resolveRequestId } from "@/lib/observability";
import type { NodeType, ShotMeta } from "@/app/storyboard/types";
import {
  buildConcatArgs,
  buildConcatListFile,
  buildShotNormalizeArgs,
  planShotDownloads,
  type ShotPlan,
} from "./helpers";
import type { ReelManifest } from "@/app/api/storyboard/reel-manifest/route";
import { buildReelManifest } from "@/app/api/storyboard/reel-manifest/route";

export const runtime = "nodejs";
// ffmpeg-bound work can be long on a big reel. 15 min cap gives a
// 20-shot reel plenty of headroom for normalization + concat.
export const maxDuration = 900;

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

interface ExportReelBody {
  storyboardId?: string;
}

/** Return `true` iff `ffmpeg` is on PATH and runs `-version` cleanly. */
const ffmpegAvailable = (): Promise<boolean> =>
  new Promise((resolve) => {
    try {
      const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });

/** Spawn ffmpeg with the given args and resolve when it exits. Rejects
 *  on non-zero exit with the last 4KB of stderr attached. */
const runFfmpeg = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 4096) stderr = stderr.slice(-4096);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });

const fetchToFile = async (url: string, destPath: string): Promise<void> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`asset fetch ${res.status} for ${url.slice(0, 80)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
};

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = resolveRequestId(request.headers);
  const log = createLogger({ service: "export-reel", requestId });

  const token = await getToken();
  if (!token) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "X-Request-Id": requestId } },
    );
  }

  let body: ExportReelBody;
  try {
    body = (await request.json()) as ExportReelBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }
  const storyboardId = body.storyboardId?.trim();
  if (!storyboardId) {
    return NextResponse.json(
      { error: "storyboardId is required" },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  // --- Pre-flight: ffmpeg on PATH? ---------------------------------
  if (!(await ffmpegAvailable())) {
    log.error("ffmpeg_missing");
    return NextResponse.json(
      {
        error:
          "ffmpeg is not installed on this server. `brew install ffmpeg` (mac) / `apt install ffmpeg` (linux) and restart the Next dev server.",
      },
      { status: 501, headers: { "X-Request-Id": requestId } },
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

  const manifest: ReelManifest = buildReelManifest(
    storyboardId,
    snapshot.storyboard.title ?? "Untitled",
    snapshot.nodes.filter((n) => n.nodeType === "shot"),
  );
  if (manifest.shots.length === 0) {
    return NextResponse.json(
      { error: "Storyboard has no shots to export." },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const plans: ShotPlan[] = planShotDownloads(manifest.shots);
  const workDir = joinPath(tmpdir(), `reel-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  try {
    log.info("export_started", {
      storyboardId,
      shotCount: manifest.shots.length,
      totalDurationS: manifest.totalDurationS,
      workDir,
    });

    // --- 1. Download assets per shot -------------------------------
    const normalizedPaths: string[] = new Array(plans.length);
    for (const plan of plans) {
      const { shot, index } = plan;
      const videoPath = plan.willDownloadVideo
        ? joinPath(workDir, `shot_${index}.src.mp4`)
        : null;
      const imagePath = plan.willDownloadImage
        ? joinPath(workDir, `shot_${index}.src.png`)
        : null;
      const audioPath = plan.willDownloadAudio
        ? joinPath(workDir, `shot_${index}.src.mp3`)
        : null;

      if (videoPath && shot.videoUrl) {
        await fetchToFile(shot.videoUrl, videoPath);
      }
      if (imagePath && shot.imageUrl) {
        await fetchToFile(shot.imageUrl, imagePath);
      }
      if (audioPath && shot.audioUrl) {
        await fetchToFile(shot.audioUrl, audioPath);
      }

      // --- 2. Normalize into a uniform clip ----------------------
      const outputPath = joinPath(workDir, `shot_${index}.mp4`);
      const normEnd = log.startTimer("shot_normalize", {
        index,
        kind: plan.kind,
        durationS: shot.durationS,
      });
      const { args } = buildShotNormalizeArgs({
        videoPath,
        imagePath,
        audioPath,
        durationS: shot.durationS,
        outputPath,
      });
      await runFfmpeg(args);
      normEnd({});
      normalizedPaths[index] = outputPath;
    }

    // --- 3. Concat all normalized clips --------------------------
    const concatListPath = joinPath(workDir, "concat.txt");
    await writeFile(concatListPath, buildConcatListFile(normalizedPaths));
    const finalPath = joinPath(workDir, "reel.mp4");
    const concatEnd = log.startTimer("concat_demuxer", {
      shotCount: normalizedPaths.length,
    });
    await runFfmpeg(buildConcatArgs(concatListPath, finalPath));
    concatEnd({});

    // --- 4. Upload to Convex storage ------------------------------
    const uploadEnd = log.startTimer("upload_reel");
    const uploadUrl = (await client.mutation(
      mutationRef("storage:generateCameoUploadUrl"),
      {},
    )) as string;
    const { readFile } = await import("node:fs/promises");
    const reelBytes = await readFile(finalPath);
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "video/mp4" },
      body: reelBytes,
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => "");
      throw new Error(
        `storage upload ${uploadRes.status}: ${text.slice(0, 200)}`,
      );
    }
    const { storageId } = (await uploadRes.json()) as { storageId: string };
    const publicUrl = (await client.mutation(
      mutationRef("storage:getStorageUrl"),
      { storageId: storageId as never },
    )) as string;
    uploadEnd({ storageId, byteLength: reelBytes.byteLength });

    log.info("export_completed", {
      storyboardId,
      shotCount: manifest.shots.length,
      totalDurationS: manifest.totalDurationS,
      storageId,
      byteLength: reelBytes.byteLength,
    });

    return NextResponse.json(
      {
        url: publicUrl,
        storageId,
        shotCount: manifest.shots.length,
        totalDurationS: manifest.totalDurationS,
        byteLength: reelBytes.byteLength,
      },
      { status: 200, headers: { "X-Request-Id": requestId } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("export_failed", { error: msg });
    return NextResponse.json(
      { error: msg },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  } finally {
    // Always clean up the tmp dir — keeps disk use bounded across
    // repeated exports even when partial failures leave intermediates.
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
