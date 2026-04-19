"use client";

import React, { useState } from "react";
import { Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GenerateAllShotsButtonProps {
  storyboardId: string;
  disabled?: boolean;
}

type BatchStatus =
  | { kind: "idle" }
  | { kind: "running"; startedAt: number }
  | {
      kind: "done";
      total: number;
      succeeded: number;
      failed: number;
      skipped: number;
      durationMs: number;
    }
  | { kind: "error"; message: string };

interface BatchResponse {
  storyboardId: string;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

/** Fires POST /api/storyboard/generate-shots and surfaces per-run stats. */
export function GenerateAllShotsButton({
  storyboardId,
  disabled,
}: GenerateAllShotsButtonProps) {
  const [status, setStatus] = useState<BatchStatus>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);

  React.useEffect(() => {
    if (status.kind !== "running") {
      setElapsed(0);
      return;
    }
    const started = status.startedAt;
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [status]);

  const run = async () => {
    if (!storyboardId) return;
    setStatus({ kind: "running", startedAt: Date.now() });
    try {
      const res = await fetch("/api/storyboard/generate-shots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyboardId, skipExisting: true, concurrency: 3 }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = `Batch failed (${res.status})`;
        try {
          const parsed = JSON.parse(text) as { error?: string };
          if (parsed.error) msg = parsed.error;
        } catch {
          if (text) msg = text.slice(0, 300);
        }
        setStatus({ kind: "error", message: msg });
        return;
      }
      const data = (await res.json()) as BatchResponse;
      setStatus({
        kind: "done",
        total: data.total,
        succeeded: data.succeeded,
        failed: data.failed,
        skipped: data.skipped,
        durationMs: data.durationMs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setStatus({ kind: "error", message: msg });
    }
  };

  const isBusy = status.kind === "running";
  const isDisabled = disabled || !storyboardId || isBusy;

  return (
    <div className="flex items-center gap-2">
      {status.kind === "done" ? (
        <div
          className={
            "rounded-md border px-2 py-1 text-[11px] " +
            (status.failed > 0
              ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200")
          }
          title={`${status.succeeded}/${status.total} generated, ${status.failed} failed, ${status.skipped} skipped — ${Math.round(status.durationMs / 100) / 10}s`}
        >
          {status.succeeded} / {status.total} shots
          {status.failed > 0 ? ` · ${status.failed} failed` : ""}
        </div>
      ) : null}
      {status.kind === "error" ? (
        <div
          className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200"
          title={status.message}
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
            ? `Generating… ${elapsed}s elapsed`
            : "Generate images for every shot using linked character portraits as references"
        }
      >
        {isBusy ? (
          <>
            <span className="size-3 animate-spin rounded-full border-2 border-current/30 border-t-current" />
            Generating… {elapsed}s
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
