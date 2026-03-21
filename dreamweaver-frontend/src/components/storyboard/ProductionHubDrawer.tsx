"use client";

import React, { useMemo, useState } from "react";
import { Briefcase, CheckCircle2, ShieldAlert, Users, Film, Clapperboard, Activity } from "lucide-react";
import type {
  ApprovalTaskRecord,
  AgentDelegationRecord,
  AutonomousDailiesRecord,
  ConstraintBundle,
  NarrativeBranchRecord,
  NarrativeCommitRecord,
  QuotaUsageSummary,
  RuntimeResolvedTeam,
  SimulationCriticRunRecord,
  TeamDefinition,
  TeamMemberConfig,
  TeamPolicy,
  TeamPromptDraft,
  ToolCallAuditRecord,
} from "@/app/storyboard/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReviewInboxPanel } from "@/components/storyboard/ReviewInboxPanel";
import { TeamBuilderPanel } from "@/components/storyboard/TeamBuilderPanel";
import { DailiesBoardPanel } from "@/components/storyboard/DailiesBoardPanel";
import { TimelineTheaterPanel } from "@/components/storyboard/TimelineTheaterPanel";
import { ContinuityOSPanel } from "@/components/storyboard/ContinuityOSPanel";
import { MissionConsolePanel } from "@/components/storyboard/MissionConsolePanel";
import { cn } from "@/lib/utils";

type TabKey = "review" | "teams" | "dailies" | "playback" | "continuity" | "monitor";

const tabIcon: Record<TabKey, React.ComponentType<{ className?: string }>> = {
  review: CheckCircle2,
  teams: Users,
  dailies: Clapperboard,
  playback: Film,
  continuity: ShieldAlert,
  monitor: Activity,
};

export function ProductionHubDrawer(props: {
  pendingApprovalsCount: number;
  continuityViolationCount: number;
  delegations: AgentDelegationRecord[];
  runtimeTeam: RuntimeResolvedTeam | null;
  quotaSummary: QuotaUsageSummary | null;
  audits: ToolCallAuditRecord[];
  latestSimulationRun: SimulationCriticRunRecord | null;

  approvals: ApprovalTaskRecord[];
  teams: TeamDefinition[];
  teamRevisions: Array<{ revisionId: string; version: number; teamGoal: string; published: boolean; createdAt: number }>;
  dailies: AutonomousDailiesRecord[];
  simulationRuns: SimulationCriticRunRecord[];
  branches: NarrativeBranchRecord[];
  commits: NarrativeCommitRecord[];
  continuityBundle: ConstraintBundle | null;

  currentMode: "graph_studio" | "agent_draft";

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
  onUpdateMember: (teamId: string, revisionId: string, member: TeamMemberConfig) => Promise<void>;

  onGenerateDailies: () => Promise<void>;
  onUpdateDailiesStatus: (reelId: string, status: "approved" | "rejected" | "applied") => Promise<void>;

  onRunCritic: () => Promise<void>;
  onCreateBranch: () => Promise<void>;
  onCherryPickLatest: () => Promise<void>;
  onComputeLatestDiff: () => Promise<void>;

  onDetectContradictions: () => Promise<void>;
}) {
  const {
    pendingApprovalsCount,
    continuityViolationCount,
    delegations,
    runtimeTeam,
    quotaSummary,
    audits,
    latestSimulationRun,
    approvals,
    teams,
    teamRevisions,
    dailies,
    simulationRuns,
    branches,
    commits,
    continuityBundle,
    currentMode,
  } = props;

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("review");

  const isRunning = useMemo(
    () => delegations.some((row) => row.status === "queued" || row.status === "running"),
    [delegations],
  );

  const hubBadge = pendingApprovalsCount > 0 ? pendingApprovalsCount : continuityViolationCount > 0 ? "!" : null;

  const tabBadges: Partial<Record<TabKey, string | number>> = useMemo(() => ({
    review: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
    continuity: continuityViolationCount > 0 ? continuityViolationCount : undefined,
    monitor: isRunning ? "RUN" : undefined,
  }), [continuityViolationCount, isRunning, pendingApprovalsCount]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="secondary"
          className={cn(
            "glass gap-2 rounded-xl border border-white/10 text-foreground hover:bg-white/10",
            "shadow-[0_10px_40px_rgba(0,0,0,0.35)]",
          )}
        >
          <Briefcase className="size-4" />
          Production
          {hubBadge !== null ? (
            <Badge className="ml-1 bg-primary text-primary-foreground">
              {hubBadge}
            </Badge>
          ) : null}
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] p-0">
        <SheetHeader className="border-b border-border/60">
          <SheetTitle className="flex items-center gap-2">
            <Briefcase className="size-4 text-muted-foreground" />
            Production Hub
          </SheetTitle>
          <SheetDescription>
            Review, teams, dailies, playback, continuity, and monitor.
          </SheetDescription>
        </SheetHeader>

        {/* Mount heavy panels only when the drawer is open. */}
        {open ? (
          <div className="p-4 pt-3">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="review">
                  <TabLabel tab="review" badge={tabBadges.review} />
                </TabsTrigger>
                <TabsTrigger value="teams">
                  <TabLabel tab="teams" />
                </TabsTrigger>
                <TabsTrigger value="dailies">
                  <TabLabel tab="dailies" />
                </TabsTrigger>
              </TabsList>
              <TabsList className="mt-2 grid w-full grid-cols-3">
                <TabsTrigger value="playback">
                  <TabLabel tab="playback" />
                </TabsTrigger>
                <TabsTrigger value="continuity">
                  <TabLabel tab="continuity" badge={tabBadges.continuity} />
                </TabsTrigger>
                <TabsTrigger value="monitor">
                  <TabLabel tab="monitor" badge={tabBadges.monitor} />
                </TabsTrigger>
              </TabsList>

              <div className="mt-4">
                <TabsContent value="review">
                  <ReviewInboxPanel approvals={approvals} />
                </TabsContent>
                <TabsContent value="teams">
                  <TeamBuilderPanel
                    teams={teams}
                    runtimeTeam={runtimeTeam}
                    teamRevisions={teamRevisions}
                    onSelectTeam={props.onSelectTeam}
                    onCreateTeam={props.onCreateTeam}
                    onCreateRevision={props.onCreateRevision}
                    onGenerateDraft={props.onGenerateDraft}
                    onApplyDraft={props.onApplyDraft}
                    onPublishRevision={props.onPublishRevision}
                    onRollbackRevision={props.onRollbackRevision}
                    onUpdateMember={props.onUpdateMember}
                  />
                </TabsContent>
                <TabsContent value="dailies">
                  <DailiesBoardPanel
                    dailies={dailies}
                    onGenerateDailies={props.onGenerateDailies}
                    onUpdateStatus={props.onUpdateDailiesStatus}
                  />
                </TabsContent>
                <TabsContent value="playback">
                  <TimelineTheaterPanel
                    simulationRuns={simulationRuns}
                    onRunCritic={props.onRunCritic}
                    branches={branches}
                    commits={commits}
                    onCreateBranch={props.onCreateBranch}
                    onCherryPickLatest={props.onCherryPickLatest}
                    onComputeLatestDiff={props.onComputeLatestDiff}
                  />
                </TabsContent>
                <TabsContent value="continuity">
                  <ContinuityOSPanel
                    bundle={continuityBundle}
                    onDetectContradictions={props.onDetectContradictions}
                  />
                </TabsContent>
                <TabsContent value="monitor">
                  <MissionConsolePanel
                    runtimeTeam={runtimeTeam}
                    quotaSummary={quotaSummary}
                    pendingApprovalsCount={pendingApprovalsCount}
                    currentMode={currentMode}
                    delegations={delegations}
                    audits={audits}
                    latestSimulationRun={latestSimulationRun}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function TabLabel({ tab, badge }: { tab: TabKey; badge?: string | number }) {
  const Icon = tabIcon[tab];
  const label =
    tab === "review"
      ? "Review"
      : tab === "teams"
        ? "Teams"
        : tab === "dailies"
          ? "Dailies"
          : tab === "playback"
            ? "Playback"
            : tab === "continuity"
              ? "Continuity"
              : "Monitor";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-4" />
      <span className="hidden sm:inline">{label}</span>
      {badge !== undefined ? (
        <Badge variant="secondary" className="ml-1 text-[10px]">
          {badge}
        </Badge>
      ) : null}
    </span>
  );
}
