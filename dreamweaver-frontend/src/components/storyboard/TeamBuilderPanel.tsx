"use client";

import { useMemo, useState } from "react";
import type {
  RuntimeResolvedTeam,
  TeamDefinition,
  TeamMemberConfig,
  TeamPolicy,
  TeamPromptDraft,
} from "@/app/storyboard/types";

type TeamRevisionRow = {
  revisionId: string;
  version: number;
  teamGoal: string;
  published: boolean;
  createdAt: number;
};

type TeamBuilderPanelProps = {
  teams: TeamDefinition[];
  runtimeTeam: RuntimeResolvedTeam | null;
  teamRevisions: TeamRevisionRow[];
  onSelectTeam: (teamId: string, revisionId?: string) => Promise<void>;
  onCreateTeam: (input: { name: string; description: string; teamGoal: string }) => Promise<void>;
  onCreateRevision: (input: {
    teamId: string;
    teamGoal: string;
    policy: TeamPolicy;
    members: TeamMemberConfig[];
    toolAllowlist: string[];
    resourceScopes: string[];
    publish: boolean;
  }) => Promise<void>;
  onGenerateDraft: (prompt: string) => Promise<TeamPromptDraft>;
  onApplyDraft: (teamId: string, draftId: string, publish: boolean) => Promise<void>;
  onPublishRevision: (teamId: string, revisionId: string) => Promise<void>;
  onRollbackRevision: (teamId: string, revisionId: string) => Promise<void>;
  onUpdateMember: (
    teamId: string,
    revisionId: string,
    member: TeamMemberConfig,
  ) => Promise<void>;
};

export function TeamBuilderPanel({
  teams,
  runtimeTeam,
  teamRevisions,
  onSelectTeam,
  onCreateTeam,
  onCreateRevision,
  onGenerateDraft,
  onApplyDraft,
  onPublishRevision,
  onRollbackRevision,
  onUpdateMember,
}: TeamBuilderPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamDescription, setNewTeamDescription] = useState("");
  const [newTeamGoal, setNewTeamGoal] = useState("");
  const [promptInput, setPromptInput] = useState("");
  const [draft, setDraft] = useState<TeamPromptDraft | null>(null);
  const [policyMaxBatch, setPolicyMaxBatch] = useState<number>(runtimeTeam?.runtimePolicy.maxBatchSize ?? 5);
  const [policyMaxRunOps, setPolicyMaxRunOps] = useState<number>(runtimeTeam?.runtimePolicy.maxRunOps ?? 24);
  const [policyQuotaId, setPolicyQuotaId] = useState<string>(runtimeTeam?.runtimePolicy.quotaProfileId ?? "default_standard");
  const [selectedMemberId, setSelectedMemberId] = useState<string>(runtimeTeam?.members[0]?.memberId ?? "");
  const [memberPersona, setMemberPersona] = useState<string>(runtimeTeam?.members[0]?.persona ?? "");
  const [memberToolScope, setMemberToolScope] = useState<string>(
    runtimeTeam?.members[0]?.toolScope.join(", ") ?? "",
  );

  const sortedTeams = useMemo(
    () => [...teams].sort((left, right) => right.updatedAt - left.updatedAt),
    [teams],
  );
  const sortedRevisions = useMemo(
    () => [...teamRevisions].sort((left, right) => right.version - left.version),
    [teamRevisions],
  );

  const selectedMember = runtimeTeam?.members.find((row) => row.memberId === selectedMemberId)
    ?? runtimeTeam?.members[0];

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setIsBusy(true);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Team action failed.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/95 text-zinc-100 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Team Builder</p>
          <h3 className="text-sm font-semibold">Agent Armies</h3>
        </div>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 text-xs"
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? "Hide" : "Open"}
        </button>
      </div>

      {!isOpen ? null : (
        <div className="mt-3 space-y-3">
          <div className="max-h-40 overflow-y-auto rounded border border-zinc-800 p-2 space-y-2">
            {sortedTeams.map((team) => (
              <div
                key={team._id}
                className={`rounded border p-2 ${
                  runtimeTeam?.teamId === team.teamId
                    ? "border-emerald-500/50 bg-emerald-500/10"
                    : "border-zinc-800 bg-zinc-900/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium">{team.name}</p>
                    <p className="text-[11px] text-zinc-400">{team.description}</p>
                  </div>
                  <button
                    type="button"
                    className="rounded bg-zinc-800 px-2 py-1 text-[11px]"
                    disabled={isBusy}
                    onClick={() =>
                      void run(async () => {
                        await onSelectTeam(team.teamId, team.publishedRevisionId);
                      })
                    }
                  >
                    {runtimeTeam?.teamId === team.teamId ? "Active" : "Activate"}
                  </button>
                </div>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-500">
                  revision {team.publishedVersion ?? "n/a"} {team.isPrebuilt ? "• prebuilt" : ""}
                </p>
              </div>
            ))}
          </div>

          <div className="rounded border border-zinc-800 p-2 space-y-2">
            <p className="text-xs font-medium">Revision Timeline</p>
            {sortedRevisions.length === 0 ? (
              <p className="text-[11px] text-zinc-500">No revisions for active team.</p>
            ) : (
              <div className="max-h-36 overflow-y-auto space-y-1">
                {sortedRevisions.map((revision) => (
                  <div key={revision.revisionId} className="rounded border border-zinc-800 p-2">
                    <p className="text-[11px] text-zinc-300">
                      v{revision.version} • {revision.revisionId}
                    </p>
                    <p className="text-[10px] text-zinc-500">{revision.teamGoal}</p>
                    <div className="mt-1 flex gap-2">
                      <button
                        type="button"
                        className="rounded bg-blue-700 px-2 py-1 text-[10px]"
                        disabled={isBusy || !runtimeTeam}
                        onClick={() =>
                          void run(async () => {
                            if (!runtimeTeam) {
                              return;
                            }
                            await onPublishRevision(runtimeTeam.teamId, revision.revisionId);
                          })
                        }
                      >
                        Publish
                      </button>
                      <button
                        type="button"
                        className="rounded bg-amber-700 px-2 py-1 text-[10px]"
                        disabled={isBusy || !runtimeTeam}
                        onClick={() =>
                          void run(async () => {
                            if (!runtimeTeam) {
                              return;
                            }
                            await onRollbackRevision(runtimeTeam.teamId, revision.revisionId);
                          })
                        }
                      >
                        Rollback To Here
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded border border-zinc-800 p-2 space-y-2">
            <p className="text-xs font-medium">Structured Revision Builder</p>
            <input
              value={policyQuotaId}
              onChange={(event) => setPolicyQuotaId(event.target.value)}
              className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs"
              placeholder="Quota profile id"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={String(policyMaxBatch)}
                onChange={(event) => setPolicyMaxBatch(Number(event.target.value) || 1)}
                className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs"
                placeholder="Max batch"
              />
              <input
                value={String(policyMaxRunOps)}
                onChange={(event) => setPolicyMaxRunOps(Number(event.target.value) || 1)}
                className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs"
                placeholder="Max run ops"
              />
            </div>
            <button
              type="button"
              className="rounded bg-violet-700 px-2 py-1 text-xs disabled:opacity-60"
              disabled={isBusy || !runtimeTeam}
              onClick={() =>
                void run(async () => {
                  if (!runtimeTeam) {
                    return;
                  }
                  await onCreateRevision({
                    teamId: runtimeTeam.teamId,
                    teamGoal: runtimeTeam.teamGoal,
                    members: runtimeTeam.members,
                    toolAllowlist: runtimeTeam.toolAllowlist,
                    resourceScopes: runtimeTeam.resourceScopes,
                    publish: false,
                    policy: {
                      requiresHitl: runtimeTeam.runtimePolicy.requiresHitl,
                      riskThresholds: runtimeTeam.runtimePolicy.riskThresholds,
                      maxBatchSize: Math.max(1, policyMaxBatch),
                      maxRunOps: Math.max(1, policyMaxRunOps),
                      maxConcurrentRuns: runtimeTeam.runtimePolicy.maxConcurrentRuns,
                      quotaEnforced: runtimeTeam.runtimePolicy.quotaEnforced,
                      quotaProfileId: policyQuotaId.trim() || "default_standard",
                    },
                  });
                })
              }
            >
              Create Structured Revision
            </button>
          </div>

          <div className="rounded border border-zinc-800 p-2 space-y-2">
            <p className="text-xs font-medium">Member Editor</p>
            <select
              value={selectedMember?.memberId ?? ""}
              onChange={(event) => {
                const nextId = event.target.value;
                setSelectedMemberId(nextId);
                const next = runtimeTeam?.members.find((row) => row.memberId === nextId);
                setMemberPersona(next?.persona ?? "");
                setMemberToolScope(next?.toolScope.join(", ") ?? "");
              }}
              className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs"
            >
              {(runtimeTeam?.members ?? []).map((member) => (
                <option key={member.memberId} value={member.memberId}>
                  {member.agentName}
                </option>
              ))}
            </select>
            <textarea
              value={memberPersona}
              onChange={(event) => setMemberPersona(event.target.value)}
              className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs h-14"
            />
            <input
              value={memberToolScope}
              onChange={(event) => setMemberToolScope(event.target.value)}
              className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs"
              placeholder="tool.scope.one, tool.scope.two"
            />
            <button
              type="button"
              className="rounded bg-violet-700/80 px-2 py-1 text-xs disabled:opacity-60"
              disabled={isBusy || !runtimeTeam || !selectedMember}
              onClick={() =>
                void run(async () => {
                  if (!runtimeTeam || !selectedMember) {
                    return;
                  }
                  await onUpdateMember(runtimeTeam.teamId, runtimeTeam.revisionId, {
                    ...selectedMember,
                    persona: memberPersona,
                    toolScope: memberToolScope
                      .split(",")
                      .map((item) => item.trim())
                      .filter((item) => item.length > 0),
                  });
                })
              }
            >
              Save Member
            </button>
          </div>

          <div className="rounded border border-zinc-800 p-2 space-y-2">
            <p className="text-xs font-medium">Create Team</p>
            <input
              value={newTeamName}
              onChange={(event) => setNewTeamName(event.target.value)}
              className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs"
              placeholder="Team name"
            />
            <textarea
              value={newTeamDescription}
              onChange={(event) => setNewTeamDescription(event.target.value)}
              className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs h-14"
              placeholder="Description"
            />
            <textarea
              value={newTeamGoal}
              onChange={(event) => setNewTeamGoal(event.target.value)}
              className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs h-14"
              placeholder="Team goal"
            />
            <button
              type="button"
              className="rounded bg-emerald-700 px-2 py-1 text-xs disabled:opacity-60"
              disabled={isBusy || newTeamName.trim().length === 0}
              onClick={() =>
                void run(async () => {
                  await onCreateTeam({
                    name: newTeamName,
                    description: newTeamDescription,
                    teamGoal: newTeamGoal,
                  });
                  setNewTeamName("");
                  setNewTeamDescription("");
                  setNewTeamGoal("");
                })
              }
            >
              Create
            </button>
          </div>

          <div className="rounded border border-zinc-800 p-2 space-y-2">
            <p className="text-xs font-medium">Prompt-to-Team Bootstrap</p>
            <textarea
              value={promptInput}
              onChange={(event) => setPromptInput(event.target.value)}
              className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs h-16"
              placeholder="Describe your ideal agent army..."
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded bg-zinc-800 px-2 py-1 text-xs disabled:opacity-60"
                disabled={isBusy || promptInput.trim().length < 8}
                onClick={() =>
                  void run(async () => {
                    const nextDraft = await onGenerateDraft(promptInput);
                    setDraft(nextDraft);
                  })
                }
              >
                Generate Draft
              </button>
              <button
                type="button"
                className="rounded bg-blue-700 px-2 py-1 text-xs disabled:opacity-60"
                disabled={isBusy || !draft || !runtimeTeam}
                onClick={() =>
                  void run(async () => {
                    if (!draft || !runtimeTeam) {
                      return;
                    }
                    await onApplyDraft(runtimeTeam.teamId, draft.draftId, true);
                    setDraft(null);
                  })
                }
              >
                Apply To Active Team
              </button>
            </div>
            {draft ? (
              <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2">
                <p className="text-[11px] text-zinc-300">Draft {draft.draftId}</p>
                <p className="text-[11px] text-zinc-400">{draft.generatedSpec.teamGoal}</p>
                <p className="mt-1 text-[10px] text-zinc-500">
                  Members: {draft.generatedSpec.members.length} | Max batch: {draft.generatedSpec.policy.maxBatchSize}
                </p>
              </div>
            ) : null}
          </div>

          {error ? <p className="text-[11px] text-rose-300">{error}</p> : null}
        </div>
      )}
    </section>
  );
}
