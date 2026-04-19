"use client";

import React from "react";
import type { IngestStreamState } from "@/lib/sse-ingest";

interface IngestProgressPanelProps {
  state: IngestStreamState;
}

const STAGE_LABELS: Record<string, string> = {
  creating_storyboard: "Creating storyboard",
  developing_story: "Developing narrative",
  writing_script: "Writing screenplay",
  preprocessing: "Normalizing screenplay",
  extracting_characters: "Extracting characters",
  designing_storyboard: "Designing storyboard",
  decomposing_shots: "Decomposing shots",
  writing_to_convex: "Writing to Convex",
  generating_portraits: "Generating portraits",
  complete: "Complete",
};

/** Renders the live progress bar + stage breadcrumb + per-phase counter
 *  while an ingestion is running. Consumes the state returned by
 *  `useIngestStream`. Hidden in idle state. */
export function IngestProgressPanel({ state }: IngestProgressPanelProps) {
  if (state.kind === "idle") return null;

  const stageLabel = state.stage
    ? STAGE_LABELS[state.stage] ?? state.stage
    : state.kind === "running"
      ? "Starting…"
      : "";
  const percent = Math.max(0, Math.min(100, state.percent));
  const elapsedSec = Math.floor(state.elapsedMs / 1000);

  const detailLines: string[] = [];
  if (state.portraits) {
    const { done, total, phase } = state.portraits;
    const phaseLabel = phase === "side_back" ? "Side + back" : "Front";
    detailLines.push(`${phaseLabel} portraits: ${done}/${total}`);
  }
  if (state.write) {
    const { kind, done, total } = state.write;
    const kindLabel =
      kind === "identities"
        ? "Identity packs"
        : kind === "portraits"
          ? "Portrait references"
          : kind === "nodes"
            ? "Shot nodes"
            : "Edges";
    detailLines.push(`${kindLabel}: ${done}/${total}`);
  }

  return (
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
                : "h-full rounded-full bg-primary transition-all duration-300"
          }
          style={{ width: `${percent}%` }}
        />
      </div>
      {state.message ? (
        <div className="mt-2 text-[11px] text-muted-foreground">{state.message}</div>
      ) : null}
      {detailLines.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 text-[10px] text-muted-foreground">
          {detailLines.map((line) => (
            <li key={line}>· {line}</li>
          ))}
        </ul>
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
  );
}
