import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import React from "react";
import { fireEvent, render, waitFor, cleanup } from "@testing-library/react";
import { JSDOM } from "jsdom";
import type {
  RuntimeResolvedTeam,
  StoryNode,
  StoryNodeData,
  StoryEdge,
} from "@/app/storyboard/types";

type MutationCall = Record<string, unknown>;
type MutationFn = (args: MutationCall) => Promise<unknown>;

type HitlRenderParams = {
  args: Record<string, unknown>;
  status: string;
  respond?: (payload: Record<string, unknown>) => void;
  result?: unknown;
};

type HitlConfig = {
  name: string;
  render: (params: HitlRenderParams) => React.ReactElement;
};

const hitlRegistry = new Map<string, HitlConfig>();
const mutationSpyRegistry = new Map<string, { calls: MutationCall[]; fn: MutationFn }>();

const createMutationSpy = (
  handler?: (args: MutationCall) => unknown,
): { calls: MutationCall[]; fn: MutationFn } => {
  const calls: MutationCall[] = [];
  const fn: MutationFn = async (args) => {
    calls.push(args);
    if (handler) {
      return handler(args);
    }
    return undefined;
  };
  return { calls, fn };
};

const setupMutationSpies = () => {
  mutationSpyRegistry.clear();
  mutationSpyRegistry.set("approvals:createTask", createMutationSpy(() => "task_1"));
  mutationSpyRegistry.set("approvals:resolveTask", createMutationSpy(() => "task_1"));
  mutationSpyRegistry.set("storyboards:applyGraphPatch", createMutationSpy(() => ({ touchedNodeIds: ["node_1"] })));
  mutationSpyRegistry.set("storyboards:recordStoryEvent", createMutationSpy(() => "event_1"));
  mutationSpyRegistry.set("storyboards:refreshNodeHistoryContexts", createMutationSpy(() => ({ refreshed: 1 })));
  mutationSpyRegistry.set("mediaAssets:createMediaAsset", createMutationSpy(() => "media_1"));
  mutationSpyRegistry.set(
    "storyboards:compileNodePromptPack",
    createMutationSpy((args) => ({
      prompt: String(args.basePrompt ?? ""),
      negativePrompt: String(args.negativePrompt ?? ""),
    })),
  );
  mutationSpyRegistry.set(
    "narrativeGit:simulateExecutionPlan",
    createMutationSpy(() => ({
      valid: true,
      riskLevel: "low",
      summary: "Dry-run passed.",
      issues: [],
      estimatedTotalCost: 0.18,
      estimatedDurationSec: 1.6,
      planHash: "plan_hash_1",
    })),
  );
  mutationSpyRegistry.set(
    "narrativeGit:commitPlanOps",
    createMutationSpy(() => ({
      commitId: "commit_1",
      branchId: "main",
      operationCount: 1,
    })),
  );
  mutationSpyRegistry.set(
    "narrativeGit:rollbackToCommit",
    createMutationSpy(() => ({
      rolledBackTo: "commit_1",
      branchId: "main",
    })),
  );
  mutationSpyRegistry.set(
    "narrativeGit:applyMergePolicy",
    createMutationSpy(() => ({
      commitId: "merge_commit_1",
      branchId: "main",
      operationCount: 1,
      summary: "Applied merge policy.",
    })),
  );
  mutationSpyRegistry.set(
    "dailies:generateAutonomousDailies",
    createMutationSpy(() => ({
      reelId: "reel_1",
    })),
  );
  mutationSpyRegistry.set("dailies:updateDailiesStatus", createMutationSpy(() => "reel_1"));
  mutationSpyRegistry.set(
    "dailies:runSimulationCritic",
    createMutationSpy(() => ({
      simulationRunId: "sim_1",
    })),
  );
  mutationSpyRegistry.set("dailies:updateSimulationRunStatus", createMutationSpy(() => "sim_1"));
  mutationSpyRegistry.set("agentRuns:startRun", createMutationSpy(() => "run_db_1"));
  mutationSpyRegistry.set("agentRuns:finishRun", createMutationSpy(() => "run_db_1"));
  mutationSpyRegistry.set(
    "quotas:checkAndReserveRunBudget",
    createMutationSpy(() => ({
      reserved: true,
      usage: { mediaBudgetUsed: 1, mutationOpsUsed: 1, activeRuns: 1 },
    })),
  );
  mutationSpyRegistry.set(
    "quotas:releaseRunBudget",
    createMutationSpy(() => ({
      released: true,
      usage: { mediaBudgetUsed: 1, mutationOpsUsed: 1, activeRuns: 0 },
    })),
  );
  mutationSpyRegistry.set("agentTeams:assignTeamToStoryboard", createMutationSpy(() => "assignment_1"));
  mutationSpyRegistry.set("agentTeams:createTeam", createMutationSpy(() => ({ teamId: "team_1", revisionId: "team_1:v1" })));
  mutationSpyRegistry.set("agentTeams:updateRevisionMember", createMutationSpy(() => ({ memberId: "planner" })));
  mutationSpyRegistry.set("agentTeams:publishRevision", createMutationSpy(() => ({ teamId: "team_1", revisionId: "team_1:v1" })));
  mutationSpyRegistry.set("agentTeams:generateTeamFromPrompt", createMutationSpy(() => ({
    draftId: "draft_1",
    generatedSpec: {
      teamGoal: "Goal",
      policy: {
        requiresHitl: true,
        riskThresholds: { warnAt: "medium", blockAt: "high" },
        maxBatchSize: 4,
        quotaProfileId: "default_standard",
        maxRunOps: 24,
        maxConcurrentRuns: 2,
        quotaEnforced: true,
      },
      members: [],
      toolAllowlist: ["graph.patch"],
      resourceScopes: ["storyboard.graph"],
    },
  })));
  mutationSpyRegistry.set("agentTeams:applyPromptDraftToRevision", createMutationSpy(() => ({ revisionId: "team_1:v2" })));
  mutationSpyRegistry.set("toolAudits:recordToolCallAudit", createMutationSpy(() => "audit_1"));
};

mock.module("@copilotkit/react-core", () => {
  return {
    useCoAgent: () => ({
      setState: () => undefined,
      state: {},
      running: false,
    }),
    useCopilotReadable: () => undefined,
    useCopilotAction: () => undefined,
    useHumanInTheLoop: (config: HitlConfig) => {
      hitlRegistry.set(config.name, config);
    },
  };
});

mock.module("@copilotkit/react-ui", () => {
  return {
    CopilotSidebar: ({ labels }: { labels: { title: string } }) => (
      <div data-testid="copilot-sidebar">{labels.title}</div>
    ),
  };
});

mock.module("convex/react", () => {
  return {
    useMutation: (ref: unknown) => {
      const key = String(ref);
      const entry = mutationSpyRegistry.get(key);
      if (!entry) {
        throw new Error(`No mutation spy registered for ${key}`);
      }
      return entry.fn;
    },
  };
});

const buildNode = (id: string, imageUrl?: string): StoryNode => {
  const data: StoryNodeData = {
    label: `Node ${id}`,
    segment: "A cinematic beat in the alleyway.",
    nodeType: "scene",
    entityRefs: {
      characterIds: imageUrl ? ["char_1"] : [],
    },
    continuity: {
      identityLockVersion: 1,
      wardrobeVariantIds: imageUrl ? ["wardrobe_A"] : [],
      consistencyStatus: "ok",
    },
    historyContext: {
      eventIds: [],
      rollingSummary: "The hero escaped and enters a crowded alley.",
      tokenBudgetUsed: 100,
      lineageHash: "ln_node",
    },
    promptPack: {
      continuityDirectives: [],
    },
    media: {
      images: imageUrl
        ? [
            {
              id: "img_existing",
              kind: "image",
              url: imageUrl,
              modelId: "seed",
              prompt: "existing",
              status: "completed",
              createdAt: Date.now(),
            },
          ]
        : [],
      videos: [],
    },
    image: imageUrl,
    imageHistory: imageUrl ? [imageUrl] : [],
  };
  return {
    id,
    type: "custom",
    position: { x: 0, y: 0 },
    data,
  };
};

const createGraph = (): { nodes: StoryNode[]; edges: StoryEdge[] } => ({
  nodes: [buildNode("node_1", "https://img.example/base.png"), buildNode("node_2")],
  edges: [{ id: "e1", source: "node_1", target: "node_2" } as StoryEdge],
});

const runtimeTeam: RuntimeResolvedTeam = {
  teamId: "producer_guarded_default",
  teamName: "Producer Guarded Default",
  revisionId: "producer_guarded_default:v1",
  version: 1,
  teamGoal: "Deliver safe storyboard proposals with strict HITL.",
  members: [],
  toolAllowlist: ["graph.patch", "media.prompt", "media.image.generate", "media.video.generate", "execution.plan"],
  resourceScopes: ["storyboard.graph", "storyboard.context", "media.apis"],
  runtimePolicy: {
    requiresHitl: true,
    riskThresholds: {
      warnAt: "medium",
      blockAt: "high",
    },
    maxBatchSize: 12,
    quotaProfileId: "default_standard",
    maxRunOps: 24,
    maxConcurrentRuns: 2,
    quotaEnforced: true,
    dailyMediaBudget: 20,
    dailyMutationOps: 120,
  },
};

describe("StoryboardCopilotBridge UI integration", () => {
  const originalFetch = globalThis.fetch;
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
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

    process.env.NEXT_PUBLIC_API_URL = "http://api.local";
    hitlRegistry.clear();
    setupMutationSpies();
    cleanup();
  });

  afterEach(() => {
    cleanup();
    hitlRegistry.clear();
    mutationSpyRegistry.clear();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: originalDocument, configurable: true });
    Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true });
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalActFlag;
  });

  it("wires approve_graph_patch card approve button to full execution chain", async () => {
    const { StoryboardCopilotBridge } = await import("@/components/storyboard/StoryboardCopilotBridge");
    const { nodes, edges } = createGraph();

    render(
      <StoryboardCopilotBridge
        storyboardId="storyboard_1"
        nodes={nodes}
        edges={edges}
        approvals={[]}
        mode="graph_studio"
        runtimeResolvedTeam={runtimeTeam}
        userIdentity={null}
      />,
    );

    const hitl = hitlRegistry.get("approve_graph_patch");
    expect(hitl).toBeDefined();
    if (!hitl) {
      throw new Error("approve_graph_patch not registered");
    }

    const responses: Record<string, unknown>[] = [];
    const card = hitl.render({
      status: "executing",
      args: {
        patchId: "patch_1",
        title: "Add branch",
        rationale: "Need alternate path",
        diffSummary: "Create one branch node.",
        operations: [
          {
            op: "create_node",
            nodeId: "branch_1",
            nodeType: "branch",
            label: "Parallel path",
            segment: "Alternative story starts",
            position: { x: 100, y: 200 },
          },
        ],
      },
      respond: (payload) => {
        responses.push(payload);
      },
    });

    const cardView = render(card);
    fireEvent.click(cardView.getByText("Approve"));

    await waitFor(() => {
      expect(responses.length).toBe(1);
    });

    const response = responses[0];
    expect(response.approved).toBe(true);
    expect(mutationSpyRegistry.get("approvals:createTask")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("approvals:resolveTask")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("storyboards:applyGraphPatch")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("storyboards:recordStoryEvent")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("storyboards:refreshNodeHistoryContexts")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("agentRuns:startRun")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("agentRuns:finishRun")?.calls.length).toBe(1);
  });

  it("wires approve_media_prompt card approve button to full media execution chain", async () => {
    const { StoryboardCopilotBridge } = await import("@/components/storyboard/StoryboardCopilotBridge");
    const { nodes, edges } = createGraph();

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (url.endsWith("/api/storyboard/media-proxy")) {
        const endpoint = String(body.endpoint ?? "");
        const payload = typeof body.payload === "object" && body.payload !== null
          ? body.payload as Record<string, unknown>
          : {};
        if (endpoint === "/api/image/compose") {
          expect(Array.isArray(payload.input_images)).toBe(true);
          return new Response(
            JSON.stringify({
              status: 200,
              ok: true,
              data: {
                id: "img_1",
                model: "gpt-image-1",
                images: [{ url: "https://img.example/generated.png" }],
              },
            }),
            { status: 200 },
          );
        }
        if (endpoint === "/api/consistency/evaluate") {
          return new Response(
            JSON.stringify({
              status: 200,
              ok: true,
              data: {
                identity_score: 0.95,
                consistency_score: 0.94,
                wardrobe_compliance: "matching",
              },
            }),
            { status: 200 },
          );
        }
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    render(
      <StoryboardCopilotBridge
        storyboardId="storyboard_1"
        nodes={nodes}
        edges={edges}
        approvals={[]}
        mode="graph_studio"
        runtimeResolvedTeam={runtimeTeam}
        userIdentity={null}
      />,
    );

    const hitl = hitlRegistry.get("approve_media_prompt");
    expect(hitl).toBeDefined();
    if (!hitl) {
      throw new Error("approve_media_prompt not registered");
    }

    const responses: Record<string, unknown>[] = [];
    const card = hitl.render({
      status: "executing",
      args: {
        nodeId: "node_1",
        mediaType: "image",
        prompt: "Cinematic neon still",
        negativePrompt: "identity drift",
        contextSummary: "Rolling context summary",
      },
      respond: (payload) => {
        responses.push(payload);
      },
    });

    const cardView = render(card);
    fireEvent.click(cardView.getByText("Approve Prompt"));

    await waitFor(() => {
      expect(responses.length).toBe(1);
    });

    const response = responses[0];
    expect(response.approved).toBe(true);
    expect(mutationSpyRegistry.get("approvals:createTask")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("approvals:resolveTask")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("mediaAssets:createMediaAsset")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("storyboards:compileNodePromptPack")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("storyboards:recordStoryEvent")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("storyboards:refreshNodeHistoryContexts")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("agentRuns:startRun")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("agentRuns:finishRun")?.calls.length).toBe(1);
  });

  it("wires approve_execution_plan card approve button to dry-run + commit chain", async () => {
    const { StoryboardCopilotBridge } = await import("@/components/storyboard/StoryboardCopilotBridge");
    const { nodes, edges } = createGraph();

    render(
      <StoryboardCopilotBridge
        storyboardId="storyboard_1"
        nodes={nodes}
        edges={edges}
        approvals={[]}
        mode="graph_studio"
        runtimeResolvedTeam={runtimeTeam}
        userIdentity={null}
      />,
    );

    const hitl = hitlRegistry.get("approve_execution_plan");
    expect(hitl).toBeDefined();
    if (!hitl) {
      throw new Error("approve_execution_plan not registered");
    }

    const responses: Record<string, unknown>[] = [];
    const card = hitl.render({
      status: "executing",
      args: {
        planId: "plan_1",
        storyboardId: "storyboard_1",
        branchId: "main",
        title: "Apply plan",
        rationale: "Need safe multi-op apply",
        operations: [
          {
            opId: "op_1",
            op: "create_node",
            title: "Create branch node",
            rationale: "Add divergence",
            nodeId: "branch_1",
            requiresHitl: true,
            payload: {
              nodeType: "branch",
              label: "Parallel path",
              segment: "Alternative branch",
              position: { x: 120, y: 240 },
            },
          },
        ],
        dryRun: {
          valid: true,
          riskLevel: "low",
          summary: "Dry-run passed.",
          issues: [],
          estimatedTotalCost: 0.18,
          estimatedDurationSec: 1.6,
          planHash: "plan_hash_1",
        },
      },
      respond: (payload) => {
        responses.push(payload);
      },
    });

    const cardView = render(card);
    fireEvent.click(cardView.getByText("Approve"));

    await waitFor(() => {
      expect(responses.length).toBe(1);
    });

    expect(mutationSpyRegistry.get("narrativeGit:simulateExecutionPlan")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("narrativeGit:commitPlanOps")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("approvals:createTask")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("approvals:resolveTask")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("storyboards:recordStoryEvent")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("agentRuns:startRun")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("agentRuns:finishRun")?.calls.length).toBe(1);
  });

  it("renders simulation critic preview card and continues to approve_batch_ops payload", async () => {
    const { StoryboardCopilotBridge } = await import("@/components/storyboard/StoryboardCopilotBridge");
    const { nodes, edges } = createGraph();

    render(
      <StoryboardCopilotBridge
        storyboardId="storyboard_1"
        nodes={nodes}
        edges={edges}
        approvals={[]}
        mode="graph_studio"
        runtimeResolvedTeam={runtimeTeam}
        userIdentity={null}
      />,
    );

    const hitl = hitlRegistry.get("preview_simulation_critic_plan");
    expect(hitl).toBeDefined();
    if (!hitl) {
      throw new Error("preview_simulation_critic_plan not registered");
    }

    const responses: Record<string, unknown>[] = [];
    const card = hitl.render({
      status: "executing",
      args: {
        simulationRunId: "sim_1",
        storyboardId: "storyboard_1",
        branchId: "main",
        summary: "Simulation critic found pacing and causality risks.",
        riskLevel: "high",
        confidence: 0.78,
        impactScore: 0.67,
        issues: [
          {
            code: "SIM_PACING_DENSITY",
            severity: "medium",
            message: "Event density is too high for emotional readability.",
            suggestedFix: "Insert bridge beat before climax.",
          },
        ],
        executionPlan: {
          planId: "critic_plan_1",
          storyboardId: "storyboard_1",
          branchId: "main",
          title: "Simulation Critic Repair Batch",
          rationale: "Repair pacing and causality",
          operations: [
            {
              opId: "op_critic_1",
              op: "update_node",
              nodeId: "node_2",
              title: "Repair pacing",
              payload: { suggestedFix: "Add transition shot" },
            },
          ],
          dryRun: {
            valid: true,
            riskLevel: "medium",
            summary: "Dry-run completed.",
            issues: [],
            estimatedTotalCost: 0.15,
            estimatedDurationSec: 1.8,
            planHash: "critic_hash_1",
          },
        },
      },
      respond: (payload) => {
        responses.push(payload);
      },
    });

    const cardView = render(card);
    fireEvent.click(cardView.getByText("Continue to Batch Approval"));

    await waitFor(() => {
      expect(responses.length).toBe(1);
    });

    expect(responses[0]?.approved).toBe(true);
    expect(responses[0]?.nextAction).toBe("approve_batch_ops");
    expect(mutationSpyRegistry.get("approvals:createTask")?.calls.length).toBe(0);
    expect(mutationSpyRegistry.get("narrativeGit:commitPlanOps")?.calls.length).toBe(0);
  });

  it("wires approve_dailies_batch card approve selected button to batch execution + dailies status", async () => {
    const { StoryboardCopilotBridge } = await import("@/components/storyboard/StoryboardCopilotBridge");
    const { nodes, edges } = createGraph();

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/api/storyboard/media-proxy")) {
        return new Response(
          JSON.stringify({
            status: 200,
            ok: true,
            data: {
              images: [{ url: "https://img.example/dailies_batch.png" }],
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    render(
      <StoryboardCopilotBridge
        storyboardId="storyboard_1"
        nodes={nodes}
        edges={edges}
        approvals={[]}
        mode="graph_studio"
        runtimeResolvedTeam={runtimeTeam}
        userIdentity={null}
      />,
    );

    const hitl = hitlRegistry.get("approve_dailies_batch");
    expect(hitl).toBeDefined();
    if (!hitl) {
      throw new Error("approve_dailies_batch not registered");
    }

    const responses: Record<string, unknown>[] = [];
    const card = hitl.render({
      status: "executing",
      args: {
        planId: "daily_plan_1",
        storyboardId: "storyboard_1",
        branchId: "main",
        title: "Autonomous Dailies Batch",
        rationale: "Apply selected dailies operations",
        sourceId: "reel_1",
        operations: [
          {
            opId: "op_1",
            op: "create_node",
            nodeId: "bridge_1",
            title: "Bridge scene",
            payload: {
              nodeType: "scene",
              label: "Bridge Scene",
              segment: "Continuity bridge",
              position: { x: 80, y: 120 },
            },
          },
          {
            opId: "op_2",
            op: "generate_image",
            nodeId: "node_2",
            title: "Generate missing daily clip",
            payload: {
              prompt: "Cinematic still for daily cut",
            },
          },
        ],
        dryRun: {
          valid: true,
          riskLevel: "medium",
          summary: "Dailies plan review",
          issues: [],
          estimatedTotalCost: 0.44,
          estimatedDurationSec: 4.1,
          planHash: "daily_hash_1",
        },
      },
      respond: (payload) => {
        responses.push(payload);
      },
    });

    const cardView = render(card);
    fireEvent.click(cardView.getByText("Approve Selected"));

    await waitFor(() => {
      expect(responses.length).toBe(1);
    });

    expect(mutationSpyRegistry.get("narrativeGit:simulateExecutionPlan")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("narrativeGit:commitPlanOps")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("mediaAssets:createMediaAsset")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("dailies:updateDailiesStatus")?.calls.length).toBe(1);
  });

  it("wires approve_merge_policy card approve button to merge execution mutation", async () => {
    const { StoryboardCopilotBridge } = await import("@/components/storyboard/StoryboardCopilotBridge");
    const { nodes, edges } = createGraph();

    render(
      <StoryboardCopilotBridge
        storyboardId="storyboard_1"
        nodes={nodes}
        edges={edges}
        approvals={[]}
        mode="graph_studio"
        runtimeResolvedTeam={runtimeTeam}
        userIdentity={null}
      />,
    );

    const hitl = hitlRegistry.get("approve_merge_policy");
    expect(hitl).toBeDefined();
    if (!hitl) {
      throw new Error("approve_merge_policy not registered");
    }

    const responses: Record<string, unknown>[] = [];
    const card = hitl.render({
      status: "executing",
      args: {
        branchId: "main",
        sourceBranchId: "branch_alt",
        targetBranchId: "main",
        policy: "prefer_target_on_conflict",
      },
      respond: (payload) => {
        responses.push(payload);
      },
    });

    const cardView = render(card);
    fireEvent.click(cardView.getByText("Approve"));

    await waitFor(() => {
      expect(responses.length).toBe(1);
    });

    expect(mutationSpyRegistry.get("narrativeGit:applyMergePolicy")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("approvals:createTask")?.calls.length).toBe(1);
    expect(mutationSpyRegistry.get("approvals:resolveTask")?.calls.length).toBe(1);
  });

  it("wires select_agent_team card approve button to assignment mutation", async () => {
    const { StoryboardCopilotBridge } = await import("@/components/storyboard/StoryboardCopilotBridge");
    const { nodes, edges } = createGraph();

    render(
      <StoryboardCopilotBridge
        storyboardId="storyboard_1"
        nodes={nodes}
        edges={edges}
        approvals={[]}
        mode="graph_studio"
        runtimeResolvedTeam={runtimeTeam}
        userIdentity={null}
      />,
    );

    const hitl = hitlRegistry.get("select_agent_team");
    expect(hitl).toBeDefined();
    if (!hitl) {
      throw new Error("select_agent_team not registered");
    }

    const responses: Record<string, unknown>[] = [];
    const card = hitl.render({
      status: "executing",
      args: {
        teamId: "continuity_first",
        revisionId: "continuity_first:v1",
      },
      respond: (payload) => {
        responses.push(payload);
      },
    });

    const cardView = render(card);
    fireEvent.click(cardView.getByText("Approve"));

    await waitFor(() => {
      expect(responses.length).toBe(1);
    });

    expect(responses[0]?.approved).toBe(true);
    expect(mutationSpyRegistry.get("agentTeams:assignTeamToStoryboard")?.calls.length).toBe(1);
  });
});
