"use client";

import { useMemo, useState } from "react";

import type { ConstraintBundle } from "@/app/storyboard/types";

type ViolationStatus = "acknowledged" | "resolved";

type ContinuityOSPanelProps = {
  bundle: ConstraintBundle | null;
  onDetectContradictions: () => Promise<void>;
  onResolveViolation?: (violationId: string, status: ViolationStatus) => Promise<void>;
  onPublishIdentityPack?: (packId: string, publish: boolean) => Promise<void>;
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
  onResolveViolation,
  onPublishIdentityPack,
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
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 text-xs"
          onClick={() => void onDetectContradictions()}
        >
          Detect
        </button>
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
}: {
  packs: Array<Record<string, unknown>>;
  onPublishIdentityPack?: (packId: string, publish: boolean) => Promise<void>;
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
        />
      ))}
    </>
  );
}

function IdentityPackRow({
  pack,
  onPublishIdentityPack,
}: {
  pack: Record<string, unknown>;
  onPublishIdentityPack?: (packId: string, publish: boolean) => Promise<void>;
}) {
  const packId = asString(pack.packId);
  const name = asString(pack.name, packId || "Identity Pack");
  const description = asString(pack.description);
  const visibility = asString(pack.visibility, "project");
  const published = asBool(pack.published);
  const sourceCharacterId = asString(pack.sourceCharacterId);
  const dnaJson = asString(pack.dnaJson);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

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
        {onPublishIdentityPack && packId ? (
          <button
            type="button"
            className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-[10px] disabled:opacity-40"
            onClick={() => void togglePublished()}
            disabled={busy}
          >
            {published ? "Unpublish" : "Publish"}
          </button>
        ) : null}
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
