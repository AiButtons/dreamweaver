"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCoAgent, useCopilotAction, useCopilotReadable, useHumanInTheLoop } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { useMutation } from "convex/react";
import {
  RuntimeResolvedTeam,
  StoryEdge,
  StoryNode,
  TeamMemberConfig,
  TeamPromptDraft,
} from "@/app/storyboard/types";
import { mutationRef } from "@/lib/convexRefs";
import {
  executeApprovedGraphPatch,
  executeApprovedMediaPrompt,
  executeApprovedExecutionPlan,
  executeRejectedGraphPatch,
  executeRejectedMediaPrompt,
  executeRejectedExecutionPlan,
  type AdapterDependencies,
  type ExecutionPlanInput,
  type GraphPatchInput,
  type MediaPromptInput,
} from "@/app/storyboard/agentExecutionAdapter";

type ApprovalSummary = {
  _id: string;
  taskType: string;
  status: string;
  title: string;
};

type AgentGraphNode = {
  id: string;
  nodeType: string;
  label: string;
  segment: string;
  continuityStatus: "ok" | "warning" | "blocked";
};

type AgentGraphEdge = {
  id: string;
  source: string;
  target: string;
};

type RollingContextMap = Record<
  string,
  {
    rollingSummary: string;
    lineageHash: string;
    tokenBudgetUsed: number;
    eventIds: string[];
  }
>;

type StoryboardAgentState = {
  storyboardId: string;
  mode: "graph_studio" | "agent_draft";
  graphSnapshot: {
    nodes: AgentGraphNode[];
    edges: AgentGraphEdge[];
  };
  rollingContextMap: RollingContextMap;
  pendingApprovals: ApprovalSummary[];
  providerPolicy: {
    requiresHitl: boolean;
    imageExecutor: string;
    videoExecutor: string;
  };
  activeTeam: {
    teamId: string;
    teamName: string;
    revisionId: string;
    version: number;
  } | null;
  activeTeamRevision: string | null;
  teamGoal: string | null;
  teamPolicy: RuntimeResolvedTeam["runtimePolicy"] | null;
  effectiveToolScope: string[];
  effectiveResourceScope: string[];
  delegationView: {
    pendingApprovals: number;
    requiresHitl: boolean;
  };
  team_config: RuntimeResolvedTeam | null;
  runtime_policy: RuntimeResolvedTeam["runtimePolicy"] | null;
  effective_tool_scope: string[];
  effective_resource_scope: string[];
};

type DryRunRiskLevel = "low" | "medium" | "high" | "critical";

const EMPTY_APPROVALS: ApprovalSummary[] = [];
const PROVIDER_POLICY = {
  requiresHitl: true,
  imageExecutor: "fastapi:/api/image/generate",
  videoExecutor: "fastapi:/api/video/generate",
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseRiskLevel = (value: unknown): DryRunRiskLevel => {
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
    return value;
  }
  return "medium";
};

const parseGraphPatchInput = (value: unknown): GraphPatchInput | null => {
  if (!isRecord(value)) {
    return null;
  }
  const patchId = typeof value.patchId === "string" ? value.patchId : "";
  const title = typeof value.title === "string" ? value.title : "";
  const rationale = typeof value.rationale === "string" ? value.rationale : "";
  const diffSummary = typeof value.diffSummary === "string" ? value.diffSummary : "";
  const operations = Array.isArray(value.operations) ? value.operations : [];
  if (!patchId || !title || !rationale || !diffSummary || operations.length === 0) {
    return null;
  }
  return {
    patchId,
    title,
    rationale,
    diffSummary,
    operations,
  };
};

const parseMediaPromptInput = (value: unknown): MediaPromptInput | null => {
  if (!isRecord(value)) {
    return null;
  }
  const nodeId = typeof value.nodeId === "string" ? value.nodeId : "";
  const mediaType = value.mediaType === "video" ? "video" : value.mediaType === "image" ? "image" : null;
  const prompt = typeof value.prompt === "string" ? value.prompt : "";
  const contextSummary = typeof value.contextSummary === "string" ? value.contextSummary : "";
  const negativePrompt = typeof value.negativePrompt === "string" ? value.negativePrompt : undefined;
  if (!nodeId || !mediaType || !prompt || !contextSummary) {
    return null;
  }
  return {
    nodeId,
    mediaType,
    prompt,
    negativePrompt,
    contextSummary,
  };
};

const parseExecutionPlanInput = (value: unknown): ExecutionPlanInput | null => {
  if (!isRecord(value)) {
    return null;
  }
  const planId = typeof value.planId === "string" ? value.planId : "";
  const storyboardId = typeof value.storyboardId === "string" ? value.storyboardId : "";
  const branchId = typeof value.branchId === "string" ? value.branchId : "main";
  const title = typeof value.title === "string" ? value.title : "";
  const rationale = typeof value.rationale === "string" ? value.rationale : "";
  const source = value.source === "dailies"
    || value.source === "simulation_critic"
    || value.source === "repair"
    || value.source === "agent"
    ? value.source
    : undefined;
  const sourceId = typeof value.sourceId === "string" ? value.sourceId : undefined;
  const taskType = value.taskType === "execution_plan"
    || value.taskType === "batch_ops"
    || value.taskType === "dailies_batch"
    || value.taskType === "simulation_critic_batch"
    || value.taskType === "repair_plan"
    ? value.taskType
    : undefined;
  const operations = Array.isArray(value.operations) ? value.operations : [];
  const dryRun = isRecord(value.dryRun)
      ? {
        valid: Boolean(value.dryRun.valid),
        riskLevel: parseRiskLevel(value.dryRun.riskLevel),
        summary: typeof value.dryRun.summary === "string" ? value.dryRun.summary : "",
        issues: Array.isArray(value.dryRun.issues) ? value.dryRun.issues : [],
        estimatedTotalCost:
          typeof value.dryRun.estimatedTotalCost === "number" ? value.dryRun.estimatedTotalCost : 0,
        estimatedDurationSec:
          typeof value.dryRun.estimatedDurationSec === "number" ? value.dryRun.estimatedDurationSec : 0,
        planHash: typeof value.dryRun.planHash === "string" ? value.dryRun.planHash : "",
      }
    : undefined;

  if (!planId || !storyboardId || !title || !rationale || operations.length === 0) {
    return null;
  }
  return {
    planId,
    storyboardId,
    branchId,
    title,
    rationale,
    operations,
    source,
    sourceId,
    taskType,
    dryRun,
  };
};

const parseBatchOpsInput = (value: unknown): {
  planId: string;
  storyboardId?: string;
  branchId?: string;
  title?: string;
  rationale?: string;
  source?: "agent" | "dailies" | "simulation_critic" | "repair";
  sourceId?: string;
  taskType?: "execution_plan" | "batch_ops" | "dailies_batch" | "simulation_critic_batch" | "repair_plan";
  operations: unknown[];
  dryRun?: ExecutionPlanInput["dryRun"];
} | null => {
  if (!isRecord(value)) {
    return null;
  }
  const planId = typeof value.planId === "string" ? value.planId : "";
  const storyboardId = typeof value.storyboardId === "string" ? value.storyboardId : undefined;
  const branchId = typeof value.branchId === "string" ? value.branchId : undefined;
  const title = typeof value.title === "string" ? value.title : undefined;
  const rationale = typeof value.rationale === "string" ? value.rationale : undefined;
  const source = value.source === "dailies"
    || value.source === "simulation_critic"
    || value.source === "repair"
    || value.source === "agent"
    ? value.source
    : undefined;
  const sourceId = typeof value.sourceId === "string" ? value.sourceId : undefined;
  const taskType = value.taskType === "execution_plan"
    || value.taskType === "batch_ops"
    || value.taskType === "dailies_batch"
    || value.taskType === "simulation_critic_batch"
    || value.taskType === "repair_plan"
    ? value.taskType
    : undefined;
  const operations = Array.isArray(value.operations) ? value.operations : [];
  const dryRun = isRecord(value.dryRun)
    ? {
        valid: Boolean(value.dryRun.valid),
        riskLevel: parseRiskLevel(value.dryRun.riskLevel),
        summary: typeof value.dryRun.summary === "string" ? value.dryRun.summary : "",
        issues: Array.isArray(value.dryRun.issues) ? value.dryRun.issues : [],
        estimatedTotalCost:
          typeof value.dryRun.estimatedTotalCost === "number" ? value.dryRun.estimatedTotalCost : 0,
        estimatedDurationSec:
          typeof value.dryRun.estimatedDurationSec === "number" ? value.dryRun.estimatedDurationSec : 0,
        planHash: typeof value.dryRun.planHash === "string" ? value.dryRun.planHash : "",
      }
    : undefined;
  if (!planId || operations.length === 0) {
    return null;
  }
  return {
    planId,
    storyboardId,
    branchId,
    title,
    rationale,
    source,
    sourceId,
    taskType,
    operations,
    dryRun,
  };
};

const parseSimulationCriticPreviewInput = (value: unknown): {
  simulationRunId: string;
  storyboardId: string;
  branchId: string;
  summary: string;
  riskLevel: DryRunRiskLevel;
  issues: Array<{
    code: string;
    severity: DryRunRiskLevel;
    message: string;
    suggestedFix?: string;
  }>;
  confidence: number;
  impactScore: number;
  executionPlan: {
    planId: string;
    storyboardId: string;
    branchId: string;
    title: string;
    rationale: string;
    source: "simulation_critic";
    sourceId: string;
    taskType: "simulation_critic_batch";
    operations: unknown[];
    dryRun?: ExecutionPlanInput["dryRun"];
  };
} | null => {
  if (!isRecord(value)) {
    return null;
  }
  const simulationRunId = typeof value.simulationRunId === "string" ? value.simulationRunId : "";
  const storyboardId = typeof value.storyboardId === "string" ? value.storyboardId : "";
  const branchId = typeof value.branchId === "string" ? value.branchId : "main";
  const summary = typeof value.summary === "string" ? value.summary : "";
  const riskLevel = parseRiskLevel(value.riskLevel);
  const confidence = typeof value.confidence === "number" ? value.confidence : 0;
  const impactScore = typeof value.impactScore === "number" ? value.impactScore : 0;
  const issues = Array.isArray(value.issues)
    ? value.issues
      .filter(isRecord)
      .map((issue, index) => ({
        code: typeof issue.code === "string" ? issue.code : `ISSUE_${index + 1}`,
        severity: parseRiskLevel(issue.severity),
        message: typeof issue.message === "string" ? issue.message : "Issue summary unavailable.",
        suggestedFix: typeof issue.suggestedFix === "string" ? issue.suggestedFix : undefined,
      }))
    : [];
  if (!isRecord(value.executionPlan)) {
    return null;
  }
  const executionBatch = parseBatchOpsInput(value.executionPlan);
  if (!executionBatch || !simulationRunId || !storyboardId) {
    return null;
  }
  return {
    simulationRunId,
    storyboardId,
    branchId,
    summary,
    riskLevel,
    issues,
    confidence,
    impactScore,
    executionPlan: {
      planId: executionBatch.planId,
      storyboardId: executionBatch.storyboardId ?? storyboardId,
      branchId: executionBatch.branchId ?? branchId,
      title: executionBatch.title ?? "Simulation Critic Repair Batch",
      rationale: executionBatch.rationale ?? summary,
      source: "simulation_critic",
      sourceId: simulationRunId,
      taskType: "simulation_critic_batch",
      operations: executionBatch.operations,
      dryRun: executionBatch.dryRun,
    },
  };
};

const parseRepairPlanInput = (value: unknown): {
  repairPlanId: string;
  operations: unknown[];
  confidence: number;
} | null => {
  if (!isRecord(value)) {
    return null;
  }
  const repairPlanId = typeof value.repairPlanId === "string" ? value.repairPlanId : "";
  const operations = Array.isArray(value.operations) ? value.operations : [];
  const confidence = typeof value.confidence === "number" ? value.confidence : 0;
  if (!repairPlanId || operations.length === 0) {
    return null;
  }
  return { repairPlanId, operations, confidence };
};

const parseMergePolicyInput = (value: unknown): {
  branchId: string;
  sourceBranchId: string;
  targetBranchId: string;
  policy: string;
  semanticDiff?: Record<string, unknown>;
} | null => {
  if (!isRecord(value)) {
    return null;
  }
  const branchId = typeof value.branchId === "string" ? value.branchId : "";
  const sourceBranchId = typeof value.sourceBranchId === "string" ? value.sourceBranchId : "";
  const targetBranchId = typeof value.targetBranchId === "string" ? value.targetBranchId : "";
  const policy = typeof value.policy === "string" ? value.policy : "";
  const semanticDiff = isRecord(value.semanticDiff) ? value.semanticDiff : undefined;
  if (!branchId || !sourceBranchId || !targetBranchId || !policy) {
    return null;
  }
  return { branchId, sourceBranchId, targetBranchId, policy, semanticDiff };
};

const parseSelectTeamInput = (value: unknown): { teamId: string; revisionId?: string } | null => {
  if (!isRecord(value)) {
    return null;
  }
  const teamId = typeof value.teamId === "string" ? value.teamId : "";
  const revisionId = typeof value.revisionId === "string" ? value.revisionId : undefined;
  if (!teamId) {
    return null;
  }
  return { teamId, revisionId };
};

const parseCreateTeamInput = (value: unknown): {
  name: string;
  description: string;
  teamGoal: string;
} | null => {
  if (!isRecord(value)) {
    return null;
  }
  const name = typeof value.name === "string" ? value.name : "";
  const description = typeof value.description === "string"
    ? value.description
    : "Custom producer team";
  const teamGoal = typeof value.teamGoal === "string"
    ? value.teamGoal
    : "Deliver safe storyboard proposals with strict HITL.";
  if (!name) {
    return null;
  }
  return { name, description, teamGoal };
};

const parseUpdateTeamMemberInput = (value: unknown): {
  teamId: string;
  revisionId: string;
  member: TeamMemberConfig;
} | null => {
  if (!isRecord(value)) {
    return null;
  }
  const teamId = typeof value.teamId === "string" ? value.teamId : "";
  const revisionId = typeof value.revisionId === "string" ? value.revisionId : "";
  if (!teamId || !revisionId || !isRecord(value.member)) {
    return null;
  }
  const member = value.member;
  const agentName = typeof member.agentName === "string" ? member.agentName : "";
  const role = typeof member.role === "string" ? member.role : "";
  const persona = typeof member.persona === "string" ? member.persona : "";
  const nicheDescription = typeof member.nicheDescription === "string" ? member.nicheDescription : "";
  if (!agentName || !role || !persona || !nicheDescription) {
    return null;
  }
  return {
    teamId,
    revisionId,
    member: {
      memberId: typeof member.memberId === "string" ? member.memberId : agentName,
      agentName,
      role,
      persona,
      nicheDescription,
      toolScope: Array.isArray(member.toolScope)
        ? member.toolScope.filter((item): item is string => typeof item === "string")
        : [],
      resourceScope: Array.isArray(member.resourceScope)
        ? member.resourceScope.filter((item): item is string => typeof item === "string")
        : [],
      weight: typeof member.weight === "number" ? member.weight : 1,
      enabled: typeof member.enabled === "boolean" ? member.enabled : true,
    },
  };
};

const parsePublishRevisionInput = (value: unknown): { teamId: string; revisionId: string } | null => {
  if (!isRecord(value)) {
    return null;
  }
  const teamId = typeof value.teamId === "string" ? value.teamId : "";
  const revisionId = typeof value.revisionId === "string" ? value.revisionId : "";
  if (!teamId || !revisionId) {
    return null;
  }
  return { teamId, revisionId };
};

const parseGenerateTeamFromPromptInput = (value: unknown): {
  inputPrompt: string;
  teamId?: string;
  publish?: boolean;
} | null => {
  if (!isRecord(value)) {
    return null;
  }
  const inputPrompt = typeof value.inputPrompt === "string" ? value.inputPrompt : "";
  const teamId = typeof value.teamId === "string" ? value.teamId : undefined;
  const publish = typeof value.publish === "boolean" ? value.publish : undefined;
  if (!inputPrompt || inputPrompt.trim().length < 8) {
    return null;
  }
  return { inputPrompt, teamId, publish };
};

const toAgentNodes = (nodes: StoryNode[]): AgentGraphNode[] =>
  nodes.map((node) => ({
    id: node.id,
    nodeType: node.data.nodeType,
    label: node.data.label,
    segment: node.data.segment,
    continuityStatus: node.data.continuity.consistencyStatus,
  }));

const toAgentEdges = (edges: StoryEdge[]): AgentGraphEdge[] =>
  edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
  }));

const toRollingContextMap = (nodes: StoryNode[]): RollingContextMap =>
  Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        rollingSummary: node.data.historyContext.rollingSummary,
        lineageHash: node.data.historyContext.lineageHash,
        tokenBudgetUsed: node.data.historyContext.tokenBudgetUsed,
        eventIds: node.data.historyContext.eventIds,
      },
    ]),
  );

export function StoryboardCopilotBridge({
  storyboardId,
  nodes,
  edges,
  approvals,
  mode,
  runtimeResolvedTeam,
}: {
  storyboardId: string | null;
  nodes: StoryNode[];
  edges: StoryEdge[];
  approvals: ApprovalSummary[];
  mode: "graph_studio" | "agent_draft";
  runtimeResolvedTeam: RuntimeResolvedTeam | null;
}) {
  const safeStoryboardId = storyboardId ?? "";
  const approvalsStable = approvals.length === 0 ? EMPTY_APPROVALS : approvals;
  const graphSnapshot = useMemo(
    () => ({
      nodes: toAgentNodes(nodes),
      edges: toAgentEdges(edges),
    }),
    [edges, nodes],
  );
  const rollingContextMap = useMemo(() => toRollingContextMap(nodes), [nodes]);
  const activeTeamSnapshot = useMemo(
    () =>
      runtimeResolvedTeam
        ? {
            teamId: runtimeResolvedTeam.teamId,
            teamName: runtimeResolvedTeam.teamName,
            revisionId: runtimeResolvedTeam.revisionId,
            version: runtimeResolvedTeam.version,
          }
        : null,
    [runtimeResolvedTeam],
  );

  const agentState = useMemo<StoryboardAgentState>(
    () => ({
      storyboardId: safeStoryboardId,
      mode,
      graphSnapshot,
      rollingContextMap,
      pendingApprovals: approvalsStable,
      providerPolicy: PROVIDER_POLICY,
      activeTeam: activeTeamSnapshot,
      activeTeamRevision: runtimeResolvedTeam?.revisionId ?? null,
      teamGoal: runtimeResolvedTeam?.teamGoal ?? null,
      teamPolicy: runtimeResolvedTeam?.runtimePolicy ?? null,
      effectiveToolScope: runtimeResolvedTeam?.toolAllowlist ?? [],
      effectiveResourceScope: runtimeResolvedTeam?.resourceScopes ?? [],
      delegationView: {
        pendingApprovals: approvalsStable.length,
        requiresHitl: runtimeResolvedTeam?.runtimePolicy.requiresHitl ?? true,
      },
      team_config: runtimeResolvedTeam,
      runtime_policy: runtimeResolvedTeam?.runtimePolicy ?? null,
      effective_tool_scope: runtimeResolvedTeam?.toolAllowlist ?? [],
      effective_resource_scope: runtimeResolvedTeam?.resourceScopes ?? [],
    }),
    [
      activeTeamSnapshot,
      approvalsStable,
      graphSnapshot,
      mode,
      rollingContextMap,
      runtimeResolvedTeam,
      safeStoryboardId,
    ],
  );

  const { setState } = useCoAgent<StoryboardAgentState>({
    name: "storyboard_agent",
    initialState: agentState,
  });

  const lastPushedKeyRef = useRef<string>("");
  useEffect(() => {
    if (!agentState.storyboardId) {
      return;
    }

    // Guard against unstable references causing infinite "setState -> rerender -> setState" loops.
    // We only push when the meaningful snapshot changes.
    const key = JSON.stringify({
      storyboardId: agentState.storyboardId,
      mode: agentState.mode,
      graph: agentState.graphSnapshot,
      rolling: agentState.rollingContextMap,
      approvals: agentState.pendingApprovals,
      team: agentState.activeTeam,
      teamRevision: agentState.activeTeamRevision,
    });
    if (key === lastPushedKeyRef.current) {
      return;
    }
    lastPushedKeyRef.current = key;
    setState(agentState);
  }, [agentState, setState]);

  useCopilotReadable({
    description: "Current storyboard graph snapshot",
    value: graphSnapshot,
  });

  useCopilotReadable({
    description: "Path-aware rolling context per node",
    value: rollingContextMap,
  });

  useCopilotReadable({
    description: "Pending approvals requiring producer review",
    value: approvals,
  });

  useCopilotReadable({
    description: "Active agent team runtime configuration and policy",
    value: runtimeResolvedTeam,
  });

  const createApprovalTask = useMutation(mutationRef("approvals:createTask"));
  const resolveApprovalTask = useMutation(mutationRef("approvals:resolveTask"));
  const applyGraphPatch = useMutation(mutationRef("storyboards:applyGraphPatch"));
  const recordStoryEvent = useMutation(mutationRef("storyboards:recordStoryEvent"));
  const refreshNodeHistoryContexts = useMutation(
    mutationRef("storyboards:refreshNodeHistoryContexts"),
  );
  const createMediaAsset = useMutation(mutationRef("mediaAssets:createMediaAsset"));
  const compileNodePromptPack = useMutation(mutationRef("storyboards:compileNodePromptPack"));
  const simulateExecutionPlan = useMutation(mutationRef("narrativeGit:simulateExecutionPlan"));
  const commitPlanOps = useMutation(mutationRef("narrativeGit:commitPlanOps"));
  const rollbackToCommit = useMutation(mutationRef("narrativeGit:rollbackToCommit"));
  const applyMergePolicyMutation = useMutation(mutationRef("narrativeGit:applyMergePolicy"));
  const generateAutonomousDailies = useMutation(mutationRef("dailies:generateAutonomousDailies"));
  const updateDailiesStatus = useMutation(mutationRef("dailies:updateDailiesStatus"));
  const runSimulationCritic = useMutation(mutationRef("dailies:runSimulationCritic"));
  const updateSimulationRunStatus = useMutation(mutationRef("dailies:updateSimulationRunStatus"));
  const startAgentRun = useMutation(mutationRef("agentRuns:startRun"));
  const finishAgentRun = useMutation(mutationRef("agentRuns:finishRun"));
  const checkAndReserveRunBudget = useMutation(mutationRef("quotas:checkAndReserveRunBudget"));
  const releaseRunBudget = useMutation(mutationRef("quotas:releaseRunBudget"));
  const selectTeamMutation = useMutation(mutationRef("agentTeams:assignTeamToStoryboard"));
  const createTeamMutation = useMutation(mutationRef("agentTeams:createTeam"));
  const updateTeamMemberMutation = useMutation(mutationRef("agentTeams:updateRevisionMember"));
  const publishRevisionMutation = useMutation(mutationRef("agentTeams:publishRevision"));
  const generateTeamFromPromptMutation = useMutation(
    mutationRef("agentTeams:generateTeamFromPrompt"),
  );
  const applyPromptDraftMutation = useMutation(mutationRef("agentTeams:applyPromptDraftToRevision"));
  const recordToolCallAudit = useMutation(mutationRef("toolAudits:recordToolCallAudit"));

  const adapterDependencies = useMemo<AdapterDependencies>(
    () => ({
      storyboardId: safeStoryboardId,
      nodes,
      edges,
      createApprovalTask,
      resolveApprovalTask,
      applyGraphPatch,
      recordStoryEvent,
      refreshNodeHistoryContexts,
      createMediaAsset,
      compileNodePromptPack,
      simulateExecutionPlan,
      commitPlanOps,
      rollbackToCommit,
      generateAutonomousDailies,
      updateDailiesStatus,
      runSimulationCritic,
      updateSimulationRunStatus,
      startAgentRun,
      finishAgentRun,
      runtimeResolvedTeam,
      checkAndReserveRunBudget,
      releaseRunBudget,
    }),
    [
      applyGraphPatch,
      createApprovalTask,
      createMediaAsset,
      compileNodePromptPack,
      simulateExecutionPlan,
      commitPlanOps,
      rollbackToCommit,
      generateAutonomousDailies,
      updateDailiesStatus,
      runSimulationCritic,
      checkAndReserveRunBudget,
      updateSimulationRunStatus,
      edges,
      finishAgentRun,
      nodes,
      recordStoryEvent,
      refreshNodeHistoryContexts,
      resolveApprovalTask,
      releaseRunBudget,
      runtimeResolvedTeam,
      safeStoryboardId,
      startAgentRun,
    ],
  );

  const auditToolCall = async (input: {
    tool: string;
    result: "success" | "failure" | "blocked";
    details?: Record<string, unknown>;
    member?: string;
    runId?: string;
  }) => {
    if (!safeStoryboardId) {
      return;
    }
    await recordToolCallAudit({
      storyboardId: safeStoryboardId,
      runId: input.runId,
      teamId: runtimeResolvedTeam?.teamId,
      revisionId: runtimeResolvedTeam?.revisionId,
      member: input.member ?? "supervisor",
      tool: input.tool,
      scope: runtimeResolvedTeam?.resourceScopes ?? [],
      result: input.result,
      detailsJson: input.details ? JSON.stringify(input.details) : undefined,
    });
  };

  useHumanInTheLoop({
    name: "approve_graph_patch",
    description:
      "Approve, edit, or reject a graph mutation patch. Call before mutating storyboard nodes/edges.",
    parameters: [
      { name: "patchId", type: "string", description: "Patch id", required: true },
      { name: "title", type: "string", description: "Patch title", required: true },
      { name: "rationale", type: "string", description: "Rationale", required: true },
      { name: "diffSummary", type: "string", description: "Diff summary", required: true },
      { name: "operations", type: "object[]", description: "Patch operations", required: true },
    ],
    render: ({ args, status, respond }) => {
      if (status !== "executing" || !respond) {
        return <></>;
      }
      const input = parseGraphPatchInput(args);
      if (!input) {
        return (
          <ToolStatusCard
            name="approve_graph_patch"
            status="failed"
            args={JSON.stringify(args ?? {}, null, 2)}
            result={JSON.stringify({ error: "Invalid graph patch payload" })}
          />
        );
      }
      return (
        <ApprovalCard
          title={input.title}
          subtitle={input.rationale}
          body={input.diffSummary}
          onApprove={async () => {
            const execution = await executeApprovedGraphPatch(adapterDependencies, input);
            await auditToolCall({
              tool: "approve_graph_patch",
              result: "success",
              details: { patchId: input.patchId, operationCount: input.operations.length },
            });
            respond({ approved: true, execution });
          }}
          onEdit={async () => {
            const execution = await executeApprovedGraphPatch(
              adapterDependencies,
              input,
              input.operations,
            );
            await auditToolCall({
              tool: "approve_graph_patch",
              result: "success",
              details: { patchId: input.patchId, operationCount: input.operations.length, edited: true },
            });
            respond({ approved: true, editedOperations: input.operations, execution });
          }}
          onReject={async () => {
            const rejection = await executeRejectedGraphPatch(adapterDependencies, input);
            await auditToolCall({
              tool: "approve_graph_patch",
              result: "blocked",
              details: { patchId: input.patchId },
            });
            respond({ approved: false, rejection });
          }}
        />
      );
    },
  });

  useHumanInTheLoop({
    name: "approve_media_prompt",
    description:
      "Approve, edit, or reject an image/video prompt before media execution.",
    parameters: [
      { name: "nodeId", type: "string", description: "Target node id", required: true },
      { name: "mediaType", type: "string", description: "image or video", required: true },
      { name: "prompt", type: "string", description: "Prompt text", required: true },
      { name: "negativePrompt", type: "string", description: "Negative prompt", required: false },
      { name: "contextSummary", type: "string", description: "Rolling context summary", required: true },
    ],
    render: ({ args, status, respond }) => {
      if (status !== "executing" || !respond) {
        return <></>;
      }
      const input = parseMediaPromptInput(args);
      if (!input) {
        return (
          <ToolStatusCard
            name="approve_media_prompt"
            status="failed"
            args={JSON.stringify(args ?? {}, null, 2)}
            result={JSON.stringify({ error: "Invalid media prompt payload" })}
          />
        );
      }
      return (
        <PromptApprovalCard
          nodeId={input.nodeId}
          mediaType={input.mediaType}
          prompt={input.prompt}
          negativePrompt={input.negativePrompt}
          contextSummary={input.contextSummary}
          onApprove={async (payload) => {
            const execution = await executeApprovedMediaPrompt(adapterDependencies, input, payload);
            await auditToolCall({
              tool: "approve_media_prompt",
              result: "success",
              details: { nodeId: input.nodeId, mediaType: input.mediaType },
            });
            respond({ approved: true, ...payload, execution });
          }}
          onReject={async () => {
            const rejection = await executeRejectedMediaPrompt(adapterDependencies, input);
            await auditToolCall({
              tool: "approve_media_prompt",
              result: "blocked",
              details: { nodeId: input.nodeId, mediaType: input.mediaType },
            });
            respond({ approved: false, rejection });
          }}
        />
      );
    },
  });

  useHumanInTheLoop({
    name: "approve_execution_plan",
    description:
      "Approve, edit, or reject a multi-operation execution plan after dry-run simulation.",
    parameters: [
      { name: "planId", type: "string", description: "Execution plan id", required: true },
      { name: "storyboardId", type: "string", description: "Storyboard id", required: true },
      { name: "branchId", type: "string", description: "Branch id", required: true },
      { name: "title", type: "string", description: "Plan title", required: true },
      { name: "rationale", type: "string", description: "Plan rationale", required: true },
      { name: "operations", type: "object[]", description: "Plan operations", required: true },
      { name: "dryRun", type: "object", description: "Dry-run report", required: false },
    ],
    render: ({ args, status, respond }) => {
      if (status !== "executing" || !respond) {
        return <></>;
      }
      const input = parseExecutionPlanInput(args);
      if (!input) {
        return (
          <ToolStatusCard
            name="approve_execution_plan"
            status="failed"
            args={JSON.stringify(args ?? {}, null, 2)}
            result={JSON.stringify({ error: "Invalid execution plan payload" })}
          />
        );
      }
      const dryRunSummary = input.dryRun
        ? `Dry-run: ${input.dryRun.summary} (risk: ${input.dryRun.riskLevel})`
        : "Dry-run summary unavailable.";
      return (
        <ApprovalCard
          title={input.title}
          subtitle={`Branch ${input.branchId} - ${input.operations.length} op(s)`}
          body={`${input.rationale}\n\n${dryRunSummary}`}
          onApprove={async () => {
            const execution = await executeApprovedExecutionPlan(adapterDependencies, input);
            await auditToolCall({
              tool: "approve_execution_plan",
              result: "success",
              details: { planId: input.planId, operationCount: input.operations.length },
            });
            respond({ approved: true, execution });
          }}
          onEdit={async () => {
            const execution = await executeApprovedExecutionPlan(
              adapterDependencies,
              input,
              input.operations,
            );
            await auditToolCall({
              tool: "approve_execution_plan",
              result: "success",
              details: { planId: input.planId, operationCount: input.operations.length, edited: true },
            });
            respond({ approved: true, editedOperations: input.operations, execution });
          }}
          onReject={async () => {
            const rejection = await executeRejectedExecutionPlan(adapterDependencies, input);
            await auditToolCall({
              tool: "approve_execution_plan",
              result: "blocked",
              details: { planId: input.planId },
            });
            respond({ approved: false, rejection });
          }}
        />
      );
    },
  });

  useHumanInTheLoop({
    name: "preview_simulation_critic_plan",
    description:
      "Preview simulation critic rationale (issues, confidence, impact) before requesting batch approval.",
    parameters: [
      { name: "simulationRunId", type: "string", description: "Simulation critic run id", required: true },
      { name: "storyboardId", type: "string", description: "Storyboard id", required: true },
      { name: "branchId", type: "string", description: "Branch id", required: true },
      { name: "summary", type: "string", description: "Critic summary", required: true },
      { name: "riskLevel", type: "string", description: "Critic risk level", required: true },
      { name: "issues", type: "object[]", description: "Critic issues", required: true },
      { name: "confidence", type: "number", description: "Critic confidence", required: true },
      { name: "impactScore", type: "number", description: "Estimated impact score", required: true },
      { name: "executionPlan", type: "object", description: "Proposed batch execution plan", required: true },
    ],
    render: ({ args, status, respond }) => {
      if (status !== "executing" || !respond) {
        return <></>;
      }
      const input = parseSimulationCriticPreviewInput(args);
      if (!input) {
        return (
          <ToolStatusCard
            name="preview_simulation_critic_plan"
            status="failed"
            args={JSON.stringify(args ?? {}, null, 2)}
            result={JSON.stringify({ error: "Invalid simulation critic preview payload" })}
          />
        );
      }

      return (
        <SimulationCriticPreviewCard
          simulationRunId={input.simulationRunId}
          summary={input.summary}
          riskLevel={input.riskLevel}
          issues={input.issues}
          confidence={input.confidence}
          impactScore={input.impactScore}
          onContinue={async () => {
            const nextPayload = {
              ...input.executionPlan,
              source: "simulation_critic",
              sourceId: input.simulationRunId,
              taskType: "simulation_critic_batch",
            };
            respond({
              approved: true,
              nextAction: "approve_batch_ops",
              nextPayload,
              executionPlan: nextPayload,
              policyEvidence: {
                action: "preview_simulation_critic_plan",
                simulationRunId: input.simulationRunId,
                riskLevel: input.riskLevel,
                confidence: input.confidence,
                impactScore: input.impactScore,
              },
            });
            await auditToolCall({
              tool: "preview_simulation_critic_plan",
              result: "success",
              details: { simulationRunId: input.simulationRunId, riskLevel: input.riskLevel },
            });
          }}
          onReject={async () => {
            await auditToolCall({
              tool: "preview_simulation_critic_plan",
              result: "blocked",
              details: { simulationRunId: input.simulationRunId },
            });
            respond({
              approved: false,
              nextAction: "approve_batch_ops",
              blockedReason: "Producer rejected simulation critic proposal at preview stage.",
            });
          }}
        />
      );
    },
  });

  useHumanInTheLoop({
    name: "approve_batch_ops",
    description:
      "Approve, edit, or reject batched operations with per-op override support.",
    parameters: [
      { name: "planId", type: "string", description: "Execution plan id", required: true },
      { name: "storyboardId", type: "string", description: "Storyboard id", required: false },
      { name: "branchId", type: "string", description: "Branch id", required: false },
      { name: "title", type: "string", description: "Batch title", required: false },
      { name: "rationale", type: "string", description: "Batch rationale", required: false },
      { name: "source", type: "string", description: "Batch source", required: false },
      { name: "sourceId", type: "string", description: "Source id", required: false },
      { name: "taskType", type: "string", description: "Task type", required: false },
      { name: "operations", type: "object[]", description: "Batch operations", required: true },
      { name: "dryRun", type: "object", description: "Dry-run summary", required: false },
    ],
    render: ({ args, status, respond }) => {
      if (status !== "executing" || !respond) {
        return <></>;
      }
      const input = parseBatchOpsInput(args);
      if (!input) {
        return (
          <ToolStatusCard
            name="approve_batch_ops"
            status="failed"
            args={JSON.stringify(args ?? {}, null, 2)}
            result={JSON.stringify({ error: "Invalid batch ops payload" })}
          />
        );
      }
      const executionInput: ExecutionPlanInput = {
        planId: input.planId,
        storyboardId: input.storyboardId ?? safeStoryboardId,
        branchId: input.branchId ?? "main",
        title: input.title ?? `Batch Apply ${input.planId}`,
        rationale: input.rationale ?? "Producer-approved batched operations",
        operations: input.operations,
        source: input.source,
        sourceId: input.sourceId,
        taskType: input.taskType ?? "batch_ops",
        dryRun: input.dryRun,
      };

      return (
        <BatchApprovalCard
          title={`Batch Ops - ${input.operations.length} op(s)`}
          subtitle="Per-op override enabled"
          body={input.dryRun?.summary ?? "Dry-run summary unavailable."}
          operations={input.operations}
          onApprove={async (selectedOperations) => {
            const execution = await executeApprovedExecutionPlan(
              adapterDependencies,
              executionInput,
              selectedOperations,
            );
            await auditToolCall({
              tool: "approve_batch_ops",
              result: "success",
              details: { planId: executionInput.planId, selectedCount: selectedOperations.length },
            });
            respond({ approved: true, editedOperations: selectedOperations, execution });
          }}
          onReject={async () => {
            const rejection = await executeRejectedExecutionPlan(adapterDependencies, executionInput);
            await auditToolCall({
              tool: "approve_batch_ops",
              result: "blocked",
              details: { planId: executionInput.planId },
            });
            respond({ approved: false, rejection });
          }}
        />
      );
    },
  });


  useHumanInTheLoop({
    name: "approve_dailies_batch",
    description:
      "Approve or reject autonomous dailies execution plan with per-op override support.",
    parameters: [
      { name: "planId", type: "string", description: "Execution plan id", required: true },
      { name: "storyboardId", type: "string", description: "Storyboard id", required: true },
      { name: "branchId", type: "string", description: "Branch id", required: true },
      { name: "title", type: "string", description: "Plan title", required: true },
      { name: "rationale", type: "string", description: "Plan rationale", required: true },
      { name: "sourceId", type: "string", description: "Autonomous dailies reel id", required: true },
      { name: "operations", type: "object[]", description: "Plan operations", required: true },
      { name: "dryRun", type: "object", description: "Dry-run summary", required: false },
    ],
    render: ({ args, status, respond }) => {
      if (status !== "executing" || !respond) {
        return <></>;
      }
      const input = parseBatchOpsInput(args);
      if (!input || !input.sourceId) {
        return (
          <ToolStatusCard
            name="approve_dailies_batch"
            status="failed"
            args={JSON.stringify(args ?? {}, null, 2)}
            result={JSON.stringify({ error: "Invalid autonomous dailies payload" })}
          />
        );
      }
      const executionInput: ExecutionPlanInput = {
        planId: input.planId,
        storyboardId: input.storyboardId ?? safeStoryboardId,
        branchId: input.branchId ?? "main",
        title: input.title ?? `Autonomous Dailies ${input.planId}`,
        rationale: input.rationale ?? "Autonomous dailies batch proposal",
        operations: input.operations,
        source: "dailies",
        sourceId: input.sourceId,
        taskType: "dailies_batch",
        dryRun: input.dryRun,
      };

      return (
        <BatchApprovalCard
          title={`Autonomous Dailies - ${input.operations.length} op(s)`}
          subtitle={`Reel ${input.sourceId}`}
          body={input.dryRun?.summary ?? "Autonomous dailies candidate plan"}
          operations={input.operations}
          onApprove={async (selectedOperations) => {
            const execution = await executeApprovedExecutionPlan(
              adapterDependencies,
              executionInput,
              selectedOperations,
            );
            await auditToolCall({
              tool: "approve_dailies_batch",
              result: "success",
              details: { planId: executionInput.planId, reelId: input.sourceId, selectedCount: selectedOperations.length },
            });
            respond({ approved: true, editedOperations: selectedOperations, execution });
          }}
          onReject={async () => {
            const rejection = await executeRejectedExecutionPlan(adapterDependencies, executionInput);
            await auditToolCall({
              tool: "approve_dailies_batch",
              result: "blocked",
              details: { planId: executionInput.planId, reelId: input.sourceId },
            });
            respond({ approved: false, rejection });
          }}
        />
      );
    },
  });
  useHumanInTheLoop({
    name: "approve_merge_policy",
    description: "Approve or reject merge policy for branch integration.",
    parameters: [
      { name: "branchId", type: "string", description: "Working branch", required: true },
      { name: "sourceBranchId", type: "string", description: "Source branch", required: true },
      { name: "targetBranchId", type: "string", description: "Target branch", required: true },
      { name: "policy", type: "string", description: "Merge policy", required: true },
      { name: "semanticDiff", type: "object", description: "Semantic diff summary", required: false },
    ],
    render: ({ args, status, respond }) => {
      if (status !== "executing" || !respond) {
        return <></>;
      }
      const input = parseMergePolicyInput(args);
      if (!input) {
        return (
          <ToolStatusCard
            name="approve_merge_policy"
            status="failed"
            args={JSON.stringify(args ?? {}, null, 2)}
            result={JSON.stringify({ error: "Invalid merge policy payload" })}
          />
        );
      }
      const body = `Source: ${input.sourceBranchId}\nTarget: ${input.targetBranchId}\nPolicy: ${input.policy}`;
      return (
        <ApprovalCard
          title="Merge Policy Approval"
          subtitle={`Branch ${input.branchId}`}
          body={body}
          onApprove={async () => {
            const taskId = await createApprovalTask({
              storyboardId: safeStoryboardId,
              taskType: "merge_policy",
              title: "Merge policy approved",
              rationale: `Policy ${input.policy}`,
              diffSummary: "Merge policy approval",
              payloadJson: JSON.stringify(input),
            });
            await resolveApprovalTask({
              taskId,
              approved: true,
            });
            const mergeExecution = await applyMergePolicyMutation({
              storyboardId: safeStoryboardId,
              sourceBranchId: input.sourceBranchId,
              targetBranchId: input.targetBranchId,
              policy: input.policy,
              approvalToken: `approved:${taskId}`,
            });
            await auditToolCall({
              tool: "approve_merge_policy",
              result: "success",
              details: {
                branchId: input.branchId,
                sourceBranchId: input.sourceBranchId,
                targetBranchId: input.targetBranchId,
                policy: input.policy,
              },
            });
            respond({ approved: true, taskId, mergeExecution });
          }}
          onEdit={async () => {
            const taskId = await createApprovalTask({
              storyboardId: safeStoryboardId,
              taskType: "merge_policy",
              title: "Merge policy edited and approved",
              rationale: `Policy ${input.policy}`,
              diffSummary: "Merge policy edited",
              payloadJson: JSON.stringify(input),
            });
            await resolveApprovalTask({
              taskId,
              approved: true,
              editedPayloadJson: JSON.stringify(input),
            });
            const mergeExecution = await applyMergePolicyMutation({
              storyboardId: safeStoryboardId,
              sourceBranchId: input.sourceBranchId,
              targetBranchId: input.targetBranchId,
              policy: input.policy,
              approvalToken: `approved:${taskId}`,
            });
            await auditToolCall({
              tool: "approve_merge_policy",
              result: "success",
              details: {
                branchId: input.branchId,
                sourceBranchId: input.sourceBranchId,
                targetBranchId: input.targetBranchId,
                policy: input.policy,
                edited: true,
              },
            });
            respond({ approved: true, taskId, edited: true, mergeExecution });
          }}
          onReject={async () => {
            const taskId = await createApprovalTask({
              storyboardId: safeStoryboardId,
              taskType: "merge_policy",
              title: "Merge policy rejected",
              rationale: `Policy ${input.policy}`,
              diffSummary: "Merge policy rejected",
              payloadJson: JSON.stringify(input),
            });
            await resolveApprovalTask({
              taskId,
              approved: false,
              justification: "Rejected by producer",
            });
            await auditToolCall({
              tool: "approve_merge_policy",
              result: "blocked",
              details: {
                branchId: input.branchId,
                sourceBranchId: input.sourceBranchId,
                targetBranchId: input.targetBranchId,
                policy: input.policy,
              },
            });
            respond({ approved: false, taskId });
          }}
        />
      );
    },
  });

  useHumanInTheLoop({
    name: "approve_repair_plan",
    description:
      "Approve, edit, or reject a generated repair plan for continuity/simulation failures.",
    parameters: [
      { name: "repairPlanId", type: "string", description: "Repair plan id", required: true },
      { name: "operations", type: "object[]", description: "Repair operations", required: true },
      { name: "confidence", type: "number", description: "Repair confidence", required: true },
    ],
    render: ({ args, status, respond }) => {
      if (status !== "executing" || !respond) {
        return <></>;
      }
      const input = parseRepairPlanInput(args);
      if (!input) {
        return (
          <ToolStatusCard
            name="approve_repair_plan"
            status="failed"
            args={JSON.stringify(args ?? {}, null, 2)}
            result={JSON.stringify({ error: "Invalid repair plan payload" })}
          />
        );
      }
      const executionInput: ExecutionPlanInput = {
        planId: input.repairPlanId,
        storyboardId: safeStoryboardId,
        branchId: "main",
        title: `Repair Plan ${input.repairPlanId}`,
        rationale: `Auto-repair with confidence ${input.confidence.toFixed(2)}`,
        operations: input.operations,
      };
      return (
        <ApprovalCard
          title={`Repair Plan - ${input.operations.length} op(s)`}
          subtitle={`Confidence ${input.confidence.toFixed(2)}`}
          body="Apply suggested continuity repairs."
          onApprove={async () => {
            const execution = await executeApprovedExecutionPlan(adapterDependencies, executionInput);
            await auditToolCall({
              tool: "approve_repair_plan",
              result: "success",
              details: { repairPlanId: input.repairPlanId, operationCount: input.operations.length },
            });
            respond({ approved: true, execution });
          }}
          onEdit={async () => {
            const execution = await executeApprovedExecutionPlan(
              adapterDependencies,
              executionInput,
              input.operations,
            );
            await auditToolCall({
              tool: "approve_repair_plan",
              result: "success",
              details: { repairPlanId: input.repairPlanId, operationCount: input.operations.length, edited: true },
            });
            respond({ approved: true, editedOperations: input.operations, execution });
          }}
          onReject={async () => {
            const rejection = await executeRejectedExecutionPlan(adapterDependencies, executionInput);
            await auditToolCall({
              tool: "approve_repair_plan",
              result: "blocked",
              details: { repairPlanId: input.repairPlanId },
            });
            respond({ approved: false, rejection });
          }}
        />
      );
    },
  });

  useHumanInTheLoop({
    name: "select_agent_team",
    description: "Assign an agent team revision to the current storyboard runtime.",
    parameters: [
      { name: "teamId", type: "string", description: "Team id", required: true },
      { name: "revisionId", type: "string", description: "Team revision id", required: false },
    ],
    render: ({ args, status, respond }) => {
      if (status !== "executing" || !respond) {
        return <></>;
      }
      const input = parseSelectTeamInput(args);
      if (!input || !safeStoryboardId) {
        return (
          <ToolStatusCard
            name="select_agent_team"
            status="failed"
            args={JSON.stringify(args ?? {}, null, 2)}
            result={JSON.stringify({ error: "Invalid team selection payload" })}
          />
        );
      }
      return (
        <ApprovalCard
          title={`Activate team ${input.teamId}`}
          subtitle={input.revisionId ? `Revision ${input.revisionId}` : "Latest published revision"}
          body="Switching teams changes subagent composition, policy, and tool scope."
          onApprove={async () => {
            await selectTeamMutation({
              storyboardId: safeStoryboardId,
              activeTeamId: input.teamId,
              activeRevisionId: input.revisionId,
            });
            await auditToolCall({
              tool: "select_agent_team",
              result: "success",
              details: { teamId: input.teamId, revisionId: input.revisionId },
            });
            respond({
              approved: true,
              policyEvidence: {
                action: "select_agent_team",
                teamId: input.teamId,
                revisionId: input.revisionId ?? "published",
              },
            });
          }}
          onEdit={async () => {
            await selectTeamMutation({
              storyboardId: safeStoryboardId,
              activeTeamId: input.teamId,
              activeRevisionId: input.revisionId,
            });
            await auditToolCall({
              tool: "select_agent_team",
              result: "success",
              details: { teamId: input.teamId, revisionId: input.revisionId, edited: true },
            });
            respond({ approved: true, edited: true });
          }}
          onReject={async () => {
            await auditToolCall({
              tool: "select_agent_team",
              result: "blocked",
              details: { teamId: input.teamId, revisionId: input.revisionId },
            });
            respond({ approved: false, blockedReason: "Producer rejected team switch." });
          }}
        />
      );
    },
  });

  useHumanInTheLoop({
    name: "create_agent_team",
    description: "Create a new custom agent team definition.",
    parameters: [
      { name: "name", type: "string", description: "Team name", required: true },
      { name: "description", type: "string", description: "Team description", required: false },
      { name: "teamGoal", type: "string", description: "Team goal", required: false },
    ],
    render: ({ args, status, respond }) => {
      if (status !== "executing" || !respond) {
        return <></>;
      }
      const input = parseCreateTeamInput(args);
      if (!input) {
        return (
          <ToolStatusCard
            name="create_agent_team"
            status="failed"
            args={JSON.stringify(args ?? {}, null, 2)}
            result={JSON.stringify({ error: "Invalid create team payload" })}
          />
        );
      }
      return (
        <ApprovalCard
          title={`Create team ${input.name}`}
          subtitle="New custom team"
          body={input.teamGoal}
          onApprove={async () => {
            const result = await createTeamMutation(input) as { teamId: string; revisionId: string };
            if (safeStoryboardId) {
              await selectTeamMutation({
                storyboardId: safeStoryboardId,
                activeTeamId: result.teamId,
                activeRevisionId: result.revisionId,
              });
            }
            await auditToolCall({
              tool: "create_agent_team",
              result: "success",
              details: { teamId: result.teamId, revisionId: result.revisionId },
            });
            respond({
              approved: true,
              teamId: result.teamId,
              revisionId: result.revisionId,
              nextAction: "select_agent_team",
            });
          }}
          onEdit={async () => {
            const result = await createTeamMutation(input) as { teamId: string; revisionId: string };
            await auditToolCall({
              tool: "create_agent_team",
              result: "success",
              details: { teamId: result.teamId, revisionId: result.revisionId, edited: true },
            });
            respond({ approved: true, edited: true, teamId: result.teamId, revisionId: result.revisionId });
          }}
          onReject={async () => {
            await auditToolCall({
              tool: "create_agent_team",
              result: "blocked",
              details: { name: input.name },
            });
            respond({ approved: false, blockedReason: "Producer rejected team creation." });
          }}
        />
      );
    },
  });

  useHumanInTheLoop({
    name: "update_agent_team_member",
    description: "Update team member persona/scope in a specific revision.",
    parameters: [
      { name: "teamId", type: "string", description: "Team id", required: true },
      { name: "revisionId", type: "string", description: "Revision id", required: true },
      { name: "member", type: "object", description: "Member update payload", required: true },
    ],
    render: ({ args, status, respond }) => {
      if (status !== "executing" || !respond) {
        return <></>;
      }
      const input = parseUpdateTeamMemberInput(args);
      if (!input) {
        return (
          <ToolStatusCard
            name="update_agent_team_member"
            status="failed"
            args={JSON.stringify(args ?? {}, null, 2)}
            result={JSON.stringify({ error: "Invalid member update payload" })}
          />
        );
      }
      return (
        <ApprovalCard
          title={`Update ${input.member.agentName}`}
          subtitle={`Team ${input.teamId} • Revision ${input.revisionId}`}
          body={input.member.persona}
          onApprove={async () => {
            await updateTeamMemberMutation(input);
            await auditToolCall({
              tool: "update_agent_team_member",
              result: "success",
              details: { teamId: input.teamId, revisionId: input.revisionId, agentName: input.member.agentName },
            });
            respond({ approved: true, policyEvidence: { action: "update_agent_team_member", teamId: input.teamId } });
          }}
          onEdit={async () => {
            await updateTeamMemberMutation(input);
            await auditToolCall({
              tool: "update_agent_team_member",
              result: "success",
              details: { teamId: input.teamId, revisionId: input.revisionId, agentName: input.member.agentName, edited: true },
            });
            respond({ approved: true, edited: true });
          }}
          onReject={async () => {
            await auditToolCall({
              tool: "update_agent_team_member",
              result: "blocked",
              details: { teamId: input.teamId, revisionId: input.revisionId, agentName: input.member.agentName },
            });
            respond({ approved: false, blockedReason: "Producer rejected member update." });
          }}
        />
      );
    },
  });

  useHumanInTheLoop({
    name: "publish_agent_team_revision",
    description: "Publish a team revision for runtime use.",
    parameters: [
      { name: "teamId", type: "string", description: "Team id", required: true },
      { name: "revisionId", type: "string", description: "Revision id", required: true },
    ],
    render: ({ args, status, respond }) => {
      if (status !== "executing" || !respond) {
        return <></>;
      }
      const input = parsePublishRevisionInput(args);
      if (!input) {
        return (
          <ToolStatusCard
            name="publish_agent_team_revision"
            status="failed"
            args={JSON.stringify(args ?? {}, null, 2)}
            result={JSON.stringify({ error: "Invalid publish revision payload" })}
          />
        );
      }
      return (
        <ApprovalCard
          title={`Publish ${input.teamId}`}
          subtitle={`Revision ${input.revisionId}`}
          body="Publishing revision updates runtime policy and subagent configuration."
          onApprove={async () => {
            await publishRevisionMutation(input);
            await auditToolCall({
              tool: "publish_agent_team_revision",
              result: "success",
              details: input,
            });
            respond({ approved: true, policyEvidence: { action: "publish_agent_team_revision", ...input } });
          }}
          onEdit={async () => {
            await publishRevisionMutation(input);
            await auditToolCall({
              tool: "publish_agent_team_revision",
              result: "success",
              details: { ...input, edited: true },
            });
            respond({ approved: true, edited: true });
          }}
          onReject={async () => {
            await auditToolCall({
              tool: "publish_agent_team_revision",
              result: "blocked",
              details: input,
            });
            respond({ approved: false, blockedReason: "Producer rejected publish revision." });
          }}
        />
      );
    },
  });

  useHumanInTheLoop({
    name: "generate_team_from_prompt",
    description: "Generate editable team draft from natural-language prompt.",
    parameters: [
      { name: "inputPrompt", type: "string", description: "Prompt describing team intent", required: true },
      { name: "teamId", type: "string", description: "Optional target team id", required: false },
      { name: "publish", type: "boolean", description: "Publish after apply", required: false },
    ],
    render: ({ args, status, respond }) => {
      if (status !== "executing" || !respond) {
        return <></>;
      }
      const input = parseGenerateTeamFromPromptInput(args);
      if (!input) {
        return (
          <ToolStatusCard
            name="generate_team_from_prompt"
            status="failed"
            args={JSON.stringify(args ?? {}, null, 2)}
            result={JSON.stringify({ error: "Invalid prompt bootstrap payload" })}
          />
        );
      }
      return (
        <ApprovalCard
          title="Generate Team Draft"
          subtitle="Prompt bootstrap"
          body={input.inputPrompt}
          onApprove={async () => {
            const draft = await generateTeamFromPromptMutation({
              inputPrompt: input.inputPrompt,
            }) as TeamPromptDraft;
            if (input.teamId) {
              await applyPromptDraftMutation({
                teamId: input.teamId,
                draftId: draft.draftId,
                publish: input.publish ?? false,
              });
            }
            await auditToolCall({
              tool: "generate_team_from_prompt",
              result: "success",
              details: { draftId: draft.draftId, teamId: input.teamId, publish: input.publish },
            });
            respond({
              approved: true,
              draft,
              nextAction: input.teamId ? "publish_agent_team_revision" : undefined,
            });
          }}
          onEdit={async () => {
            const draft = await generateTeamFromPromptMutation({
              inputPrompt: input.inputPrompt,
            }) as TeamPromptDraft;
            await auditToolCall({
              tool: "generate_team_from_prompt",
              result: "success",
              details: { draftId: draft.draftId, teamId: input.teamId, publish: input.publish, edited: true },
            });
            respond({ approved: true, edited: true, draft });
          }}
          onReject={async () => {
            await auditToolCall({
              tool: "generate_team_from_prompt",
              result: "blocked",
              details: { teamId: input.teamId },
            });
            respond({ approved: false, blockedReason: "Producer rejected prompt bootstrap." });
          }}
        />
      );
    },
  });

  return (
    <>
      <CopilotActionRegistration name="propose_branch" />
      <CopilotActionRegistration name="expand_scene_to_shots" />
      <CopilotActionRegistration name="merge_branches" />
      <CopilotActionRegistration name="create_character" />
      <CopilotActionRegistration name="edit_character" />
      <CopilotActionRegistration name="create_background" />
      <CopilotActionRegistration name="compose_scene_image" />
      <CopilotActionRegistration name="generate_shot_video" />
      <CopilotActionRegistration name="propagate_consistency_fix" />
      <CopilotActionRegistration name="approve_execution_plan" />
      <CopilotActionRegistration name="approve_batch_ops" />
      <CopilotActionRegistration name="approve_dailies_batch" />
      <CopilotActionRegistration name="approve_merge_policy" />
      <CopilotActionRegistration name="approve_repair_plan" />
      <CopilotActionRegistration name="select_agent_team" />
      <CopilotActionRegistration name="create_agent_team" />
      <CopilotActionRegistration name="update_agent_team_member" />
      <CopilotActionRegistration name="publish_agent_team_revision" />
      <CopilotActionRegistration name="generate_team_from_prompt" />
      <CopilotSidebar
        defaultOpen={false}
        clickOutsideToClose
        labels={{
          title: "Storyboard Copilot",
          initial:
            "Agent draft mode is active. I can propose branches, shot expansions, merges, and continuity fixes. All mutations require HITL approval.",
        }}
      />
    </>
  );
}

function CopilotActionRegistration({ name }: { name: string }) {
  useCopilotAction({
    name,
    available: "disabled",
    render: ({ status, args, result }) => (
      <ToolStatusCard
        name={name}
        status={normalizeStatus(status)}
        args={JSON.stringify(args ?? {}, null, 2)}
        result={result ? JSON.stringify(result, null, 2) : undefined}
      />
    ),
  });
  return null;
}

function normalizeStatus(input: string): "queued" | "executing" | "waiting_for_human" | "complete" | "failed" {
  if (input === "executing" || input === "inProgress") {
    return "executing";
  }
  if (input === "complete") {
    return "complete";
  }
  if (input === "failed") {
    return "failed";
  }
  if (input === "waiting_for_human") {
    return "waiting_for_human";
  }
  return "queued";
}

function ToolStatusCard({
  name,
  status,
  args,
  result,
}: {
  name: string;
  status: "queued" | "executing" | "waiting_for_human" | "complete" | "failed";
  args: string;
  result?: string;
}) {
  return (
    <div className="my-3 rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-200 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-zinc-400">{name}</div>
        <span className="text-[10px] uppercase rounded bg-zinc-800 px-2 py-1">{status}</span>
      </div>
      <pre className="mt-2 text-[10px] whitespace-pre-wrap text-zinc-400">{args}</pre>
      {result ? <pre className="mt-2 text-[10px] whitespace-pre-wrap text-emerald-300">{result}</pre> : null}
    </div>
  );
}

function ApprovalCard({
  title,
  subtitle,
  body,
  onApprove,
  onEdit,
  onReject,
}: {
  title: string;
  subtitle: string;
  body: string;
  onApprove: () => Promise<void>;
  onEdit: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAction = async (action: () => Promise<void>) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await action();
    } catch (executionError) {
      setError(
        executionError instanceof Error
          ? executionError.message
          : "Failed to execute approval action.",
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="my-4 rounded-xl border border-amber-500/40 bg-zinc-950 text-zinc-100 p-4">
      <div className="text-xs uppercase text-amber-300 tracking-wide">Approval Required</div>
      <h3 className="mt-1 text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-zinc-400">{subtitle}</p>
      <p className="mt-3 text-xs text-zinc-300 whitespace-pre-wrap">{body}</p>
      {error ? (
        <p className="mt-2 text-[11px] text-rose-300 whitespace-pre-wrap">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          className="px-3 py-1.5 text-xs rounded bg-emerald-600 disabled:opacity-60"
          onClick={() => void runAction(onApprove)}
          disabled={isSubmitting}
        >
          Approve
        </button>
        <button
          className="px-3 py-1.5 text-xs rounded bg-blue-600 disabled:opacity-60"
          onClick={() => void runAction(onEdit)}
          disabled={isSubmitting}
        >
          Approve As Edited
        </button>
        <button
          className="px-3 py-1.5 text-xs rounded bg-rose-700 disabled:opacity-60"
          onClick={() => void runAction(onReject)}
          disabled={isSubmitting}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function BatchApprovalCard({
  title,
  subtitle,
  body,
  operations,
  onApprove,
  onReject,
}: {
  title: string;
  subtitle: string;
  body: string;
  operations: unknown[];
  onApprove: (selectedOperations: unknown[]) => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>(() =>
    operations.map((_, index) => index),
  );

  const toggleSelection = (index: number) => {
    setSelectedIndexes((current) =>
      current.includes(index)
        ? current.filter((value) => value !== index)
        : [...current, index].sort((left, right) => left - right),
    );
  };

  const runAction = async (action: () => Promise<void>) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await action();
    } catch (executionError) {
      setError(
        executionError instanceof Error
          ? executionError.message
          : "Failed to execute batch approval.",
      );
      setIsSubmitting(false);
    }
  };

  const selectedOperations = selectedIndexes
    .map((index) => operations[index])
    .filter((operation): operation is unknown => operation !== undefined);

  return (
    <div className="my-4 rounded-xl border border-violet-500/40 bg-zinc-950 text-zinc-100 p-4">
      <div className="text-xs uppercase text-violet-300 tracking-wide">Batch Approval Required</div>
      <h3 className="mt-1 text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-zinc-400">{subtitle}</p>
      <p className="mt-3 text-xs text-zinc-300 whitespace-pre-wrap">{body}</p>

      <div className="mt-3 max-h-48 overflow-y-auto rounded border border-zinc-800 p-2 space-y-2">
        {operations.map((operation, index) => {
          const label = isRecord(operation) && typeof operation.title === "string"
            ? operation.title
            : isRecord(operation) && typeof operation.op === "string"
              ? operation.op
              : `operation_${index + 1}`;
          const checked = selectedIndexes.includes(index);
          return (
            <label key={`batch_op_${index}`} className="flex items-start gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleSelection(index)}
                className="mt-0.5"
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>

      {error ? (
        <p className="mt-2 text-[11px] text-rose-300 whitespace-pre-wrap">{error}</p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          className="px-3 py-1.5 text-xs rounded bg-emerald-600 disabled:opacity-60"
          onClick={() =>
            void runAction(async () => {
              if (selectedOperations.length === 0) {
                throw new Error("Select at least one operation to approve.");
              }
              await onApprove(selectedOperations);
            })
          }
          disabled={isSubmitting}
        >
          Approve Selected
        </button>
        <button
          className="px-3 py-1.5 text-xs rounded bg-zinc-700 disabled:opacity-60"
          onClick={() => setSelectedIndexes(operations.map((_, index) => index))}
          disabled={isSubmitting}
        >
          Select All
        </button>
        <button
          className="px-3 py-1.5 text-xs rounded bg-rose-700 disabled:opacity-60"
          onClick={() => void runAction(onReject)}
          disabled={isSubmitting}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function SimulationCriticPreviewCard({
  simulationRunId,
  summary,
  riskLevel,
  issues,
  confidence,
  impactScore,
  onContinue,
  onReject,
}: {
  simulationRunId: string;
  summary: string;
  riskLevel: DryRunRiskLevel;
  issues: Array<{
    code: string;
    severity: DryRunRiskLevel;
    message: string;
    suggestedFix?: string;
  }>;
  confidence: number;
  impactScore: number;
  onContinue: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAction = async (action: () => Promise<void>) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await action();
    } catch (executionError) {
      setError(
        executionError instanceof Error
          ? executionError.message
          : "Failed to process simulation critic preview.",
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="my-4 rounded-xl border border-orange-500/40 bg-zinc-950 text-zinc-100 p-4">
      <div className="text-xs uppercase text-orange-300 tracking-wide">Simulation Critic Preview</div>
      <h3 className="mt-1 text-sm font-semibold">{summary || "Simulation critic review"}</h3>
      <p className="mt-1 text-xs text-zinc-400">Run {simulationRunId}</p>
      <div className="mt-2 flex gap-2 text-[11px]">
        <span className="rounded bg-zinc-800 px-2 py-1">Risk: {riskLevel}</span>
        <span className="rounded bg-zinc-800 px-2 py-1">
          Confidence: {confidence.toFixed(2)}
        </span>
        <span className="rounded bg-zinc-800 px-2 py-1">Impact: {impactScore.toFixed(2)}</span>
      </div>
      <div className="mt-3 max-h-48 overflow-y-auto rounded border border-zinc-800 p-2 space-y-2">
        {issues.length === 0 ? (
          <p className="text-xs text-zinc-400">No explicit issues reported.</p>
        ) : (
          issues.map((issue, index) => (
            <div key={`critic_issue_${index}`} className="rounded border border-zinc-800 p-2">
              <div className="text-[11px] text-zinc-300">
                {issue.code} [{issue.severity}]
              </div>
              <div className="mt-1 text-xs text-zinc-400">{issue.message}</div>
              {issue.suggestedFix ? (
                <div className="mt-1 text-[11px] text-emerald-300">
                  Suggested fix: {issue.suggestedFix}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
      {error ? (
        <p className="mt-2 text-[11px] text-rose-300 whitespace-pre-wrap">{error}</p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          className="px-3 py-1.5 text-xs rounded bg-emerald-600 disabled:opacity-60"
          onClick={() => void runAction(onContinue)}
          disabled={isSubmitting}
        >
          Continue to Batch Approval
        </button>
        <button
          className="px-3 py-1.5 text-xs rounded bg-rose-700 disabled:opacity-60"
          onClick={() => void runAction(onReject)}
          disabled={isSubmitting}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function PromptApprovalCard({
  nodeId,
  mediaType,
  prompt,
  negativePrompt,
  contextSummary,
  onApprove,
  onReject,
}: {
  nodeId: string;
  mediaType: "image" | "video";
  prompt: string;
  negativePrompt?: string;
  contextSummary: string;
  onApprove: (payload: { prompt: string; negativePrompt?: string }) => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const [editedPrompt, setEditedPrompt] = useState(prompt);
  const [editedNegativePrompt, setEditedNegativePrompt] = useState(negativePrompt ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAction = async (action: () => Promise<void>) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await action();
    } catch (executionError) {
      setError(
        executionError instanceof Error
          ? executionError.message
          : "Failed to execute media approval.",
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="my-4 rounded-xl border border-cyan-500/40 bg-zinc-950 text-zinc-100 p-4">
      <div className="text-xs uppercase text-cyan-300 tracking-wide">Media Prompt Approval</div>
      <h3 className="mt-1 text-sm font-semibold">
        {mediaType.toUpperCase()} for Node {nodeId}
      </h3>
      <p className="mt-2 text-[11px] text-zinc-400 whitespace-pre-wrap">{contextSummary}</p>
      <textarea
        value={editedPrompt}
        onChange={(event) => setEditedPrompt(event.target.value)}
        className="mt-3 w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-xs h-24"
      />
      <textarea
        value={editedNegativePrompt}
        onChange={(event) => setEditedNegativePrompt(event.target.value)}
        className="mt-2 w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-xs h-16"
        placeholder="Negative prompt"
      />
      {error ? (
        <p className="mt-2 text-[11px] text-rose-300 whitespace-pre-wrap">{error}</p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          className="px-3 py-1.5 text-xs rounded bg-emerald-600 disabled:opacity-60"
          onClick={() =>
            void runAction(() =>
              onApprove({
                prompt: editedPrompt,
                negativePrompt: editedNegativePrompt || undefined,
              }),
            )
          }
          disabled={isSubmitting}
        >
          Approve Prompt
        </button>
        <button
          className="px-3 py-1.5 text-xs rounded bg-rose-700 disabled:opacity-60"
          onClick={() => void runAction(onReject)}
          disabled={isSubmitting}
        >
          Reject
        </button>
      </div>
    </div>
  );
}


