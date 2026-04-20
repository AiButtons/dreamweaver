"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";

import type { ConstraintBundle, IdentityReferenceRecord, PortraitView } from "@/app/storyboard/types";
import {
  orderPortraitsCanonically,
  PORTRAIT_VIEW_OPTIONS,
  portraitSetStatus,
} from "@/lib/identity-portraits";
import { queryRef } from "@/lib/convexRefs";

type ViolationStatus = "acknowledged" | "resolved";

type IdentityPortraitCallbacks = {
  addPortrait: (input: {
    storyboardId: string;
    ownerPackId: string;
    portraitView: PortraitView;
    sourceUrl: string;
    notes?: string;
  }) => Promise<void>;
  removePortrait: (input: { referenceId: string }) => Promise<void>;
};

type ContinuityOSPanelProps = {
  bundle: ConstraintBundle | null;
  onDetectContradictions: () => Promise<void>;
  onRunShotValidators?: () => Promise<void>;
  onResolveViolation?: (violationId: string, status: ViolationStatus) => Promise<void>;
  onPublishIdentityPack?: (packId: string, publish: boolean) => Promise<void>;
  /** M6 — update the per-character TTS voice assignment. Empty string
   *  clears the assignment (audio batch falls back to its default). */
  onSetIdentityPackVoice?: (packId: string, voice: string) => Promise<void>;
  // Portrait surface wiring (#7). Both need to be provided together for the
  // "Reference portraits" section to show its edit affordances; if either is
  // missing the section renders in read-only mode.
  storyboardId?: string;
  identityPortraitCallbacks?: IdentityPortraitCallbacks;
};

type TabKey = "identity" | "constraints" | "violations";

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const asBool = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

export function ContinuityOSPanel({
  bundle,
  onDetectContradictions,
  onRunShotValidators,
  onResolveViolation,
  onPublishIdentityPack,
  onSetIdentityPackVoice,
  storyboardId,
  identityPortraitCallbacks,
}: ContinuityOSPanelProps) {
  const identityPacks = bundle?.identityPacks ?? [];
  const globalConstraints = bundle?.globalConstraints ?? [];
  const violations = bundle?.continuityViolations ?? [];

  const [tab, setTab] = useState<TabKey>(
    violations.length > 0 ? "violations" : "identity",
  );

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/95 text-zinc-100 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Continuity OS</p>
          <h3 className="mt-1 text-sm font-semibold">DNA + Constraints</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded bg-zinc-800 px-2 py-1 text-xs"
            onClick={() => void onDetectContradictions()}
          >
            Detect
          </button>
          <button
            type="button"
            className="rounded bg-zinc-800 px-2 py-1 text-xs disabled:opacity-50"
            onClick={() => onRunShotValidators && void onRunShotValidators()}
            disabled={!onRunShotValidators}
          >
            Validate shots
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <Stat label="Identity Packs" value={String(identityPacks.length)} />
        <Stat label="Constraints" value={String(globalConstraints.length)} />
        <Stat label="Open Violations" value={String(violations.length)} />
      </div>

      <div className="mt-3 flex gap-1 border-b border-zinc-800">
        <TabButton active={tab === "identity"} onClick={() => setTab("identity")}>
          Identity ({identityPacks.length})
        </TabButton>
        <TabButton active={tab === "constraints"} onClick={() => setTab("constraints")}>
          Constraints ({globalConstraints.length})
        </TabButton>
        <TabButton active={tab === "violations"} onClick={() => setTab("violations")}>
          Violations ({violations.length})
        </TabButton>
      </div>

      <div className="mt-3 max-h-80 overflow-y-auto space-y-2">
        {tab === "identity" ? (
          <IdentityPacksView
            packs={identityPacks}
            onPublishIdentityPack={onPublishIdentityPack}
            onSetIdentityPackVoice={onSetIdentityPackVoice}
            storyboardId={storyboardId}
            identityPortraitCallbacks={identityPortraitCallbacks}
          />
        ) : null}
        {tab === "constraints" ? (
          <ConstraintsView constraints={globalConstraints} />
        ) : null}
        {tab === "violations" ? (
          <ViolationsView violations={violations} onResolveViolation={onResolveViolation} />
        ) : null}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 p-2">
      <p className="text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className="text-zinc-100 font-medium">{value}</p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-2 py-1 text-[11px] transition-colors " +
        (active
          ? "border-b-2 border-emerald-400 text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300")
      }
    >
      {children}
    </button>
  );
}

function IdentityPacksView({
  packs,
  onPublishIdentityPack,
  onSetIdentityPackVoice,
  storyboardId,
  identityPortraitCallbacks,
}: {
  packs: Array<Record<string, unknown>>;
  onPublishIdentityPack?: (packId: string, publish: boolean) => Promise<void>;
  onSetIdentityPackVoice?: (packId: string, voice: string) => Promise<void>;
  storyboardId?: string;
  identityPortraitCallbacks?: IdentityPortraitCallbacks;
}) {
  if (packs.length === 0) {
    return <p className="text-[11px] text-zinc-500">No identity packs yet.</p>;
  }
  return (
    <>
      {packs.slice(0, 12).map((pack, index) => (
        <IdentityPackRow
          key={asString(pack.packId, `pack_${index}`)}
          pack={pack}
          onPublishIdentityPack={onPublishIdentityPack}
          onSetIdentityPackVoice={onSetIdentityPackVoice}
          storyboardId={storyboardId}
          identityPortraitCallbacks={identityPortraitCallbacks}
        />
      ))}
    </>
  );
}

// M6 — canonical OpenAI TTS voice roster surfaced in the picker. Kept
// in sync with `ALLOWED_VOICES` in /api/media/generate-audio/route.ts.
const VOICE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "(default)" },
  { value: "alloy", label: "alloy" },
  { value: "echo", label: "echo" },
  { value: "fable", label: "fable" },
  { value: "onyx", label: "onyx" },
  { value: "nova", label: "nova" },
  { value: "shimmer", label: "shimmer" },
];

function IdentityPackRow({
  pack,
  onPublishIdentityPack,
  onSetIdentityPackVoice,
  storyboardId,
  identityPortraitCallbacks,
}: {
  pack: Record<string, unknown>;
  onPublishIdentityPack?: (packId: string, publish: boolean) => Promise<void>;
  onSetIdentityPackVoice?: (packId: string, voice: string) => Promise<void>;
  storyboardId?: string;
  identityPortraitCallbacks?: IdentityPortraitCallbacks;
}) {
  const packId = asString(pack.packId);
  const packRowId = asString(pack._id);
  const name = asString(pack.name, packId || "Identity Pack");
  const description = asString(pack.description);
  const visibility = asString(pack.visibility, "project");
  const published = asBool(pack.published);
  const sourceCharacterId = asString(pack.sourceCharacterId);
  const voice = asString(pack.voice);
  const dnaJson = asString(pack.dnaJson);
  const [expanded, setExpanded] = useState(false);
  const [portraitsExpanded, setPortraitsExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);

  const dnaPreview = useMemo(() => {
    if (!dnaJson) return "";
    try {
      return JSON.stringify(JSON.parse(dnaJson), null, 2);
    } catch {
      return dnaJson;
    }
  }, [dnaJson]);

  const togglePublished = async () => {
    if (!onPublishIdentityPack || !packId || busy) return;
    setBusy(true);
    try {
      await onPublishIdentityPack(packId, !published);
    } finally {
      setBusy(false);
    }
  };

  const handleVoiceChange = async (next: string) => {
    if (!onSetIdentityPackVoice || !packId) return;
    setVoiceBusy(true);
    try {
      await onSetIdentityPackVoice(packId, next);
    } finally {
      setVoiceBusy(false);
    }
  };

  return (
    <div className="rounded border border-zinc-800 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium truncate">{name}</p>
          <p className="text-[11px] text-zinc-400">
            {visibility}
            {published ? " • published" : ""}
            {sourceCharacterId ? ` • source ${sourceCharacterId}` : ""}
          </p>
          {description ? (
            <p className="text-[11px] text-zinc-500 line-clamp-2">{description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onSetIdentityPackVoice && packId ? (
            <label
              className="flex items-center gap-1 text-[10px] text-zinc-400"
              title="OpenAI TTS voice the audio batch uses when this character is the detected speaker"
            >
              <span className="uppercase tracking-wide">Voice</span>
              <select
                value={voice}
                onChange={(e) => void handleVoiceChange(e.target.value)}
                disabled={voiceBusy}
                className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-200 disabled:opacity-50"
              >
                {VOICE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {onPublishIdentityPack && packId ? (
            <button
              type="button"
              className="rounded bg-zinc-800 px-2 py-1 text-[10px] disabled:opacity-40"
              onClick={() => void togglePublished()}
              disabled={busy}
            >
              {published ? "Unpublish" : "Publish"}
            </button>
          ) : null}
        </div>
      </div>
      {dnaPreview ? (
        <button
          type="button"
          className="mt-1 text-[10px] text-zinc-400 underline underline-offset-2"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? "Hide DNA" : "Show DNA"}
        </button>
      ) : null}
      {expanded && dnaPreview ? (
        <pre className="mt-1 max-h-40 overflow-auto rounded border border-zinc-800 bg-zinc-900 p-2 text-[10px] text-zinc-300">
          {dnaPreview}
        </pre>
      ) : null}

      {/* Reference portraits collapsible. Only mounts its useQuery subtree
          when the row is expanded, so the drawer's Identity tab stays
          lightweight on first open. */}
      {packRowId ? (
        <div className="mt-2 border-t border-zinc-800 pt-2">
          <button
            type="button"
            className="text-[10px] text-zinc-400 underline underline-offset-2"
            onClick={() => setPortraitsExpanded((prev) => !prev)}
          >
            {portraitsExpanded ? "Hide reference portraits" : "Reference portraits"}
          </button>
          {portraitsExpanded ? (
            <ReferencePortraitsSection
              storyboardId={storyboardId}
              packRowId={packRowId}
              callbacks={identityPortraitCallbacks}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReferencePortraitsSection({
  storyboardId,
  packRowId,
  callbacks,
}: {
  storyboardId?: string;
  packRowId: string;
  callbacks?: IdentityPortraitCallbacks;
}) {
  // Skip the query entirely until we know which storyboard this row belongs
  // to. Convex `useQuery` treats `"skip"` as "don't subscribe", so the
  // section renders a gentle empty state instead of querying against an
  // empty id.
  const portraits = useQuery(
    queryRef("identityReferences:listIdentityPortraitsForPack"),
    storyboardId
      ? { storyboardId, ownerPackId: packRowId }
      : "skip",
  ) as IdentityReferenceRecord[] | undefined;

  const [addOpen, setAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewDraft, setViewDraft] = useState<PortraitView>("front");
  const [urlDraft, setUrlDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const ordered = useMemo(
    () => (portraits ? orderPortraitsCanonically(portraits) : []),
    [portraits],
  );
  const status = useMemo(
    () => portraitSetStatus(portraits ?? []),
    [portraits],
  );

  if (!storyboardId) {
    return (
      <p className="mt-2 text-[11px] text-zinc-500">
        Open a storyboard to manage portraits.
      </p>
    );
  }

  const canAdd = Boolean(callbacks?.addPortrait);
  const canRemove = Boolean(callbacks?.removePortrait);

  const submit = async () => {
    if (!callbacks?.addPortrait) return;
    const url = urlDraft.trim();
    if (!url) return;
    setSubmitting(true);
    try {
      await callbacks.addPortrait({
        storyboardId,
        ownerPackId: packRowId,
        portraitView: viewDraft,
        sourceUrl: url,
        notes: notesDraft.trim() || undefined,
      });
      setUrlDraft("");
      setNotesDraft("");
      setViewDraft("front");
      setAddOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (referenceId: string) => {
    if (!callbacks?.removePortrait) return;
    setBusyId(referenceId);
    try {
      await callbacks.removePortrait({ referenceId });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {/* Canonical three-view status. Emerald tick = present, slate dot = missing. */}
      <div className="flex items-center gap-2 text-[10px] text-zinc-400">
        <span className="uppercase tracking-wide text-zinc-500">3-view</span>
        <CanonicalBadge label="Front" ok={status.hasFront} />
        <CanonicalBadge label="Side" ok={status.hasSide} />
        <CanonicalBadge label="Back" ok={status.hasBack} />
        {status.hasCanonicalThreeView ? (
          <span className="text-emerald-400">complete</span>
        ) : (
          <span className="text-zinc-500">
            missing {status.missingCanonical.join(", ")}
          </span>
        )}
      </div>

      {portraits === undefined ? (
        <p className="text-[11px] text-zinc-500">Loading portraits...</p>
      ) : ordered.length === 0 ? (
        <p className="text-[11px] text-zinc-500">No reference portraits yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {ordered.map((portrait) => (
            <PortraitThumb
              key={portrait._id}
              portrait={portrait}
              busy={busyId === portrait._id}
              canRemove={canRemove}
              onRemove={() => void remove(portrait._id)}
            />
          ))}
        </div>
      )}

      {canAdd ? (
        <div className="mt-1">
          {addOpen ? (
            <div className="rounded border border-zinc-800 p-2 space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-[10px] uppercase tracking-wide text-zinc-500 w-10">
                  View
                </label>
                <select
                  value={viewDraft}
                  onChange={(e) => setViewDraft(e.target.value as PortraitView)}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100"
                >
                  {PORTRAIT_VIEW_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} — {opt.description}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] uppercase tracking-wide text-zinc-500 w-10">
                  URL
                </label>
                <input
                  type="url"
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  placeholder="https://..."
                  className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100"
                />
              </div>
              <div className="flex items-start gap-2">
                <label className="text-[10px] uppercase tracking-wide text-zinc-500 w-10 pt-1">
                  Notes
                </label>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={2}
                  placeholder="Optional"
                  className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300"
                  onClick={() => {
                    setAddOpen(false);
                    setUrlDraft("");
                    setNotesDraft("");
                  }}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded bg-emerald-700 px-2 py-1 text-[10px] text-white disabled:opacity-40"
                  onClick={() => void submit()}
                  disabled={submitting || !urlDraft.trim()}
                >
                  {submitting ? "Adding..." : "Add"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300"
              onClick={() => setAddOpen(true)}
            >
              + Add portrait
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CanonicalBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] " +
        (ok
          ? "bg-emerald-900/40 text-emerald-300"
          : "bg-zinc-800 text-zinc-500")
      }
    >
      <span aria-hidden>{ok ? "✓" : "·"}</span>
      {label}
    </span>
  );
}

function PortraitThumb({
  portrait,
  busy,
  canRemove,
  onRemove,
}: {
  portrait: IdentityReferenceRecord;
  busy: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const viewLabel =
    PORTRAIT_VIEW_OPTIONS.find((opt) => opt.value === portrait.portraitView)?.label ??
    (portrait.portraitView ?? "unknown");
  return (
    <div className="relative group">
      <img
        src={portrait.sourceUrl}
        alt={viewLabel}
        className="aspect-square w-full object-cover rounded border border-border/60"
      />
      <div className="mt-1 flex items-center justify-between gap-1 text-[10px] text-zinc-400">
        <span className="truncate">{viewLabel}</span>
        {canRemove ? (
          <button
            type="button"
            className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-300 disabled:opacity-40"
            onClick={onRemove}
            disabled={busy}
            aria-label="Remove portrait"
            title="Remove portrait"
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ConstraintsView({
  constraints,
}: {
  constraints: Array<Record<string, unknown>>;
}) {
  if (constraints.length === 0) {
    return <p className="text-[11px] text-zinc-500">No enabled constraints.</p>;
  }
  return (
    <>
      {constraints.slice(0, 12).map((row, index) => (
        <ConstraintRow
          key={asString(row.constraintId, `constraint_${index}`)}
          row={row}
        />
      ))}
    </>
  );
}

function severityClass(severity: string): string {
  switch (severity) {
    case "critical":
      return "text-rose-300";
    case "high":
      return "text-orange-300";
    case "medium":
      return "text-amber-300";
    case "low":
    default:
      return "text-emerald-300";
  }
}

function ConstraintRow({ row }: { row: Record<string, unknown> }) {
  const name = asString(row.name, asString(row.constraintId, "Constraint"));
  const description = asString(row.description);
  const severity = asString(row.severity, "medium");
  const scope = asString(row.scope, "character");
  const expressionJson = asString(row.expressionJson);
  const [expanded, setExpanded] = useState(false);

  const pretty = useMemo(() => {
    if (!expressionJson) return "";
    try {
      return JSON.stringify(JSON.parse(expressionJson), null, 2);
    } catch {
      return expressionJson;
    }
  }, [expressionJson]);

  return (
    <div className="rounded border border-zinc-800 p-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">{name}</p>
        <span className={"text-[10px] uppercase tracking-wide " + severityClass(severity)}>
          {severity}
        </span>
      </div>
      <p className="text-[11px] text-zinc-400">
        scope: {scope}
      </p>
      {description ? (
        <p className="mt-0.5 text-[11px] text-zinc-500 line-clamp-2">{description}</p>
      ) : null}
      {pretty ? (
        <button
          type="button"
          className="mt-1 text-[10px] text-zinc-400 underline underline-offset-2"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? "Hide expression" : "Show expression"}
        </button>
      ) : null}
      {expanded && pretty ? (
        <pre className="mt-1 max-h-40 overflow-auto rounded border border-zinc-800 bg-zinc-900 p-2 text-[10px] text-zinc-300">
          {pretty}
        </pre>
      ) : null}
    </div>
  );
}

function ViolationsView({
  violations,
  onResolveViolation,
}: {
  violations: Array<Record<string, unknown>>;
  onResolveViolation?: (violationId: string, status: ViolationStatus) => Promise<void>;
}) {
  if (violations.length === 0) {
    return <p className="text-[11px] text-zinc-500">No open contradictions.</p>;
  }
  return (
    <>
      {violations.slice(0, 10).map((row, index) => (
        <ViolationRow
          key={asString(row.violationId, `vio_${index}`)}
          row={row}
          onResolveViolation={onResolveViolation}
        />
      ))}
    </>
  );
}

function ViolationRow({
  row,
  onResolveViolation,
}: {
  row: Record<string, unknown>;
  onResolveViolation?: (violationId: string, status: ViolationStatus) => Promise<void>;
}) {
  const violationId = asString(row.violationId);
  const code = asString(row.code, "VIOLATION");
  const severity = asString(row.severity, "medium");
  const status = asString(row.status, "open");
  const message = asString(row.message);
  const suggestedFix = asString(row.suggestedFix);
  const nodeIds = asStringArray(row.nodeIds);
  const [busy, setBusy] = useState(false);

  const decide = async (next: ViolationStatus) => {
    if (!onResolveViolation || !violationId || busy) return;
    setBusy(true);
    try {
      await onResolveViolation(violationId, next);
    } finally {
      setBusy(false);
    }
  };

  const terminal = status === "resolved";

  return (
    <div className="rounded border border-zinc-800 p-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">{code}</p>
        <span className={"text-[10px] uppercase tracking-wide " + severityClass(severity)}>
          {severity}
        </span>
      </div>
      <p className="text-[11px] text-zinc-400">{status}</p>
      {message ? <p className="mt-1 text-[11px] text-zinc-300">{message}</p> : null}
      {suggestedFix ? (
        <p className="mt-1 text-[11px] text-emerald-300/80">Fix: {suggestedFix}</p>
      ) : null}
      {nodeIds.length > 0 ? (
        <p className="mt-1 text-[10px] text-zinc-500">
          nodes: {nodeIds.slice(0, 6).join(", ")}
          {nodeIds.length > 6 ? ` (+${nodeIds.length - 6})` : ""}
        </p>
      ) : null}
      {onResolveViolation && violationId ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="rounded bg-amber-700 px-2 py-1 text-[10px] disabled:opacity-40"
            onClick={() => void decide("acknowledged")}
            disabled={busy || terminal || status === "acknowledged"}
          >
            Acknowledge
          </button>
          <button
            type="button"
            className="rounded bg-emerald-700 px-2 py-1 text-[10px] disabled:opacity-40"
            onClick={() => void decide("resolved")}
            disabled={busy || terminal}
          >
            Resolve
          </button>
        </div>
      ) : null}
    </div>
  );
}
