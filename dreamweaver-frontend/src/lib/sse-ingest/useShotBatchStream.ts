"use client";

import { useCallback, useRef, useState } from "react";
import { SseFrameParser } from "./parse";

export type ShotBatchPhase =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export interface ShotBatchRow {
  index: number;
  nodeId: string;
  phase: ShotBatchPhase;
  error?: string;
  reason?: string;
  sourceUrl?: string;
}

export interface ShotBatchDone {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

export interface ShotBatchState {
  kind: "idle" | "running" | "done" | "error";
  total: number;
  rows: ShotBatchRow[];
  counts: { succeeded: number; failed: number; skipped: number; started: number };
  done?: ShotBatchDone;
  error?: string;
  elapsedMs: number;
}

const INITIAL_STATE: ShotBatchState = {
  kind: "idle",
  total: 0,
  rows: [],
  counts: { succeeded: 0, failed: 0, skipped: 0, started: 0 },
  elapsedMs: 0,
};

/** Which media surface the batch should target. Image renders shot
 *  stills via LTX-2.3/Zennah (fast path); video renders per-shot I2V
 *  clips via LTX-2.3 with the shot's existing image as keyframe 0. */
export type ShotBatchMode = "image" | "video";

export interface StartShotBatchInput {
  storyboardId: string;
  skipExisting?: boolean;
  concurrency?: number;
  /** Defaults to "image" for backwards compatibility with callers that
   *  predate M4. Pass "video" to target the video batch route. */
  mode?: ShotBatchMode;
  /** Optional model override, only consumed in `mode: "video"`. */
  videoModelId?: string;
}

/** Client hook for /api/storyboard/generate-shots-stream. Tracks per-shot
 *  phase in `state.rows[index]` so the UI can render a mini-grid of
 *  queued / running / succeeded / failed / skipped tiles. */
export function useShotBatchStream() {
  const [state, setState] = useState<ShotBatchState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<number>(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tickElapsed = useCallback(() => {
    setState((prev) => ({ ...prev, elapsedMs: Date.now() - startedAtRef.current }));
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cancel();
    setState(INITIAL_STATE);
  }, [cancel]);

  const start = useCallback(
    async (input: StartShotBatchInput): Promise<ShotBatchDone | null> => {
      cancel();
      startedAtRef.current = Date.now();
      setState({ ...INITIAL_STATE, kind: "running", elapsedMs: 0 });
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = setInterval(tickElapsed, 1000);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const mode: ShotBatchMode = input.mode ?? "image";
        const endpoint =
          mode === "video"
            ? "/api/storyboard/generate-shot-videos-stream"
            : "/api/storyboard/generate-shots-stream";
        // Strip `mode` from the body — the endpoint itself encodes the
        // media kind, and the video route doesn't accept an arbitrary
        // `mode` field. Keep videoModelId when it's meaningful.
        const { mode: _dropMode, ...rest } = input;
        const body =
          mode === "video"
            ? rest
            : { ...rest, videoModelId: undefined };
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const text = await response.text().catch(() => "");
          const msg = text || `Stream request failed (${response.status})`;
          setState((prev) => ({ ...prev, kind: "error", error: msg }));
          return null;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SseFrameParser();
        let terminal: ShotBatchDone | null = null;

        const updateRow = (index: number, patch: Partial<ShotBatchRow>) => {
          setState((prev) => {
            const rows = [...prev.rows];
            const existing = rows[index];
            if (existing) {
              rows[index] = { ...existing, ...patch };
            } else {
              rows[index] = {
                index,
                nodeId: patch.nodeId ?? "",
                phase: patch.phase ?? "queued",
                ...patch,
              };
            }
            return { ...prev, rows };
          });
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const frames = parser.push(decoder.decode(value, { stream: true }));
          for (const frame of frames) {
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(frame.data) as Record<string, unknown>;
            } catch {
              continue;
            }
            switch (frame.event) {
              case "open": {
                const total = typeof parsed.total === "number" ? parsed.total : 0;
                setState((prev) => ({
                  ...prev,
                  total,
                  rows: Array.from({ length: total }, (_, i) => ({
                    index: i,
                    nodeId: "",
                    phase: "queued",
                  })),
                }));
                break;
              }
              case "shot_started": {
                const idx = parsed.index as number;
                updateRow(idx, {
                  nodeId: parsed.nodeId as string,
                  phase: "running",
                });
                setState((prev) => ({
                  ...prev,
                  counts: { ...prev.counts, started: prev.counts.started + 1 },
                }));
                break;
              }
              case "shot_succeeded": {
                const idx = parsed.index as number;
                updateRow(idx, {
                  nodeId: parsed.nodeId as string,
                  phase: "succeeded",
                  sourceUrl: parsed.sourceUrl as string,
                });
                setState((prev) => ({
                  ...prev,
                  counts: { ...prev.counts, succeeded: prev.counts.succeeded + 1 },
                }));
                break;
              }
              case "shot_failed": {
                const idx = parsed.index as number;
                updateRow(idx, {
                  nodeId: parsed.nodeId as string,
                  phase: "failed",
                  error: parsed.error as string,
                });
                setState((prev) => ({
                  ...prev,
                  counts: { ...prev.counts, failed: prev.counts.failed + 1 },
                }));
                break;
              }
              case "shot_skipped": {
                const idx = parsed.index as number;
                updateRow(idx, {
                  nodeId: parsed.nodeId as string,
                  phase: "skipped",
                  reason: parsed.reason as string,
                });
                setState((prev) => ({
                  ...prev,
                  counts: { ...prev.counts, skipped: prev.counts.skipped + 1 },
                }));
                break;
              }
              case "done": {
                terminal = parsed as unknown as ShotBatchDone;
                setState((prev) => ({
                  ...prev,
                  kind: "done",
                  done: terminal ?? undefined,
                }));
                break;
              }
              case "error": {
                setState((prev) => ({
                  ...prev,
                  kind: "error",
                  error: (parsed.message as string) ?? "Unknown error",
                }));
                break;
              }
            }
          }
        }

        return terminal;
      } catch (err) {
        if (controller.signal.aborted) {
          setState((prev) => ({ ...prev, kind: "error", error: "Cancelled" }));
          return null;
        }
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, kind: "error", error: msg }));
        return null;
      } finally {
        if (elapsedTimerRef.current) {
          clearInterval(elapsedTimerRef.current);
          elapsedTimerRef.current = null;
        }
        abortRef.current = null;
      }
    },
    [cancel, tickElapsed],
  );

  return { state, start, cancel, reset };
}
