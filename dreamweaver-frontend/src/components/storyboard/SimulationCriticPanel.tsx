"use client";

import { useMemo, useState } from "react";

import type { SimulationCriticRunRecord } from "@/app/storyboard/types";

type SimulationDecision = "applied" | "rejected" | "complete";

type RepairOp = {
  opId?: string;
  op?: string;
  title?: string;
  rationale?: string;
  nodeId?: string;
};

type CriticIssue = {
  code?: string;
  severity?: string;
  message?: string;
  suggestedFix?: string;
};

function parseOps(raw: string): RepairOp[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RepairOp => typeof item === "object" && item !== null);
  } catch {
    return [];
  }
}

function parseIssues(raw: string): CriticIssue[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CriticIssue => typeof item === "object" && item !== null);
  } catch {
    return [];
  }
}

function SimulationRow({
  row,
  onUpdateStatus,
}: {
  row: SimulationCriticRunRecord;
  onUpdateStatus: (
    simulationRunId: string,
    status: SimulationDecision,
    justification?: string,
  ) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);

  const ops = useMemo(() => parseOps(row.repairOperationsJson), [row.repairOperationsJson]);
  const issues = useMemo(() => parseIssues(row.issuesJson), [row.issuesJson]);
  const terminal =
    row.status === "applied" || row.status === "rejected" || row.status === "complete";

  const handle = async (status: SimulationDecision) => {
    if (busy) return;
    setBusy(true);
    try {
      await onUpdateStatus(row.simulationRunId, status, justification.trim() || undefined);
      setJustification("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded border border-zinc-800 p-2">
      <p className="text-xs font-medium">{row.summary || "Simulation critic run"}</p>
      <p className="text-[11px] text-zinc-400">
        {row.riskLevel.toUpperCase()} • {row.status} • {ops.length} repair op(s) • {issues.length} issue(s) •
        conf {row.confidence.toFixed(2)} • impact {row.impactScore.toFixed(2)}
        {row.approvalTaskId ? " • linked approval" : ""}
      </p>
      <p className="text-[11px] text-zinc-500">
        Run {row.simulationRunId} • {row.branchId}
      </p>
      <button
        type="button"
        className="mt-1 text-[10px] text-zinc-400 underline underline-offset-2"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? "Hide details" : "Show details"}
      </button>
      {expanded ? (
        <div className="mt-2 space-y-2 rounded border border-zinc-800 bg-zinc-900/60 p-2">
          {ops.length === 0 ? (
            <p className="text-[11px] text-zinc-500">No repair operations.</p>
          ) : (
            <ul className="space-y-1 text-[11px] text-zinc-300">
              {ops.slice(0, 12).map((op, index) => (
                <li key={op.opId ?? `op_${index}`}>
                  <span className="font-mono text-zinc-400">{op.op ?? "op"}</span>
                  {op.title ? ` — ${op.title}` : ""}
                  {op.nodeId ? (
                    <span className="ml-1 text-zinc-500">({op.nodeId})</span>
                  ) : null}
                </li>
              ))}
              {ops.length > 12 ? (
                <li className="text-zinc-500">…and {ops.length - 12} more</li>
              ) : null}
            </ul>
          )}
          {issues.length > 0 ? (
            <ul className="space-y-1 text-[11px] text-amber-300/90">
              {issues.slice(0, 6).map((issue, index) => (
                <li key={issue.code ?? `issue_${index}`}>
                  <span className="font-mono uppercase">{issue.severity ?? "med"}</span>
                  {issue.code ? ` ${issue.code}` : ""}
                  {issue.message ? ` — ${issue.message}` : ""}
                  {issue.suggestedFix ? (
                    <div className="ml-3 mt-0.5 text-emerald-300/80">
                      Fix: {issue.suggestedFix}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {!terminal ? (
        <textarea
          className="mt-2 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-500"
          rows={2}
          placeholder="Reviewer justification (optional)"
          value={justification}
          onChange={(event) => setJustification(event.target.value)}
          disabled={busy}
        />
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="rounded bg-emerald-700 px-2 py-1 text-[10px] disabled:opacity-40"
          onClick={() => void handle("applied")}
          disabled={busy || terminal}
        >
          Apply
        </button>
        <button
          type="button"
          className="rounded bg-blue-700 px-2 py-1 text-[10px] disabled:opacity-40"
          onClick={() => void handle("complete")}
          disabled={busy || terminal}
        >
          Complete
        </button>
        <button
          type="button"
          className="rounded bg-rose-700 px-2 py-1 text-[10px] disabled:opacity-40"
          onClick={() => void handle("rejected")}
          disabled={busy || terminal}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

type SimulationCriticPanelProps = {
  simulationRuns: SimulationCriticRunRecord[];
  onRunCritic: () => Promise<void>;
  onUpdateStatus: (
    simulationRunId: string,
    status: SimulationDecision,
    justification?: string,
  ) => Promise<void>;
};

export function SimulationCriticPanel({
  simulationRuns,
  onRunCritic,
  onUpdateStatus,
}: SimulationCriticPanelProps) {
  const rows = simulationRuns.slice(0, 6);
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/95 text-zinc-100 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Simulation Critic</p>
          <h3 className="mt-1 text-sm font-semibold">Repair Batches</h3>
        </div>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 text-xs"
          onClick={() => void onRunCritic()}
        >
          Run Critic
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-[11px] text-zinc-400">No simulation runs yet.</p>
      ) : (
        <div className="mt-3 space-y-2 max-h-[28rem] overflow-y-auto">
          {rows.map((row) => (
            <SimulationRow key={row._id} row={row} onUpdateStatus={onUpdateStatus} />
          ))}
        </div>
      )}
    </section>
  );
}
