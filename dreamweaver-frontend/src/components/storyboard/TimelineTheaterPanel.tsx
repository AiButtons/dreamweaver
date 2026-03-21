"use client";

import type {
  NarrativeBranchRecord,
  NarrativeCommitRecord,
  SimulationCriticRunRecord,
} from "@/app/storyboard/types";

type TimelineTheaterPanelProps = {
  simulationRuns: SimulationCriticRunRecord[];
  branches: NarrativeBranchRecord[];
  commits: NarrativeCommitRecord[];
  onRunCritic: () => Promise<void>;
  onCreateBranch: () => Promise<void>;
  onCherryPickLatest: () => Promise<void>;
  onComputeLatestDiff: () => Promise<void>;
};

export function TimelineTheaterPanel({
  simulationRuns,
  branches,
  commits,
  onRunCritic,
  onCreateBranch,
  onCherryPickLatest,
  onComputeLatestDiff,
}: TimelineTheaterPanelProps) {
  const rows = simulationRuns.slice(0, 6);
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/95 text-zinc-100 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Timeline Theater</p>
          <h3 className="mt-1 text-sm font-semibold">Simulation Critic</h3>
        </div>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 text-xs"
          onClick={() => void onRunCritic()}
        >
          Run Critic
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="rounded bg-blue-700 px-2 py-1 text-[10px]"
          onClick={() => void onCreateBranch()}
        >
          Create Branch
        </button>
        <button
          type="button"
          className="rounded bg-violet-700 px-2 py-1 text-[10px]"
          onClick={() => void onCherryPickLatest()}
        >
          Cherry-pick Latest
        </button>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 text-[10px]"
          onClick={() => void onComputeLatestDiff()}
        >
          Compute Diff
        </button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        Branches: {branches.length} • Commits: {commits.length}
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-[11px] text-zinc-400">No simulation runs yet.</p>
      ) : (
        <div className="mt-3 space-y-2 max-h-56 overflow-y-auto">
          {rows.map((row) => (
            <div key={row._id} className="rounded border border-zinc-800 p-2">
              <p className="text-xs font-medium">{row.summary}</p>
              <p className="text-[11px] text-zinc-400">
                {row.riskLevel.toUpperCase()} • confidence {row.confidence.toFixed(2)} • impact {row.impactScore.toFixed(2)}
              </p>
              <p className="text-[11px] text-zinc-500">
                {row.status} • {row.branchId}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
