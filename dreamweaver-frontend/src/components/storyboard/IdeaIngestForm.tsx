"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface IdeaIngestFormProps {
  onIngested?: (storyboardId: string) => void;
}

type IngestStatus =
  | { kind: "idle" }
  | { kind: "submitting"; startedAt: number }
  | {
      kind: "success";
      storyboardId: string;
      characterCount: number;
      nodeCount: number;
      durationMs: number;
    }
  | { kind: "error"; message: string };

interface IngestResponse {
  storyboardId: string;
  characterCount: number;
  portraitCount: number;
  nodeCount: number;
  edgeCount: number;
  llmCallCount: number;
  pipelineDurationMs: number;
  preprocessed: boolean;
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
  const [status, setStatus] = useState<IngestStatus>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);

  React.useEffect(() => {
    if (status.kind !== "submitting") {
      setElapsed(0);
      return;
    }
    const started = status.startedAt;
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [status]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = idea.trim();
    if (trimmed.length < 5) {
      setStatus({ kind: "error", message: "Idea is too short (5+ chars required)." });
      return;
    }
    if (trimmed.length > 4000) {
      setStatus({ kind: "error", message: "Idea is too long (4,000 char limit)." });
      return;
    }
    setStatus({ kind: "submitting", startedAt: Date.now() });
    try {
      const response = await fetch("/api/storyboard/ingest-idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          idea: trimmed,
          style: style.trim() || undefined,
          userRequirement: userRequirement.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        let msg = `Ingest failed (${response.status})`;
        try {
          const parsed = JSON.parse(text) as { error?: string };
          if (parsed.error) msg = parsed.error;
        } catch {
          if (text) msg = text.slice(0, 300);
        }
        setStatus({ kind: "error", message: msg });
        return;
      }
      const data = (await response.json()) as IngestResponse;
      setStatus({
        kind: "success",
        storyboardId: data.storyboardId,
        characterCount: data.characterCount,
        nodeCount: data.nodeCount,
        durationMs: data.pipelineDurationMs,
      });
      onIngested?.(data.storyboardId);
      router.push(`/storyboard/${data.storyboardId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setStatus({ kind: "error", message: msg });
    }
  };

  const isBusy = status.kind === "submitting";

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

      {status.kind === "error" ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
          {status.message}
        </div>
      ) : null}

      {status.kind === "success" ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-200">
          Ingested — {status.characterCount} character
          {status.characterCount === 1 ? "" : "s"}, {status.nodeCount} shot
          {status.nodeCount === 1 ? "" : "s"} in {Math.round(status.durationMs / 100) / 10}s.
          Opening storyboard…
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {isBusy
            ? `Developing story… ${elapsed}s — writing scenes, extracting characters, generating portraits.`
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
