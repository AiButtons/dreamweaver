import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { OutlinePanel } from "@/components/storyboard/OutlinePanel";
import { ProductionHubDrawer } from "@/components/storyboard/ProductionHubDrawer";
import type {
  AgentDelegationRecord,
  ApprovalTaskRecord,
  AutonomousDailiesRecord,
  ConstraintBundle,
  NarrativeBranchRecord,
  NarrativeCommitRecord,
  QuotaUsageSummary,
  RuntimeResolvedTeam,
  SimulationCriticRunRecord,
  StoryEdge,
  StoryNode,
  TeamDefinition,
  TeamMemberConfig,
  TeamPolicy,
  TeamPromptDraft,
  ToolCallAuditRecord,
} from "@/app/storyboard/types";

describe("Storyboard shell integration", () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalActFlag = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;

  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://localhost/",
    });
    Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
    Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
    Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
    Object.defineProperty(globalThis, "getComputedStyle", {
      value: dom.window.getComputedStyle.bind(dom.window),
      configurable: true,
    });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      value: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
      configurable: true,
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      value: (id: number) => clearTimeout(id),
      configurable: true,
    });
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    cleanup();
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: originalDocument, configurable: true });
    Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true });
    Object.defineProperty(globalThis, "getComputedStyle", { value: undefined, configurable: true });
    Object.defineProperty(globalThis, "requestAnimationFrame", { value: undefined, configurable: true });
    Object.defineProperty(globalThis, "cancelAnimationFrame", { value: undefined, configurable: true });
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalActFlag;
  });

  it("OutlinePanel orders nodes along the primary serial line and selects on click", async () => {
    const nodes: StoryNode[] = [
      {
        id: "n1",
        type: "custom",
        position: { x: 0, y: 0 },
        data: {
          label: "Scene 1",
          segment: "Opening",
          nodeType: "scene",
          entityRefs: { characterIds: [] },
          continuity: { identityLockVersion: 1, wardrobeVariantIds: [], consistencyStatus: "ok" },
          historyContext: { eventIds: [], rollingSummary: "", tokenBudgetUsed: 0, lineageHash: "" },
          promptPack: { continuityDirectives: [] },
          media: { images: [], videos: [] },
          imageHistory: [],
        },
      } as StoryNode,
      {
        id: "n2",
        type: "custom",
        position: { x: 200, y: 0 },
        data: {
          label: "Shot 1A",
          segment: "Close-up",
          nodeType: "shot",
          entityRefs: { characterIds: [] },
          continuity: { identityLockVersion: 1, wardrobeVariantIds: [], consistencyStatus: "ok" },
          historyContext: { eventIds: [], rollingSummary: "", tokenBudgetUsed: 0, lineageHash: "" },
          promptPack: { continuityDirectives: [] },
          media: { images: [], videos: [] },
          imageHistory: [],
        },
      } as StoryNode,
    ];
    const edges: StoryEdge[] = [
      {
        id: "e1",
        source: "n1",
        target: "n2",
        type: "smoothstep",
        data: { edgeType: "serial", isPrimary: true },
      } as StoryEdge,
    ];

    const selections: string[] = [];
    const view = render(
      <OutlinePanel
        nodes={nodes}
        edges={edges}
        selectedNodeId={null}
        onSelectNode={(id) => selections.push(id)}
        onAddNode={(_nodeType) => void _nodeType}
      />,
    );

    fireEvent.click(view.getByText("Scene 1"));
    await waitFor(() => {
      expect(selections).toEqual(["n1"]);
    });
  });

  it("ProductionHubDrawer is closed by default and opens on click", async () => {
    const runtimeTeam: RuntimeResolvedTeam | null = null;
    const quotaSummary: QuotaUsageSummary | null = null;
    const audits: ToolCallAuditRecord[] = [];
    const delegations: AgentDelegationRecord[] = [];
    const approvals: ApprovalTaskRecord[] = [];
    const teams: TeamDefinition[] = [];
    const dailies: AutonomousDailiesRecord[] = [];
    const simulationRuns: SimulationCriticRunRecord[] = [];
    const branches: NarrativeBranchRecord[] = [];
    const commits: NarrativeCommitRecord[] = [];
    const continuityBundle: ConstraintBundle | null = null;

    const dummyPolicy: TeamPolicy = {
      requiresHitl: true,
      riskThresholds: { warnAt: "medium", blockAt: "high" },
      maxBatchSize: 10,
      quotaProfileId: "default_standard",
      maxRunOps: 30,
      maxConcurrentRuns: 2,
      quotaEnforced: true,
    };

    const dummyMember: TeamMemberConfig = {
      memberId: "planner",
      agentName: "Planner",
      role: "planner",
      persona: "Structured",
      nicheDescription: "Graph ops",
      toolScope: [],
      resourceScope: [],
      weight: 1,
      enabled: true,
    };

    const view = render(
      <ProductionHubDrawer
        pendingApprovalsCount={0}
        continuityViolationCount={0}
        delegations={delegations}
        runtimeTeam={runtimeTeam}
        quotaSummary={quotaSummary}
        audits={audits}
        latestSimulationRun={null}
        approvals={approvals}
        teams={teams}
        teamRevisions={[]}
        dailies={dailies}
        simulationRuns={simulationRuns}
        branches={branches}
        commits={commits}
        continuityBundle={continuityBundle}
        currentMode="graph_studio"
        onSelectTeam={async () => {}}
        onCreateTeam={async () => {
          void "team_1";
        }}
        onCreateRevision={async () => {
          void ({ revisionId: "rev_1", version: 1 });
        }}
        onGenerateDraft={async () => ({
          draftId: "draft_1",
          generatedSpec: {
            teamGoal: "Goal",
            policy: dummyPolicy,
            members: [dummyMember],
            toolAllowlist: [],
            resourceScopes: [],
          },
        } as TeamPromptDraft)}
        onApplyDraft={async () => {
          void ({ revisionId: "rev_1" });
        }}
        onPublishRevision={async () => {}}
        onRollbackRevision={async () => {}}
        onUpdateMember={async () => {}}
        onGenerateDailies={async () => {}}
        onUpdateDailiesStatus={async () => {}}
        onUpdateSimulationRunStatus={async () => {}}
        onRunCritic={async () => {}}
        onCreateBranch={async () => {}}
        onCherryPickCommit={async (_s: string, _t: string) => {}}
        onComputeLatestDiff={async () => {}}
        onDetectContradictions={async () => {}}
      />,
    );

    // Closed by default.
    const trigger = view.getByText("Production").closest("button");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(view.getByText("Production"));

    await waitFor(() => {
      const openTrigger = view.getByText("Production").closest("button");
      expect(openTrigger?.getAttribute("aria-expanded")).toBe("true");
    });
  });
});
