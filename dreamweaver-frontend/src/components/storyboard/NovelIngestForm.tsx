"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Sparkles, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useNovelIngestStream,
  type EpisodePhase,
} from "@/lib/sse-ingest";

interface NovelIngestFormProps {
  onIngested?: (storyboardId: string) => void;
  /** Pre-filled title when the chat supervisor routed the producer here. */
  initialTitle?: string;
  /** Pre-filled visual-style directive. */
  initialStyle?: string;
  /** Pre-filled constraints / user-requirement hint. */
  initialUserRequirement?: string;
  /** Pre-filled target episode count (1-10). */
  initialTargetEpisodeCount?: number;
}

const EPISODE_PHASE_CLASS: Record<EpisodePhase, string> = {
  queued: "border-border/40 bg-muted/40 text-muted-foreground",
  writing: "border-sky-500 bg-sky-500/20 text-sky-100 animate-pulse",
  written: "border-emerald-500 bg-emerald-500/20 text-emerald-100",
  failed: "border-rose-500 bg-rose-500/20 text-rose-100",
};

const STAGE_LABELS: Record<string, string> = {
  creating_storyboard: "Creating storyboard",
  novel_chunking: "Chunking novel",
  novel_compressing: "Compressing chunks",
  novel_aggregating: "Merging narrative",
  splitting_episodes: "Splitting into episodes",
  extracting_characters: "Extracting characters",
  building_portraits: "Preparing portrait prompts",
  episode_started: "Working on episode",
  episode_done: "Episode complete",
  novel_assembling: "Assembling results",
  generating_portraits: "Generating portraits",
  writing_to_convex: "Writing to Convex",
  complete: "Complete",
};

export function NovelIngestForm({
  onIngested,
  initialTitle,
  initialStyle,
  initialUserRequirement,
  initialTargetEpisodeCount,
}: NovelIngestFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle ?? "");
  const [novel, setNovel] = useState("");
  const [style, setStyle] = useState(initialStyle ?? "Cinematic, natural lighting");
  const [userRequirement, setUserRequirement] = useState(initialUserRequirement ?? "");
  const [targetCount, setTargetCount] = useState<number | "">(
    typeof initialTargetEpisodeCount === "number"
      ? Math.max(1, Math.min(10, Math.floor(initialTargetEpisodeCount)))
      : "",
  );
  const { state, start } = useNovelIngestStream();
  const [clientError, setClientError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setClientError(null);
    const trimmed = novel.trim();
    if (trimmed.length < 200) {
      setClientError("Novel text is too short (200+ chars required).");
      return;
    }
    if (trimmed.length > 500_000) {
      setClientError("Novel text is too long (500k char limit).");
      return;
    }
    const done = await start({
      title: title.trim() || undefined,
      novel: trimmed,
      style: style.trim() || undefined,
      userRequirement: userRequirement.trim() || undefined,
      targetEpisodeCount: typeof targetCount === "number" ? targetCount : undefined,
    });
    if (done) {
      onIngested?.(done.storyboardId);
      router.push(`/storyboard/${done.storyboardId}`);
    }
  };

  const isBusy = state.kind === "running";
  const stageLabel = state.stage
    ? STAGE_LABELS[state.stage] ?? state.stage
    : state.kind === "running"
      ? "Starting…"
      : "";
  const percent = Math.max(0, Math.min(100, state.percent));
  const elapsedSec = Math.floor(state.elapsedMs / 1000);

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-[12px] text-violet-100">
        <Sparkles className="size-3.5" />
        <span>
          Paste a chapter, novella, or full novel. We&apos;ll compress it,
          split it into episodes, and build one storyboard per episode with
          shared characters + 3-view portraits.
        </span>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Title (optional)
        </span>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. The Archive Chronicles"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          disabled={isBusy}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Novel text
        </span>
        <textarea
          value={novel}
          onChange={(event) => setNovel(event.target.value)}
          placeholder="Paste one or more chapters, a novella, or a full novel (up to 500,000 characters)…"
          rows={14}
          className="min-h-[260px] resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] leading-relaxed"
          disabled={isBusy}
          required
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Long novels are chunked + compressed — cost scales with length.</span>
          <span>{novel.length.toLocaleString()} / 500,000 chars</span>
        </div>
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 sm:col-span-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Episodes
          </span>
          <input
            type="number"
            min={1}
            max={10}
            value={targetCount}
            onChange={(event) => {
              const v = event.target.value;
              setTargetCount(v === "" ? "" : Math.max(1, Math.min(10, Number(v))));
            }}
            placeholder="auto"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            disabled={isBusy}
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Visual style
          </span>
          <input
            type="text"
            value={style}
            onChange={(event) => setStyle(event.target.value)}
            placeholder="Gritty realism, anamorphic"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            disabled={isBusy}
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Constraints (optional)
          </span>
          <input
            type="text"
            value={userRequirement}
            onChange={(event) => setUserRequirement(event.target.value)}
            placeholder="e.g. limit each episode to 10 shots"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            disabled={isBusy}
          />
        </label>
      </div>

      {clientError ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
          {clientError}
        </div>
      ) : null}

      {state.kind !== "idle" ? (
        <div className="rounded-xl border border-border/60 bg-card/40 p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>{stageLabel}</span>
            <span className="tabular-nums">
              {percent.toFixed(0)}% · {elapsedSec}s
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted/40">
            <div
              className={
                state.kind === "error"
                  ? "h-full rounded-full bg-rose-500 transition-all duration-300"
                  : state.kind === "done"
                    ? "h-full rounded-full bg-emerald-500 transition-all duration-300"
                    : "h-full rounded-full bg-violet-500 transition-all duration-300"
              }
              style={{ width: `${percent}%` }}
            />
          </div>
          {state.message ? (
            <div className="mt-2 text-[11px] text-muted-foreground">{state.message}</div>
          ) : null}
          {state.meta ? (
            <div className="mt-2 text-[10px] text-muted-foreground">
              {state.meta.chunkCount} chunks · {state.meta.characterCount} characters
              {state.meta.visibleCharacterCount
                ? ` (${state.meta.visibleCharacterCount} visible)`
                : ""}
              · {state.meta.narrativeLength.toLocaleString()}-char narrative
            </div>
          ) : null}
          {state.portraits ? (
            <div className="mt-1 text-[10px] text-muted-foreground">
              {state.portraits.phase === "side_back" ? "Side + back" : "Front"} portraits:{" "}
              {state.portraits.done} / {state.portraits.total}
            </div>
          ) : null}
          {state.write ? (
            <div className="mt-1 text-[10px] text-muted-foreground">
              {state.write.kind === "identities" ? "Identity packs" : "Portrait refs"}:{" "}
              {state.write.done} / {state.write.total}
            </div>
          ) : null}
          {state.episodes.length > 0 ? (
            <div className="mt-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Episodes
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {state.episodes.map((ep) => (
                  <div
                    key={ep.index}
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${EPISODE_PHASE_CLASS[ep.phase]}`}
                    title={
                      ep.error
                        ? `Failed: ${ep.error}`
                        : ep.phase === "written"
                          ? `${ep.nodesWritten ?? "?"} shots · ${ep.edgesWritten ?? "?"} edges`
                          : ep.phase
                    }
                  >
                    {ep.phase === "failed" ? (
                      <AlertTriangle className="size-3" />
                    ) : null}
                    <span className="font-medium">Ep {ep.index + 1}</span>
                    {ep.title ? <span className="opacity-70">· {ep.title}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {state.portraitFailures && state.portraitFailures.length > 0 ? (
            <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
              <div className="font-semibold">
                {state.portraitFailures.length} portrait{state.portraitFailures.length === 1 ? "" : "s"} failed to generate
              </div>
              <ul className="mt-1 space-y-0.5 text-[10px]">
                {state.portraitFailures.slice(0, 4).map((f) => (
                  <li key={`${f.characterId}:${f.view}`}>
                    · {f.characterId} / {f.view} — {f.reason}
                  </li>
                ))}
                {state.portraitFailures.length > 4 ? (
                  <li>· +{state.portraitFailures.length - 4} more</li>
                ) : null}
              </ul>
            </div>
          ) : null}
          {state.kind === "error" && state.error ? (
            <div className="mt-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">
              {state.error}
            </div>
          ) : null}
        </div>
      ) : null}

      {state.kind === "done" && state.done ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-200">
          Ingested — {state.done.episodeCount} episode
          {state.done.episodeCount === 1 ? "" : "s"}, {state.done.nodeCount} total shots
          across {state.done.characterCount} character
          {state.done.characterCount === 1 ? "" : "s"} in{" "}
          {Math.round(state.done.totalDurationMs / 100) / 10}s. Opening storyboard…
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {isBusy
            ? "Streaming live progress from the novel pipeline."
            : "Novel → Episodes → Storyboards. Typical run: 2–6 min depending on length."}
        </p>
        <Button type="submit" disabled={isBusy} className="gap-2">
          {isBusy ? (
            <>
              <span className="size-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              Ingesting…
            </>
          ) : (
            <>
              <BookOpen className="size-4" />
              Ingest novel
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
