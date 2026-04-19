"use client";

import { useCallback, useRef, useState } from "react";
import { SseFrameParser } from "./parse";

export type IngestMode = "screenplay" | "idea";

export interface StageEvent {
  stage?: string;
  percentComplete?: number;
  statusMessage?: string;
  characterCount?: number;
  shotCount?: number;
  totalPortraits?: number;
  [key: string]: unknown;
}

export interface PortraitProgressEvent {
  done: number;
  total: number;
  phase?: "front" | "side_back";
}

export interface WriteProgressEvent {
  done: number;
  total: number;
  phase?: "nodes" | "edges";
}

export interface DoneEvent {
  storyboardId: string;
  characterCount: number;
  identityPacksWritten?: number;
  portraitCount: number;
  nodeCount: number;
  edgeCount: number;
  llmCallCount: number;
  pipelineDurationMs: number;
  totalDurationMs: number;
  preprocessed: boolean;
}

export interface IngestStreamState {
  kind: "idle" | "running" | "done" | "error";
  stage?: string;
  percent: number;
  message?: string;
  portraits?: { done: number; total: number; phase: string };
  write?: { kind: "identities" | "portraits" | "nodes" | "edges"; done: number; total: number };
  done?: DoneEvent;
  error?: string;
  elapsedMs: number;
}

const INITIAL_STATE: IngestStreamState = {
  kind: "idle",
  percent: 0,
  elapsedMs: 0,
};

export interface StartIngestInput {
  mode: IngestMode;
  title?: string;
  style?: string;
  userRequirement?: string;
  screenplay?: string;
  idea?: string;
}

/**
 * Opens a POST to `/api/storyboard/ingest-stream` and consumes the SSE
 * response, updating `state` reactively. Returns a `start` callback that
 * fires the request, a `cancel` callback that aborts mid-stream, and the
 * current state snapshot.
 *
 * Events are dispatched off a `SseFrameParser` so the hook never sees
 * partial frames. Non-data lines (comments, heartbeats) are tolerated.
 */
export function useIngestStream() {
  const [state, setState] = useState<IngestStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<number>(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tickElapsed = useCallback(() => {
    setState((prev) => ({
      ...prev,
      elapsedMs: Date.now() - startedAtRef.current,
    }));
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const start = useCallback(
    async (input: StartIngestInput): Promise<DoneEvent | null> => {
      cancel();
      startedAtRef.current = Date.now();
      setState({ kind: "running", percent: 0, elapsedMs: 0, message: "Opening stream" });
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = setInterval(tickElapsed, 1000);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/storyboard/ingest-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
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
        let terminalDone: DoneEvent | null = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const frames = parser.push(decoder.decode(value, { stream: true }));
          for (const frame of frames) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(frame.data);
            } catch {
              continue;
            }
            switch (frame.event) {
              case "open":
                // No-op; the `running` state is already set.
                break;
              case "stage": {
                const s = parsed as StageEvent;
                setState((prev) => ({
                  ...prev,
                  stage: s.stage ?? prev.stage,
                  percent:
                    typeof s.percentComplete === "number"
                      ? Math.max(prev.percent, s.percentComplete)
                      : prev.percent,
                  message: s.statusMessage ?? prev.message,
                }));
                break;
              }
              case "portraits_progress": {
                const p = parsed as PortraitProgressEvent;
                setState((prev) => ({
                  ...prev,
                  portraits: { done: p.done, total: p.total, phase: p.phase ?? "front" },
                }));
                break;
              }
              case "writing_identities":
              case "writing_portraits":
              case "writing_graph": {
                const w = parsed as WriteProgressEvent;
                const kind =
                  frame.event === "writing_identities"
                    ? "identities"
                    : frame.event === "writing_portraits"
                      ? "portraits"
                      : w.phase === "edges"
                        ? "edges"
                        : "nodes";
                setState((prev) => ({
                  ...prev,
                  write: { kind, done: w.done, total: w.total },
                }));
                break;
              }
              case "done": {
                terminalDone = parsed as DoneEvent;
                setState((prev) => ({
                  ...prev,
                  kind: "done",
                  percent: 100,
                  message: "Complete",
                  done: terminalDone ?? undefined,
                }));
                break;
              }
              case "error": {
                const e = parsed as { message?: string };
                setState((prev) => ({
                  ...prev,
                  kind: "error",
                  error: e.message ?? "Unknown error",
                }));
                break;
              }
            }
          }
        }

        return terminalDone;
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

  const reset = useCallback(() => {
    cancel();
    setState(INITIAL_STATE);
  }, [cancel]);

  return { state, start, cancel, reset };
}
