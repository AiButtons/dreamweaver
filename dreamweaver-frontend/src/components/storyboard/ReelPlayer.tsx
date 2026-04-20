"use client";

/**
 * M5 #3 + #6 — reel preview + real mp4 export.
 *
 * Preview: Fetches a manifest of ordered shots + media URLs and plays
 * them back-to-back using a single <video> element (falling back to
 * <img> when a shot has no video). Audio tracks play in parallel on a
 * separate <audio> element, gated to the shot's declared duration so
 * narration doesn't bleed across cuts. Cheap, renders instantly, lets
 * producers iterate on pacing before committing to a real encode.
 *
 * Export: The "Export mp4" button POSTs to /api/storyboard/export-reel
 * which normalizes each shot through ffmpeg (uniform 1920x1080@30 with
 * audio overlay / still-frame loop / black-frame fallback) and concats
 * the result into a single mp4. Returns a Convex-storage URL the
 * producer can open or download.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { mutationRef } from "@/lib/convexRefs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Download, History, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { ReelManifest, ReelShot } from "@/app/api/storyboard/reel-manifest/route";
import { queryRef } from "@/lib/convexRefs";

interface ReelExportRow {
  _id: string;
  storageId: string;
  sourceUrl: string;
  shotCount: number;
  totalDurationS: number;
  byteLength: number;
  title: string;
  createdAt: number;
}

export interface ReelPlayerProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  storyboardId: string;
}

type PlayerStatus = "loading" | "ready" | "playing" | "paused" | "done" | "error";

export function ReelPlayer({ open, onOpenChange, storyboardId }: ReelPlayerProps) {
  const [manifest, setManifest] = useState<ReelManifest | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [autoAdvanceAt, setAutoAdvanceAt] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);
  // When the server export returns 501 (ffmpeg not installed), we offer
  // a client-side fallback via ffmpeg.wasm. Label reflects which path
  // is currently running so the producer knows the wasm download is
  // happening (and why the first export after a page load is slower).
  const [exportStageLabel, setExportStageLabel] = useState<string | null>(null);

  const generateUploadUrlMut = useMutation(
    mutationRef("storage:generateCameoUploadUrl"),
  );
  const getStorageUrlMut = useMutation(mutationRef("storage:getStorageUrl"));
  const recordReelExportMut = useMutation(
    mutationRef("reelExports:recordReelExport"),
  );
  // Past reel exports for this storyboard (newest first). Reactive — if
  // a second device / tab exports in parallel it shows up here too.
  const pastExports = useQuery(
    queryRef("reelExports:listReelExportsForStoryboard"),
    open && storyboardId
      ? { storyboardId: storyboardId as never, limit: 10 }
      : "skip",
  ) as ReelExportRow[] | undefined;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch the manifest when the dialog opens. Reset state on close.
  useEffect(() => {
    if (!open) {
      setManifest(null);
      setStatus("loading");
      setError(null);
      setCurrentIndex(0);
      setAutoAdvanceAt(null);
      setExporting(false);
      setExportError(null);
      setExportedUrl(null);
      setExportStageLabel(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setStatus("loading");
      setError(null);
      try {
        const res = await fetch(
          `/api/storyboard/reel-manifest?storyboardId=${encodeURIComponent(storyboardId)}`,
        );
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Failed to load reel (${res.status})`);
        }
        const data = (await res.json()) as ReelManifest;
        if (cancelled) return;
        setManifest(data);
        setStatus(data.shots.length > 0 ? "ready" : "error");
        if (data.shots.length === 0) {
          setError("This storyboard has no shots yet.");
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, storyboardId]);

  const shot: ReelShot | null = useMemo(
    () => manifest?.shots[currentIndex] ?? null,
    [manifest, currentIndex],
  );

  // Clear any pending auto-advance timer between shots.
  const clearAdvance = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setAutoAdvanceAt(null);
  }, []);

  const advanceNext = useCallback(() => {
    if (!manifest) return;
    clearAdvance();
    const next = currentIndex + 1;
    if (next >= manifest.shots.length) {
      setStatus("done");
      return;
    }
    setCurrentIndex(next);
  }, [clearAdvance, currentIndex, manifest]);

  const advancePrev = useCallback(() => {
    if (!manifest) return;
    clearAdvance();
    const prev = Math.max(0, currentIndex - 1);
    setCurrentIndex(prev);
  }, [clearAdvance, currentIndex, manifest]);

  // Drive playback per shot: when `currentIndex` or `status` changes to
  // "playing", start the video / audio and arm an auto-advance timer
  // capped at the shot's declared duration so an audio clip longer than
  // the shot doesn't block the cut, and a stuck video doesn't freeze
  // the player.
  useEffect(() => {
    if (!shot || status !== "playing") {
      return;
    }
    const video = videoRef.current;
    const audio = audioRef.current;

    if (video) {
      video.currentTime = 0;
      void video.play().catch(() => {
        // Browser may block autoplay; producer can click to advance manually.
      });
    }
    if (audio) {
      audio.currentTime = 0;
      void audio.play().catch(() => {
        /* ignore */
      });
    }

    const hardDeadlineMs = shot.durationS * 1000 + 400; // 400ms grace
    const startedAt = Date.now();
    setAutoAdvanceAt(startedAt + hardDeadlineMs);
    timerRef.current = setTimeout(() => {
      advanceNext();
    }, hardDeadlineMs);

    return () => {
      if (video) video.pause();
      if (audio) audio.pause();
      clearAdvance();
    };
  }, [advanceNext, clearAdvance, shot, status]);

  const handlePlayToggle = useCallback(() => {
    if (status === "done") {
      setCurrentIndex(0);
      setStatus("playing");
      return;
    }
    if (status === "playing") {
      setStatus("paused");
    } else {
      setStatus("playing");
    }
  }, [status]);

  // When the loaded video ends on its own (shorter than durationS), advance.
  const handleVideoEnded = useCallback(() => {
    if (status === "playing") {
      advanceNext();
    }
  }, [advanceNext, status]);

  const elapsedOffsetS = useMemo(() => {
    if (!manifest) return 0;
    return manifest.shots
      .slice(0, currentIndex)
      .reduce((sum, s) => sum + s.durationS, 0);
  }, [currentIndex, manifest]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {manifest ? `Reel — ${manifest.title}` : "Reel"}
          </DialogTitle>
          <DialogDescription>
            Sequential preview of every shot. Audio tracks (if any) play in
            parallel and each shot auto-advances at its declared duration.
          </DialogDescription>
        </DialogHeader>

        {status === "loading" ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            Building manifest…
          </div>
        ) : status === "error" ? (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-4 text-[12px] text-rose-200">
            {error ?? "Failed to build reel."}
          </div>
        ) : manifest && shot ? (
          <div className="flex flex-col gap-3">
            <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
              {shot.videoUrl ? (
                <video
                  ref={videoRef}
                  src={shot.videoUrl}
                  // Muted so the <audio> narration wins when both exist.
                  muted={Boolean(shot.audioUrl)}
                  playsInline
                  onEnded={handleVideoEnded}
                  className="h-full w-full object-contain"
                />
              ) : shot.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shot.imageUrl}
                  alt={shot.label}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
                  No media for this shot yet.
                </div>
              )}
              {shot.audioUrl ? (
                <audio ref={audioRef} src={shot.audioUrl} preload="auto" />
              ) : null}

              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/70 via-black/30 to-transparent p-3 text-[11px] text-white">
                <span>
                  {shot.number ? `#${shot.number}` : `Shot ${currentIndex + 1}`} · {shot.label}
                </span>
                <span className="tabular-nums">
                  {elapsedOffsetS.toFixed(1)}s / {manifest.totalDurationS.toFixed(1)}s
                </span>
              </div>
            </div>

            {/* Per-shot progress strip */}
            <div className="flex gap-0.5">
              {manifest.shots.map((s, i) => (
                <div
                  key={s.nodeId}
                  className={
                    i === currentIndex
                      ? "h-1 flex-1 rounded-full bg-primary"
                      : i < currentIndex
                        ? "h-1 flex-1 rounded-full bg-primary/50"
                        : "h-1 flex-1 rounded-full bg-muted"
                  }
                  title={`Shot ${i + 1}: ${s.label}`}
                />
              ))}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] text-muted-foreground">
                {currentIndex + 1} / {manifest.shots.length}
                {shot.videoUrl
                  ? " · video"
                  : shot.imageUrl
                    ? " · still image"
                    : " · empty"}
                {shot.audioUrl ? " · narration" : ""}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={advancePrev}
                  disabled={currentIndex === 0}
                  aria-label="Previous shot"
                >
                  <SkipBack className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handlePlayToggle}
                  className="gap-1.5"
                >
                  {status === "playing" ? (
                    <>
                      <Pause className="size-4" />
                      Pause
                    </>
                  ) : status === "done" ? (
                    <>
                      <Play className="size-4" />
                      Replay
                    </>
                  ) : (
                    <>
                      <Play className="size-4" />
                      Play
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={advanceNext}
                  disabled={currentIndex >= manifest.shots.length - 1}
                  aria-label="Next shot"
                >
                  <SkipForward className="size-4" />
                </Button>
              </div>
            </div>

            {autoAdvanceAt !== null && status === "playing" ? (
              <div className="text-[10px] tabular-nums text-muted-foreground">
                Auto-advancing at {shot.durationS.toFixed(1)}s
              </div>
            ) : null}

            {/* M5 #6 — server-side mp4 export */}
            <div className="mt-1 flex items-center justify-between gap-3 border-t border-border/60 pt-2">
              <div className="text-[11px] text-muted-foreground">
                {exportedUrl ? (
                  <span>
                    Exported — <a
                      href={exportedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      open mp4
                    </a>
                  </span>
                ) : exporting ? (
                  <span>{exportStageLabel ?? "Encoding reel…"}</span>
                ) : (
                  <span>
                    Export concatenates every shot into a single mp4.
                    Uses server ffmpeg when available, ffmpeg.wasm
                    otherwise.
                  </span>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={exporting || !manifest || manifest.shots.length === 0}
                onClick={async () => {
                  setExporting(true);
                  setExportError(null);
                  setExportedUrl(null);
                  setExportStageLabel("Trying server ffmpeg…");
                  try {
                    // 1. Try server-side route first (fast, no client CPU).
                    const res = await fetch("/api/storyboard/export-reel", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ storyboardId }),
                    });
                    if (res.ok) {
                      const data = (await res.json()) as { url: string };
                      setExportedUrl(data.url);
                      setExportStageLabel(null);
                      return;
                    }
                    // 2. 501 → fall back to client-side ffmpeg.wasm.
                    //    Any other status is a real error.
                    if (res.status !== 501) {
                      const errData = (await res.json().catch(() => ({}))) as {
                        error?: string;
                      };
                      throw new Error(
                        errData.error ?? `Export failed (${res.status})`,
                      );
                    }
                    if (!manifest) throw new Error("Manifest not loaded");
                    setExportStageLabel(
                      "Server has no ffmpeg — loading wasm (~30MB)…",
                    );
                    const { exportReelClientSide } = await import(
                      "@/lib/reel-export/client"
                    );
                    const result = await exportReelClientSide({
                      manifest,
                      onProgress: (p) => {
                        if (p.stage === "loading_wasm") {
                          setExportStageLabel("Loading ffmpeg.wasm…");
                        } else if (p.stage === "downloading") {
                          setExportStageLabel(
                            `Downloading shot ${(p.shotIndex ?? 0) + 1} / ${p.shotTotal ?? 0}`,
                          );
                        } else if (p.stage === "normalizing") {
                          setExportStageLabel(
                            `Encoding shot ${(p.shotIndex ?? 0) + 1} / ${p.shotTotal ?? 0}`,
                          );
                        } else if (p.stage === "concatenating") {
                          setExportStageLabel("Concatenating reel…");
                        }
                      },
                    });
                    // Upload the wasm-produced mp4 to Convex storage the
                    // same way the server route does.
                    setExportStageLabel("Uploading to Convex storage…");
                    const uploadUrl = (await generateUploadUrlMut(
                      {},
                    )) as string;
                    // Copy the wasm-returned Uint8Array into a fresh
                    // ArrayBuffer so `Blob`'s strict BufferSource type
                    // is happy even when the original buffer is
                    // SharedArrayBuffer-backed.
                    const reelBuffer = new ArrayBuffer(result.bytes.byteLength);
                    new Uint8Array(reelBuffer).set(result.bytes);
                    const uploadRes = await fetch(uploadUrl, {
                      method: "POST",
                      headers: { "Content-Type": "video/mp4" },
                      body: new Blob([reelBuffer], { type: "video/mp4" }),
                    });
                    if (!uploadRes.ok) {
                      const text = await uploadRes.text().catch(() => "");
                      throw new Error(
                        `storage upload ${uploadRes.status}: ${text.slice(0, 200)}`,
                      );
                    }
                    const { storageId } = (await uploadRes.json()) as {
                      storageId: string;
                    };
                    const publicUrl = (await getStorageUrlMut({
                      storageId: storageId as never,
                    })) as string;
                    // Record the client-side export in the same table the
                    // server writes to so past-exports shows it.
                    try {
                      await recordReelExportMut({
                        storyboardId: storyboardId as never,
                        storageId: storageId as never,
                        sourceUrl: publicUrl,
                        shotCount: result.shotCount,
                        totalDurationS: result.totalDurationS,
                        byteLength: result.byteLength,
                        title: manifest.title,
                      });
                    } catch (recordErr) {
                      // Upload succeeded — surfacing a row-write error
                      // would confuse the producer. Log quietly.
                      console.warn("recordReelExport failed", recordErr);
                    }
                    setExportedUrl(publicUrl);
                    setExportStageLabel(null);
                  } catch (err) {
                    setExportError(
                      err instanceof Error ? err.message : String(err),
                    );
                    setExportStageLabel(null);
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                {exporting ? (
                  <>
                    <span className="size-3 animate-spin rounded-full border-2 border-current/30 border-t-current" />
                    Encoding…
                  </>
                ) : (
                  <>
                    <Download className="size-4" />
                    Export mp4
                  </>
                )}
              </Button>
            </div>

            {exportError ? (
              <div className="flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-200">
                <AlertTriangle className="size-4 shrink-0" />
                <span>{exportError}</span>
              </div>
            ) : null}

            {pastExports && pastExports.length > 0 ? (
              <div className="rounded-md border border-border/40 bg-background/60 p-2">
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <History className="size-3" />
                  Past exports
                </div>
                <ul className="space-y-1 text-[11px]">
                  {pastExports.slice(0, 5).map((row) => (
                    <li
                      key={row._id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span
                        className="truncate text-muted-foreground"
                        title={`${row.shotCount} shots · ${row.totalDurationS.toFixed(1)}s · ${(row.byteLength / (1024 * 1024)).toFixed(1)} MB`}
                      >
                        {new Date(row.createdAt).toLocaleString()} ·{" "}
                        {row.shotCount} shots ·{" "}
                        {row.totalDurationS.toFixed(1)}s
                      </span>
                      <a
                        href={row.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 underline hover:text-foreground"
                      >
                        open
                      </a>
                    </li>
                  ))}
                  {pastExports.length > 5 ? (
                    <li className="text-[10px] text-muted-foreground">
                      +{pastExports.length - 5} older exports
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
