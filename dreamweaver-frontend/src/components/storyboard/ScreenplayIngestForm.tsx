"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIngestStream } from "@/lib/sse-ingest";
import { IngestProgressPanel } from "./IngestProgressPanel";

interface ScreenplayIngestFormProps {
  /** Called after successful ingestion so the parent can close its dialog. */
  onIngested?: (storyboardId: string) => void;
  /** Pre-filled title when the chat supervisor routed the producer here. */
  initialTitle?: string;
  /** Pre-filled visual-style directive. */
  initialStyle?: string;
  /** Pre-filled constraints / user-requirement hint. */
  initialUserRequirement?: string;
}

const EXAMPLE_PLACEHOLDER = `INT. ROOFTOP GARDEN - DUSK

KAI (late 20s, hooded) paces the edge, phone to his ear.

KAI
She's not answering.

ELENA (30s, dark coat) steps out behind him.

ELENA
We deliver, or we don't get paid.`;

export function ScreenplayIngestForm({
  onIngested,
  initialTitle,
  initialStyle,
  initialUserRequirement,
}: ScreenplayIngestFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle ?? "");
  const [screenplay, setScreenplay] = useState("");
  const [style, setStyle] = useState(initialStyle ?? "Cinematic, natural lighting");
  const [userRequirement, setUserRequirement] = useState(initialUserRequirement ?? "");
  const { state, start, cancel } = useIngestStream();
  const [clientError, setClientError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setClientError(null);
    const trimmed = screenplay.trim();
    // Reject empty / all-whitespace payloads before the length check so
    // the user gets an accurate message instead of "too short".
    if (trimmed.length === 0) {
      setClientError("Paste a screenplay before submitting.");
      return;
    }
    if (trimmed.length < 20) {
      setClientError("Screenplay is too short (20+ chars required).");
      return;
    }
    if (trimmed.length > 60_000) {
      setClientError("Screenplay is too long (60k char limit).");
      return;
    }
    const done = await start({
      mode: "screenplay",
      title: title.trim() || undefined,
      screenplay: trimmed,
      style: style.trim() || undefined,
      userRequirement: userRequirement.trim() || undefined,
    });
    if (done) {
      onIngested?.(done.storyboardId);
      router.push(`/storyboard/${done.storyboardId}`);
    }
  };

  // Only lock the form while the stream is actively running. After an
  // error lands, state.kind flips to "error" and the user can edit +
  // retry immediately. The ingest route already handles re-submission
  // cleanly (each call opens a new storyboard row).
  const isBusy = state.kind === "running";

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

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          {isBusy
            ? "Streaming live progress from the ingestion pipeline."
            : "Ingestion runs one LLM pass per shot. Typical 1-page scene ≈ 30–90s."}
        </p>
        <div className="flex items-center gap-2">
          {isBusy ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => cancel()}
              className="gap-1.5"
            >
              Cancel
            </Button>
          ) : null}
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
      </div>
    </form>
  );
}
