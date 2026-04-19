"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIngestStream } from "@/lib/sse-ingest";
import { IngestProgressPanel } from "./IngestProgressPanel";

interface IdeaIngestFormProps {
  onIngested?: (storyboardId: string) => void;
}

const EXAMPLE_IDEAS: string[] = [
  "A programmer discovers her shadow has a mind of its own.",
  "Two rival chefs inherit the same empty restaurant on the same day.",
  "A courier delivers a letter that arrives one year before it was sent.",
];

export function IdeaIngestForm({ onIngested }: IdeaIngestFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [style, setStyle] = useState("Cinematic, natural lighting");
  const [userRequirement, setUserRequirement] = useState("");
  const { state, start } = useIngestStream();
  const [clientError, setClientError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setClientError(null);
    const trimmed = idea.trim();
    if (trimmed.length < 5) {
      setClientError("Idea is too short (5+ chars required).");
      return;
    }
    if (trimmed.length > 4000) {
      setClientError("Idea is too long (4,000 char limit).");
      return;
    }
    const done = await start({
      mode: "idea",
      title: title.trim() || undefined,
      idea: trimmed,
      style: style.trim() || undefined,
      userRequirement: userRequirement.trim() || undefined,
    });
    if (done) {
      onIngested?.(done.storyboardId);
      router.push(`/storyboard/${done.storyboardId}`);
    }
  };

  const isBusy = state.kind === "running";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100">
        <Sparkles className="size-3.5" />
        <span>
          Give us a one-liner. We&apos;ll develop it into a story, split it
          into scenes, extract characters, and build a storyboard — all in one pass.
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
          placeholder="e.g. Shadow Protocol"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          disabled={isBusy}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Idea
        </span>
        <textarea
          value={idea}
          onChange={(event) => setIdea(event.target.value)}
          placeholder={EXAMPLE_IDEAS[0]}
          rows={4}
          className="min-h-[88px] resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed"
          disabled={isBusy}
          required
        />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_IDEAS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setIdea(example)}
              disabled={isBusy}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-background/70 disabled:opacity-40"
            >
              <Lightbulb className="size-3" />
              {example.length > 50 ? `${example.slice(0, 50)}…` : example}
            </button>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>One sentence is plenty — the model will expand it.</span>
          <span>{idea.length.toLocaleString()} / 4,000 chars</span>
        </div>
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Visual style
          </span>
          <input
            type="text"
            value={style}
            onChange={(event) => setStyle(event.target.value)}
            placeholder="Gritty realism, anamorphic, cool grade"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            disabled={isBusy}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Constraints (optional)
          </span>
          <input
            type="text"
            value={userRequirement}
            onChange={(event) => setUserRequirement(event.target.value)}
            placeholder="e.g. 3 scenes, adult audience, noir"
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

      <IngestProgressPanel state={state} />

      {state.kind === "done" && state.done ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-200">
          Ingested — {state.done.characterCount} character
          {state.done.characterCount === 1 ? "" : "s"}, {state.done.nodeCount} shot
          {state.done.nodeCount === 1 ? "" : "s"} in {Math.round(state.done.totalDurationMs / 100) / 10}s.
          Opening storyboard…
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {isBusy
            ? "Streaming live progress from the idea pipeline."
            : "Idea → Story → Screenplay → Storyboard. Typical run ≈ 60–120s (two extra LLM passes before M1)."}
        </p>
        <Button type="submit" disabled={isBusy} className="gap-2">
          {isBusy ? (
            <>
              <span className="size-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              Developing…
            </>
          ) : (
            <>
              <Lightbulb className="size-4" />
              Ingest idea
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
