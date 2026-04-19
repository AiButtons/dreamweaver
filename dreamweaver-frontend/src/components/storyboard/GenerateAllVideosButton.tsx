"use client";

/**
 * M4 — batch-generate an I2V video for every shot. Mirrors
 * `GenerateAllShotsButton`'s UI but drives `useShotBatchStream` in
 * `mode: "video"`. Shots that don't already have an active image are
 * skipped automatically by the server route with reason
 * "no keyframe image — run Generate all shots first", so the typical
 * workflow is: producer hits "Generate all shots" for stills, then
 * "Generate all videos" for motion.
 */

import React, { useEffect } from "react";
import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShotBatchStream, type ShotBatchPhase } from "@/lib/sse-ingest";
import {
  SHOT_VIDEO_BATCH_TRIGGER_EVENT,
  type ShotVideoBatchTriggerDetail,
} from "@/components/storyboard/StoryboardCopilotBridge";

interface GenerateAllVideosButtonProps {
  storyboardId: string;
  disabled?: boolean;
  /** Per-batch override for the video model. Defaults to ltx-2.3. */
  videoModelId?: string;
}

const PHASE_CLASS: Record<ShotBatchPhase, string> = {
  queued: "bg-muted/40 border-border/40",
  running: "bg-violet-500/40 border-violet-500 animate-pulse",
  succeeded: "bg-emerald-500/60 border-emerald-500",
  failed: "bg-rose-500/60 border-rose-500",
  skipped: "bg-slate-500/40 border-slate-500/60",
};

export function GenerateAllVideosButton({
  storyboardId,
  disabled,
  videoModelId,
}: GenerateAllVideosButtonProps) {
  const { state, start } = useShotBatchStream();

  const run = async () => {
    if (!storyboardId) return;
    await start({
      storyboardId,
      skipExisting: true,
      concurrency: 2,
      mode: "video",
      videoModelId,
    });
  };

  // Listen for agent-triggered runs. Same filtering as the image button:
  // storyboardId must match the currently loaded page, and we refuse to
  // re-trigger while a batch is in flight.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ShotVideoBatchTriggerDetail>).detail;
      if (!detail) return;
      if (detail.storyboardId && detail.storyboardId !== storyboardId) return;
      if (state.kind === "running") return;
      void start({
        storyboardId,
        skipExisting: detail.skipExisting ?? true,
        concurrency: Math.max(1, Math.min(4, detail.concurrency ?? 2)),
        mode: "video",
        videoModelId: detail.videoModelId ?? videoModelId,
      });
    };
    window.addEventListener(SHOT_VIDEO_BATCH_TRIGGER_EVENT, handler);
    return () =>
      window.removeEventListener(SHOT_VIDEO_BATCH_TRIGGER_EVENT, handler);
  }, [start, state.kind, storyboardId, videoModelId]);

  const isBusy = state.kind === "running";
  const isDisabled = disabled || !storyboardId || isBusy;

  const elapsedSec = Math.floor(state.elapsedMs / 1000);
  const doneCount =
    state.counts.succeeded + state.counts.failed + state.counts.skipped;

  return (
    <div className="flex items-center gap-2">
      {state.kind !== "idle" && state.total > 0 ? (
        <div
          className="rounded-md border border-border/60 bg-background/80 px-2 py-1 text-[11px]"
          title={
            state.kind === "done"
              ? `${state.counts.succeeded}/${state.total} rendered · ${state.counts.failed} failed · ${state.counts.skipped} skipped · ${Math.round((state.done?.durationMs ?? state.elapsedMs) / 100) / 10}s`
              : `${doneCount}/${state.total} shots · ${elapsedSec}s elapsed`
          }
        >
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5">
              {state.rows.slice(0, 20).map((row) => (
                <span
                  key={row.index}
                  className={`block size-2 rounded-sm border ${PHASE_CLASS[row.phase]}`}
                  title={`Shot ${row.index + 1}: ${row.phase}${row.error ? ` — ${row.error}` : ""}${row.reason ? ` — ${row.reason}` : ""}`}
                />
              ))}
              {state.rows.length > 20 ? (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  +{state.rows.length - 20}
                </span>
              ) : null}
            </div>
            <span className="tabular-nums text-muted-foreground">
              {state.kind === "done"
                ? `${state.counts.succeeded}/${state.total}`
                : `${doneCount}/${state.total}`}
            </span>
          </div>
        </div>
      ) : null}
      {state.kind === "error" ? (
        <div
          className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200"
          title={state.error}
        >
          Batch error
        </div>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isDisabled}
        onClick={() => void run()}
        className="h-7 gap-1.5 px-2 text-[11px]"
        aria-label="Generate videos for every shot"
        title={
          isBusy
            ? `Rendering videos… ${elapsedSec}s elapsed`
            : "Render an I2V video for every shot (uses each shot's existing image as keyframe 0)"
        }
      >
        {isBusy ? (
          <>
            <span className="size-3 animate-spin rounded-full border-2 border-current/30 border-t-current" />
            Rendering… {elapsedSec}s
          </>
        ) : (
          <>
            <Video className="h-3.5 w-3.5" aria-hidden="true" />
            Generate all videos
          </>
        )}
      </Button>
    </div>
  );
}
