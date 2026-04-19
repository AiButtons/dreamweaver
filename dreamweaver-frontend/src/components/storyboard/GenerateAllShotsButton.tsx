"use client";

import React, { useEffect } from "react";
import { Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShotBatchStream, type ShotBatchPhase } from "@/lib/sse-ingest";
import {
  SHOT_BATCH_TRIGGER_EVENT,
  type ShotBatchTriggerDetail,
} from "@/components/storyboard/StoryboardCopilotBridge";

interface GenerateAllShotsButtonProps {
  storyboardId: string;
  disabled?: boolean;
}

const PHASE_CLASS: Record<ShotBatchPhase, string> = {
  queued: "bg-muted/40 border-border/40",
  running: "bg-sky-500/40 border-sky-500 animate-pulse",
  succeeded: "bg-emerald-500/60 border-emerald-500",
  failed: "bg-rose-500/60 border-rose-500",
  skipped: "bg-slate-500/40 border-slate-500/60",
};

export function GenerateAllShotsButton({
  storyboardId,
  disabled,
}: GenerateAllShotsButtonProps) {
  const { state, start } = useShotBatchStream();

  const run = async () => {
    if (!storyboardId) return;
    await start({ storyboardId, skipExisting: true, concurrency: 3 });
  };

  // M3 #4 — listen for agent-triggered batches. The bridge dispatches a
  // SHOT_BATCH_TRIGGER_EVENT after the producer approves the
  // `request_generate_shot_batch` HITL card in chat. We only honor events
  // that target the currently loaded storyboard, and we refuse to start if
  // a batch is already running.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ShotBatchTriggerDetail>).detail;
      if (!detail) return;
      if (detail.storyboardId && detail.storyboardId !== storyboardId) return;
      if (state.kind === "running") return;
      void start({
        storyboardId,
        skipExisting: detail.skipExisting ?? true,
        concurrency: Math.max(1, Math.min(6, detail.concurrency ?? 3)),
      });
    };
    window.addEventListener(SHOT_BATCH_TRIGGER_EVENT, handler);
    return () => window.removeEventListener(SHOT_BATCH_TRIGGER_EVENT, handler);
  }, [start, state.kind, storyboardId]);

  const isBusy = state.kind === "running";
  const isDisabled = disabled || !storyboardId || isBusy;

  const elapsedSec = Math.floor(state.elapsedMs / 1000);
  const doneCount = state.counts.succeeded + state.counts.failed + state.counts.skipped;

  return (
    <div className="flex items-center gap-2">
      {state.kind !== "idle" && state.total > 0 ? (
        <div
          className="rounded-md border border-border/60 bg-background/80 px-2 py-1 text-[11px]"
          title={
            state.kind === "done"
              ? `${state.counts.succeeded}/${state.total} generated · ${state.counts.failed} failed · ${state.counts.skipped} skipped · ${Math.round((state.done?.durationMs ?? state.elapsedMs) / 100) / 10}s`
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
        aria-label="Generate images for every shot"
        title={
          isBusy
            ? `Generating… ${elapsedSec}s elapsed`
            : "Generate images for every shot using linked character portraits as references"
        }
      >
        {isBusy ? (
          <>
            <span className="size-3 animate-spin rounded-full border-2 border-current/30 border-t-current" />
            Generating… {elapsedSec}s
          </>
        ) : (
          <>
            <Clapperboard className="h-3.5 w-3.5" aria-hidden="true" />
            Generate all shots
          </>
        )}
      </Button>
    </div>
  );
}
