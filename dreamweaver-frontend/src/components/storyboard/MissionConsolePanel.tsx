"use client";

import type {
  AgentDelegationRecord,
  QuotaUsageSummary,
  RuntimeResolvedTeam,
  SimulationCriticRunRecord,
  ToolCallAuditRecord,
} from "@/app/storyboard/types";

type MissionConsolePanelProps = {
  runtimeTeam: RuntimeResolvedTeam | null;
  quotaSummary: QuotaUsageSummary | null;
  pendingApprovalsCount: number;
  currentMode: "graph_studio" | "agent_draft";
  delegations: AgentDelegationRecord[];
  audits: ToolCallAuditRecord[];
  latestSimulationRun: SimulationCriticRunRecord | null;
};

export function MissionConsolePanel({
  runtimeTeam,
  quotaSummary,
  pendingApprovalsCount,
  currentMode,
  delegations,
  audits,
  latestSimulationRun,
}: MissionConsolePanelProps) {
  const delegationRows = delegations.slice(0, 5);
  const auditRows = audits.slice(0, 5);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/95 text-zinc-100 p-4">
      <p className="text-[11px] uppercase tracking-wide text-zinc-400">Mission Console</p>
      <h3 className="mt-1 text-sm font-semibold">
        {runtimeTeam ? runtimeTeam.teamName : "No Team Assigned"}
      </h3>
      <p className="mt-1 text-[11px] text-zinc-400">
        Mode: {currentMode} • Pending approvals: {pendingApprovalsCount}
      </p>

      {runtimeTeam ? (
        <div className="mt-3 space-y-2 text-[11px]">
          <div className="rounded border border-zinc-800 p-2">
            <p className="text-zinc-300">Revision {runtimeTeam.version}</p>
            <p className="text-zinc-400">{runtimeTeam.teamGoal}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Members" value={String(runtimeTeam.members.length)} />
            <Metric label="Max Batch" value={String(runtimeTeam.runtimePolicy.maxBatchSize)} />
            <Metric label="Max Run Ops" value={String(runtimeTeam.runtimePolicy.maxRunOps)} />
            <Metric
              label="HITL"
              value={runtimeTeam.runtimePolicy.requiresHitl ? "required" : "optional"}
            />
          </div>
          <div className="rounded border border-zinc-800 p-2">
            <p className="text-zinc-400">Allowed tools</p>
            <p className="text-zinc-300 whitespace-pre-wrap">
              {runtimeTeam.toolAllowlist.join(", ") || "none"}
            </p>
          </div>
          {latestSimulationRun ? (
            <div className="rounded border border-zinc-800 p-2">
              <p className="text-zinc-400">Risk Strip</p>
              <p className="text-zinc-300">
                {latestSimulationRun.riskLevel.toUpperCase()} • confidence {latestSimulationRun.confidence.toFixed(2)} •
                impact {latestSimulationRun.impactScore.toFixed(2)}
              </p>
            </div>
          ) : null}
          <div className="rounded border border-zinc-800 p-2">
            <p className="text-zinc-400">Delegation Timeline</p>
            {delegationRows.length === 0 ? (
              <p className="text-zinc-500">No delegations recorded yet.</p>
            ) : (
              <div className="mt-1 space-y-1">
                {delegationRows.map((row) => (
                  <p key={row._id} className="text-zinc-300">
                    {row.agentName} • {row.status} • {row.task}
                  </p>
                ))}
              </div>
            )}
          </div>
          <div className="rounded border border-zinc-800 p-2">
            <p className="text-zinc-400">Tool Audits</p>
            {auditRows.length === 0 ? (
              <p className="text-zinc-500">No tool audits yet.</p>
            ) : (
              <div className="mt-1 space-y-1">
                {auditRows.map((row) => (
                  <p key={row._id} className="text-zinc-300">
                    {row.tool} • {row.result} • {row.member}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-zinc-400">
          Assign a team to enable team-based routing and policy enforcement.
        </p>
      )}

      {quotaSummary ? (
        <div className="mt-3 rounded border border-zinc-800 p-2 text-[11px] space-y-1">
          <p className="text-zinc-300">Quota Profile: {quotaSummary.quotaProfile.name}</p>
          <p className="text-zinc-400">
            Media {quotaSummary.usage.mediaBudgetUsed.toFixed(2)}/
            {quotaSummary.quotaProfile.dailyMediaBudget.toFixed(2)}
          </p>
          <p className="text-zinc-400">
            Mutations {quotaSummary.usage.mutationOpsUsed}/
            {quotaSummary.quotaProfile.dailyMutationOps}
          </p>
          <p className="text-zinc-400">
            Active runs {quotaSummary.usage.activeRuns}/{quotaSummary.quotaProfile.maxConcurrentRuns}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 p-2">
      <p className="text-zinc-500 text-[10px] uppercase tracking-wide">{label}</p>
      <p className="text-zinc-100 text-xs font-medium">{value}</p>
    </div>
  );
}
