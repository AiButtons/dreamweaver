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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Download, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { ReelManifest, ReelShot } from "@/app/api/storyboard/reel-manifest/route";

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
                  <span>Encoding reel… (ffmpeg can take 1-2s per shot)</span>
                ) : (
                  <span>
                    Export concatenates every shot into a single mp4 via
                    ffmpeg on the server.
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
                  try {
                    const res = await fetch(
                      "/api/storyboard/export-reel",
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ storyboardId }),
                      },
                    );
                    if (!res.ok) {
                      const errData = (await res.json().catch(() => ({}))) as {
                        error?: string;
                      };
                      throw new Error(
                        errData.error ?? `Export failed (${res.status})`,
                      );
                    }
                    const data = (await res.json()) as { url: string };
                    setExportedUrl(data.url);
                  } catch (err) {
                    setExportError(
                      err instanceof Error ? err.message : String(err),
                    );
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
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
