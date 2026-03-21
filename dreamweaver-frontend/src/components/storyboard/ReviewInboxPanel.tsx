"use client";

import type { ApprovalTaskRecord } from "@/app/storyboard/types";

type ReviewInboxPanelProps = {
  approvals: ApprovalTaskRecord[];
};

const parseJson = (raw: string | undefined): Record<string, unknown> | null => {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed;
  } catch {
    return null;
  }
};

export function ReviewInboxPanel({ approvals }: ReviewInboxPanelProps) {
  const rows = approvals.slice(0, 8);
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/95 text-zinc-100 p-4">
      <p className="text-[11px] uppercase tracking-wide text-zinc-400">Review Inbox</p>
      <h3 className="mt-1 text-sm font-semibold">Approvals</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-[11px] text-zinc-400">No approval tasks.</p>
      ) : (
        <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
          {rows.map((row) => {
            const payload = parseJson(row.payloadJson);
            const execution = parseJson(row.executionResultJson);
            const policyEvidence = execution?.policyEvidence;
            return (
              <div key={row._id} className="rounded border border-zinc-800 p-2">
                <p className="text-xs font-medium">{row.title}</p>
                <p className="text-[11px] text-zinc-500">
                  {row.taskType} • {row.status}
                </p>
                {row.diffSummary ? (
                  <p className="mt-1 text-[11px] text-zinc-400">{row.diffSummary}</p>
                ) : null}
                {payload ? (
                  <p className="mt-1 text-[11px] text-zinc-500">
                    rollback preview: {(payload.previousHeadCommitId as string) ?? "n/a"}
                  </p>
                ) : null}
                {policyEvidence && typeof policyEvidence === "object" ? (
                  <p className="mt-1 text-[11px] text-emerald-300">
                    policy: {JSON.stringify(policyEvidence)}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

