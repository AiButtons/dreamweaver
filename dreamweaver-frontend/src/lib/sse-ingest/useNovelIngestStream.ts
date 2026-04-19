"use client";

import { useCallback, useRef, useState } from "react";
import { SseFrameParser } from "./parse";

export interface NovelMeta {
  chunkCount: number;
  episodeCount: number;
  narrativeLength: number;
  characterCount: number;
  visibleCharacterCount: number;
}

export type EpisodePhase =
  | "queued"
  | "writing"
  | "written"
  | "failed";

export interface EpisodeRow {
  index: number;
  title: string;
  phase: EpisodePhase;
  nodeCount?: number;
  edgeCount?: number;
  nodesWritten?: number;
  edgesWritten?: number;
  error?: string;
}

// PortraitFailure shape is re-exported from `useIngestStream`; don't
// redeclare here to avoid barrel-export ambiguity.
import type { PortraitFailure } from "./useIngestStream";

export interface NovelDoneEvent {
  storyboardId: string;
  characterCount: number;
  identityPacksWritten?: number;
  portraitCount: number;
  portraitFailureCount?: number;
  portraitFailures?: PortraitFailure[];
  episodeCount: number;
  nodeCount: number;
  edgeCount: number;
  llmCallCount: number;
  pipelineDurationMs: number;
  totalDurationMs: number;
  novelLength: number;
  compressedNarrativeLength: number;
}

export interface NovelIngestState {
  kind: "idle" | "running" | "done" | "error";
  stage?: string;
  percent: number;
  message?: string;
  meta?: NovelMeta;
  portraits?: { done: number; total: number; phase: string };
  write?: { kind: "identities" | "portraits"; done: number; total: number };
  episodes: EpisodeRow[];
  /** Running tally of portraits_failed events seen mid-stream. */
  portraitFailures?: PortraitFailure[];
  done?: NovelDoneEvent;
  error?: string;
  elapsedMs: number;
}

const INITIAL_STATE: NovelIngestState = {
  kind: "idle",
  percent: 0,
  episodes: [],
  elapsedMs: 0,
};

export interface StartNovelInput {
  title?: string;
  novel: string;
  style?: string;
  userRequirement?: string;
  targetEpisodeCount?: number;
}

export function useNovelIngestStream() {
  const [state, setState] = useState<NovelIngestState>(INITIAL_STATE);
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
    async (input: StartNovelInput): Promise<NovelDoneEvent | null> => {
      cancel();
      startedAtRef.current = Date.now();
      setState({ ...INITIAL_STATE, kind: "running" });
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = setInterval(tickElapsed, 1000);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/storyboard/ingest-novel-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const text = await response.text().catch(() => "");
          setState((prev) => ({
            ...prev,
            kind: "error",
            error: text || `Stream failed (${response.status})`,
          }));
          return null;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SseFrameParser();
        let terminal: NovelDoneEvent | null = null;

        const upsertEpisode = (index: number, patch: Partial<EpisodeRow>) => {
          setState((prev) => {
            const episodes = [...prev.episodes];
            while (episodes.length <= index) {
              episodes.push({
                index: episodes.length,
                title: "",
                phase: "queued",
              });
            }
            episodes[index] = { ...episodes[index], ...patch };
            return { ...prev, episodes };
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
              case "open":
                break;
              case "stage": {
                setState((prev) => ({
                  ...prev,
                  stage: (parsed.stage as string | undefined) ?? prev.stage,
                  percent:
                    typeof parsed.percentComplete === "number"
                      ? Math.max(prev.percent, parsed.percentComplete)
                      : prev.percent,
                  message:
                    (parsed.statusMessage as string | undefined) ?? prev.message,
                }));
                break;
              }
              case "novel_meta": {
                setState((prev) => ({
                  ...prev,
                  meta: parsed as unknown as NovelMeta,
                  // Pre-populate the episode grid as queued rows.
                  episodes: Array.from(
                    { length: (parsed.episodeCount as number) ?? 0 },
                    (_, i) => ({ index: i, title: `Episode ${i + 1}`, phase: "queued" }),
                  ),
                }));
                break;
              }
              case "portraits_progress": {
                setState((prev) => ({
                  ...prev,
                  portraits: {
                    done: parsed.done as number,
                    total: parsed.total as number,
                    phase: (parsed.phase as string) ?? "front",
                  },
                }));
                break;
              }
              case "portraits_failed": {
                const characterId = parsed.characterId as string | undefined;
                const view = parsed.view as string | undefined;
                if (!characterId || !view) break;
                const entry: PortraitFailure = {
                  characterId,
                  view,
                  reason: (parsed.reason as string | undefined) ?? "unknown",
                };
                setState((prev) => ({
                  ...prev,
                  portraitFailures: [...(prev.portraitFailures ?? []), entry],
                }));
                break;
              }
              case "writing_identities":
              case "writing_portraits": {
                const kind = frame.event === "writing_identities" ? "identities" : "portraits";
                setState((prev) => ({
                  ...prev,
                  write: {
                    kind,
                    done: parsed.done as number,
                    total: parsed.total as number,
                  },
                }));
                break;
              }
              case "episode_writing": {
                upsertEpisode(parsed.episodeIndex as number, {
                  title: parsed.title as string,
                  phase: "writing",
                  nodeCount: parsed.nodeCount as number,
                  edgeCount: parsed.edgeCount as number,
                });
                break;
              }
              case "episode_written": {
                upsertEpisode(parsed.episodeIndex as number, {
                  title: parsed.title as string,
                  phase: "written",
                  nodesWritten: parsed.nodesWritten as number,
                  edgesWritten: parsed.edgesWritten as number,
                });
                break;
              }
              case "episode_failed": {
                upsertEpisode(parsed.episodeIndex as number, {
                  title: (parsed.title as string) ?? `Episode ${(parsed.episodeIndex as number) + 1}`,
                  phase: "failed",
                  error: parsed.error as string,
                });
                break;
              }
              case "done": {
                terminal = parsed as unknown as NovelDoneEvent;
                setState((prev) => ({
                  ...prev,
                  kind: "done",
                  percent: 100,
                  message: "Complete",
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
