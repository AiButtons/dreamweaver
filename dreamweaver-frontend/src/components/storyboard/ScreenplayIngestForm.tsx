"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ScreenplayIngestFormProps {
  /** Called after successful ingestion so the parent can close its dialog. */
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

const EXAMPLE_PLACEHOLDER = `INT. ROOFTOP GARDEN - DUSK

KAI (late 20s, hooded) paces the edge, phone to his ear.

KAI
She's not answering.

ELENA (30s, dark coat) steps out behind him.

ELENA
We deliver, or we don't get paid.`;

export function ScreenplayIngestForm({ onIngested }: ScreenplayIngestFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [screenplay, setScreenplay] = useState("");
  const [style, setStyle] = useState("Cinematic, natural lighting");
  const [userRequirement, setUserRequirement] = useState("");
  const [status, setStatus] = useState<IngestStatus>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);

  // Tick an "elapsed" counter while the request is in-flight so the user
  // has feedback during the 30-90s Python pipeline wait.
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
    const trimmed = screenplay.trim();
    if (trimmed.length < 20) {
      setStatus({ kind: "error", message: "Screenplay is too short (20+ chars required)." });
      return;
    }
    if (trimmed.length > 60_000) {
      setStatus({ kind: "error", message: "Screenplay is too long (60k char limit)." });
      return;
    }
    setStatus({ kind: "submitting", startedAt: Date.now() });
    try {
      const response = await fetch("/api/storyboard/ingest-screenplay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          screenplay: trimmed,
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
      <div className="flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[12px] text-sky-200">
        <Sparkles className="size-3.5" />
        <span>
          Paste a screenplay or prose scene. We&apos;ll extract characters,
          generate portraits, and build a shot list.
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
          placeholder="e.g. Rooftop Confrontation"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          disabled={isBusy}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Screenplay
        </span>
        <textarea
          value={screenplay}
          onChange={(event) => setScreenplay(event.target.value)}
          placeholder={EXAMPLE_PLACEHOLDER}
          rows={12}
          className="min-h-[220px] resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] leading-relaxed"
          disabled={isBusy}
          required
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Fountain, FDX prose, or plain narrative — we auto-detect.</span>
          <span>{screenplay.length.toLocaleString()} / 60,000 chars</span>
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
            placeholder="e.g. No more than 12 shots"
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
            ? `Ingesting… ${elapsed}s — extracting characters, designing shots, generating portraits.`
            : "Ingestion runs one LLM pass per shot. Typical 1-page scene ≈ 30–90s."}
        </p>
        <Button type="submit" disabled={isBusy} className="gap-2">
          {isBusy ? (
            <>
              <span className="size-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              Ingesting…
            </>
          ) : (
            <>
              <FileText className="size-4" />
              Ingest screenplay
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
