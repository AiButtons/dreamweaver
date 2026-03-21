import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { StoryEdge, StoryNode, StoryNodeData } from "@/app/storyboard/types";
import type {
  AdapterDependencies,
  ExecutionPlanInput,
  GraphPatchInput,
  GraphPatchOperation,
  MediaPromptInput,
} from "@/app/storyboard/agentExecutionAdapter";
import {
  runExecutionPlanHitlApproval,
  runGraphHitlApproval,
  runMediaHitlApproval,
} from "@/app/storyboard/testing/hitlHarness";

type MutationCall = Record<string, unknown>;
type MutationFn = (args: MutationCall) => Promise<unknown>;

type ApprovedGraphResult = {
  taskId: string;
  runId: string;
  appliedOperationCount: number;
  touchedNodeIds: string[];
  warnings: string[];
};

type ApprovedMediaResult = {
  taskId: string;
  runId: string;
  nodeId: string;
  mediaType: "image" | "video";
  mediaUrl: string;
  consistency: {
    identityScore?: number;
    consistencyScore?: number;
    wardrobeCompliance?: "matching" | "deviation" | "unknown";
  };
};

type ApprovedExecutionPlanResult = {
  planId: string;
  graphOperationCount: number;
  mediaOperationCount: number;
  mediaSuccessCount: number;
  mediaFailureCount: number;
};

const isApprovedGraphResult = (value: unknown): value is ApprovedGraphResult =>
  typeof value === "object"
  && value !== null
  && "appliedOperationCount" in value
  && "warnings" in value;

const isApprovedMediaResult = (value: unknown): value is ApprovedMediaResult =>
  typeof value === "object"
  && value !== null
  && "mediaUrl" in value
  && "consistency" in value;

const isApprovedExecutionPlanResult = (value: unknown): value is ApprovedExecutionPlanResult =>
  typeof value === "object"
  && value !== null
  && "planId" in value
  && "graphOperationCount" in value
  && "mediaOperationCount" in value;

const createMutationSpy = (
  handler?: (args: MutationCall) => unknown,
): { fn: MutationFn; calls: MutationCall[] } => {
  const calls: MutationCall[] = [];
  const fn: MutationFn = async (args) => {
    calls.push(args);
    if (handler) {
      return handler(args);
    }
    return undefined;
  };
  return { fn, calls };
};

const createNode = (id: string, imageUrl?: string): StoryNode => {
  const data: StoryNodeData = {
    label: `Node ${id}`,
    segment: `Segment ${id}`,
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
      rollingSummary: "The hero escaped and now enters a crowded alley.",
      tokenBudgetUsed: 120,
      lineageHash: `ln_${id}`,
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

const createDeps = (
  overrides?: Partial<AdapterDependencies>,
): {
  deps: AdapterDependencies;
  spies: Record<
    | "createApprovalTask"
    | "resolveApprovalTask"
    | "applyGraphPatch"
    | "recordStoryEvent"
    | "refreshNodeHistoryContexts"
    | "createMediaAsset"
    | "compileNodePromptPack"
    | "simulateExecutionPlan"
    | "commitPlanOps"
    | "rollbackToCommit"
    | "generateAutonomousDailies"
    | "updateDailiesStatus"
    | "runSimulationCritic"
    | "updateSimulationRunStatus"
    | "startAgentRun"
    | "finishAgentRun"
    | "checkAndReserveRunBudget"
    | "releaseRunBudget",
    { fn: MutationFn; calls: MutationCall[] }
  >;
} => {
  const spies = {
    createApprovalTask: createMutationSpy(() => "task_1"),
    resolveApprovalTask: createMutationSpy(() => "task_1"),
    applyGraphPatch: createMutationSpy(() => ({ touchedNodeIds: ["node_1"] })),
    recordStoryEvent: createMutationSpy(() => "event_1"),
    refreshNodeHistoryContexts: createMutationSpy(() => ({ refreshed: 1 })),
    createMediaAsset: createMutationSpy(() => "media_1"),
    compileNodePromptPack: createMutationSpy((args) => ({
      prompt: String(args.basePrompt ?? ""),
      negativePrompt: String(args.negativePrompt ?? ""),
    })),
    simulateExecutionPlan: createMutationSpy(() => ({
      valid: true,
      riskLevel: "low",
      summary: "Dry-run passed.",
      issues: [],
      estimatedTotalCost: 0.18,
      estimatedDurationSec: 1.6,
      planHash: "plan_hash_1",
    })),
    commitPlanOps: createMutationSpy(() => ({
      commitId: "commit_1",
      branchId: "main",
      operationCount: 1,
    })),
    rollbackToCommit: createMutationSpy(() => ({
      rolledBackTo: "commit_1",
      branchId: "main",
    })),
    generateAutonomousDailies: createMutationSpy(() => ({
      reelId: "reel_1",
    })),
    updateDailiesStatus: createMutationSpy(() => "reel_1"),
    runSimulationCritic: createMutationSpy(() => ({
      simulationRunId: "sim_1",
    })),
    updateSimulationRunStatus: createMutationSpy(() => "sim_1"),
    startAgentRun: createMutationSpy(() => "run_db_1"),
    finishAgentRun: createMutationSpy(() => "run_db_1"),
    checkAndReserveRunBudget: createMutationSpy(() => ({
      reserved: true,
      usage: { mediaBudgetUsed: 1, mutationOpsUsed: 1, activeRuns: 1 },
    })),
    releaseRunBudget: createMutationSpy(() => ({
      released: true,
      usage: { mediaBudgetUsed: 1, mutationOpsUsed: 1, activeRuns: 0 },
    })),
  };

  const deps: AdapterDependencies = {
    storyboardId: "storyboard_1",
    nodes: [createNode("node_1", "https://img.example/base.png"), createNode("node_2")],
    edges: [
      {
        id: "e1",
        source: "node_1",
        target: "node_2",
      } as StoryEdge,
    ],
    createApprovalTask: spies.createApprovalTask.fn,
    resolveApprovalTask: spies.resolveApprovalTask.fn,
    applyGraphPatch: spies.applyGraphPatch.fn,
    recordStoryEvent: spies.recordStoryEvent.fn,
    refreshNodeHistoryContexts: spies.refreshNodeHistoryContexts.fn,
    createMediaAsset: spies.createMediaAsset.fn,
    compileNodePromptPack: spies.compileNodePromptPack.fn,
    simulateExecutionPlan: spies.simulateExecutionPlan.fn,
    commitPlanOps: spies.commitPlanOps.fn,
    rollbackToCommit: spies.rollbackToCommit.fn,
    generateAutonomousDailies: spies.generateAutonomousDailies.fn,
    updateDailiesStatus: spies.updateDailiesStatus.fn,
    runSimulationCritic: spies.runSimulationCritic.fn,
    updateSimulationRunStatus: spies.updateSimulationRunStatus.fn,
    startAgentRun: spies.startAgentRun.fn,
    finishAgentRun: spies.finishAgentRun.fn,
    checkAndReserveRunBudget: spies.checkAndReserveRunBudget.fn,
    releaseRunBudget: spies.releaseRunBudget.fn,
    ...overrides,
  };

  return { deps, spies };
};

describe("agentExecutionAdapter integration harness", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "http://api.local";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("executes approved graph patch end-to-end with mutation chain", async () => {
    const { deps, spies } = createDeps();
    const input: GraphPatchInput = {
      patchId: "patch_1",
      title: "Add branch",
      rationale: "Need alternate timeline",
      diffSummary: "Add one branch node.",
      operations: [
        {
          op: "create_node",
          nodeId: "branch_1",
          nodeType: "branch",
          label: "Parallel path",
          segment: "Alternative path starts.",
          position: { x: 300, y: 100 },
        } satisfies GraphPatchOperation,
        {
          op: "create_node",
          nodeId: "branch_2",
          nodeType: "branch",
          label: "Should be trimmed",
          segment: "Trimmed",
          position: { x: 350, y: 100 },
        } satisfies GraphPatchOperation,
      ],
    };

    const result = await runGraphHitlApproval(deps, input, { approved: true });

    expect(isApprovedGraphResult(result)).toBe(true);
    if (!isApprovedGraphResult(result)) {
      throw new Error("Expected approved graph result");
    }
    expect(result.appliedOperationCount).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.taskId).toBe("task_1");

    expect(spies.createApprovalTask.calls.length).toBe(1);
    expect(typeof spies.createApprovalTask.calls[0]?.dedupeKey).toBe("string");
    expect(spies.resolveApprovalTask.calls.length).toBe(1);
    expect(spies.applyGraphPatch.calls.length).toBe(1);
    expect(spies.recordStoryEvent.calls.length).toBe(1);
    expect(spies.recordStoryEvent.calls[0]?.eventType).toBe("node_edit");
    expect(spies.refreshNodeHistoryContexts.calls.length).toBe(1);
    expect(spies.startAgentRun.calls.length).toBe(1);
    expect(spies.finishAgentRun.calls.length).toBe(1);
  });

  it("executes rejected graph patch without applying mutations", async () => {
    const { deps, spies } = createDeps();
    const input: GraphPatchInput = {
      patchId: "patch_reject",
      title: "Reject me",
      rationale: "Producer rejected",
      diffSummary: "No-op",
      operations: [],
    };

    const result = await runGraphHitlApproval(deps, input, { approved: false });
    expect("taskId" in result).toBe(true);
    expect(spies.createApprovalTask.calls.length).toBe(1);
    expect(spies.resolveApprovalTask.calls.length).toBe(1);
    expect(spies.applyGraphPatch.calls.length).toBe(0);
    expect(spies.startAgentRun.calls.length).toBe(0);
    expect(spies.finishAgentRun.calls.length).toBe(0);
  });

  it("records merge patches as branch_merge events", async () => {
    const { deps, spies } = createDeps();
    const input: GraphPatchInput = {
      patchId: "patch_merge",
      title: "Merge branches",
      rationale: "Converge alternate timelines",
      diffSummary: "Create one merge edge.",
      operations: [
        {
          op: "create_edge",
          edgeId: "edge_merge_1",
          sourceNodeId: "node_1",
          targetNodeId: "node_2",
          edgeType: "merge",
          isPrimary: true,
        } satisfies GraphPatchOperation,
      ],
    };

    await runGraphHitlApproval(deps, input, { approved: true });
    expect(spies.recordStoryEvent.calls.length).toBe(1);
    expect(spies.recordStoryEvent.calls[0]?.eventType).toBe("branch_merge");
  });

  it("executes approved image prompt end-to-end with compose + consistency + persistence", async () => {
    const { deps, spies } = createDeps();

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
                id: "img_job_1",
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
                identity_score: 0.94,
                consistency_score: 0.93,
                wardrobe_compliance: "matching",
              },
            }),
            { status: 200 },
          );
        }
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const input: MediaPromptInput = {
      nodeId: "node_1",
      mediaType: "image",
      prompt: "A cinematic still with rain and neon.",
      negativePrompt: "identity drift",
      contextSummary: "Prior events summary",
    };

    const result = await runMediaHitlApproval(deps, input, {
      approved: true,
      prompt: "Edited prompt",
      negativePrompt: "edited negative",
    });

    expect(isApprovedMediaResult(result)).toBe(true);
    if (!isApprovedMediaResult(result)) {
      throw new Error("Expected approved media result");
    }
    expect(result.mediaUrl).toBe("https://img.example/generated.png");
    expect(result.consistency.identityScore).toBe(0.94);

    expect(spies.createApprovalTask.calls.length).toBe(1);
    expect(typeof spies.createApprovalTask.calls[0]?.dedupeKey).toBe("string");
    expect(spies.resolveApprovalTask.calls.length).toBe(1);
    expect(spies.createMediaAsset.calls.length).toBe(1);
    expect(spies.compileNodePromptPack.calls.length).toBe(1);
    expect(spies.recordStoryEvent.calls.length).toBe(1);
    expect(spies.refreshNodeHistoryContexts.calls.length).toBe(1);
    expect(spies.startAgentRun.calls.length).toBe(1);
    expect(spies.finishAgentRun.calls.length).toBe(1);
  });

  it("executes approved video prompt with video generation + persistence", async () => {
    const { deps, spies } = createDeps();

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (url.endsWith("/api/storyboard/media-proxy") && body.endpoint === "/api/video/generate") {
        return new Response(
          JSON.stringify({
            status: 200,
            ok: true,
            data: {
              url: "https://video.example/generated.mp4",
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const input: MediaPromptInput = {
      nodeId: "node_2",
      mediaType: "video",
      prompt: "Dolly shot through the corridor.",
      negativePrompt: "artifacts",
      contextSummary: "Prior events summary",
    };

    const result = await runMediaHitlApproval(deps, input, { approved: true });

    expect(isApprovedMediaResult(result)).toBe(true);
    if (!isApprovedMediaResult(result)) {
      throw new Error("Expected approved media result");
    }
    expect(result.mediaUrl).toBe("https://video.example/generated.mp4");

    expect(spies.createApprovalTask.calls.length).toBe(1);
    expect(spies.resolveApprovalTask.calls.length).toBe(1);
    expect(spies.createMediaAsset.calls.length).toBe(1);
    expect(spies.compileNodePromptPack.calls.length).toBe(1);
    expect(spies.recordStoryEvent.calls.length).toBe(1);
    expect(spies.refreshNodeHistoryContexts.calls.length).toBe(1);
    expect(spies.startAgentRun.calls.length).toBe(1);
    expect(spies.finishAgentRun.calls.length).toBe(1);
  });

  it("rejects empty approved media prompt before mutations", async () => {
    const { deps, spies } = createDeps();
    const input: MediaPromptInput = {
      nodeId: "node_2",
      mediaType: "video",
      prompt: "   ",
      negativePrompt: "artifacts",
      contextSummary: "Prior events summary",
    };

    await expect(runMediaHitlApproval(deps, input, { approved: true })).rejects.toThrow(
      "Prompt cannot be empty",
    );
    expect(spies.createApprovalTask.calls.length).toBe(0);
    expect(spies.startAgentRun.calls.length).toBe(0);
    expect(spies.finishAgentRun.calls.length).toBe(0);
  });

  it("executes approved execution plan with dry-run + commit", async () => {
    const { deps, spies } = createDeps();
    const input: ExecutionPlanInput = {
      planId: "plan_1",
      storyboardId: "storyboard_1",
      branchId: "main",
      title: "Apply branch + shot plan",
      rationale: "Expand sequence safely",
      operations: [
        {
          opId: "op_1",
          op: "create_node",
          title: "Create branch node",
          rationale: "Introduce alternate path",
          nodeId: "branch_1",
          requiresHitl: true,
          payload: {
            nodeType: "branch",
            label: "Parallel path",
            segment: "Alternative branch starts here",
            position: { x: 120, y: 300 },
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
    };

    const result = await runExecutionPlanHitlApproval(deps, input, { approved: true });
    expect("commitId" in result).toBe(true);
    if (!("commitId" in result)) {
      throw new Error("Expected execution plan result");
    }
    expect(result.commitId).toBe("commit_1");
    expect(spies.simulateExecutionPlan.calls.length).toBe(1);
    expect(spies.commitPlanOps.calls.length).toBe(1);
    expect(spies.createApprovalTask.calls.length).toBe(1);
    expect(spies.resolveApprovalTask.calls.length).toBe(1);
    expect(spies.recordStoryEvent.calls.length).toBe(1);
    expect(spies.refreshNodeHistoryContexts.calls.length).toBe(1);
  });

  it("executes autonomous dailies mixed batch (graph + media) and marks reel applied", async () => {
    const { deps, spies } = createDeps();
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (url.endsWith("/api/storyboard/media-proxy")) {
        const endpoint = String(body.endpoint ?? "");
        if (endpoint === "/api/image/compose" || endpoint === "/api/image/generate") {
          return new Response(
            JSON.stringify({
              status: 200,
              ok: true,
              data: {
                images: [{ url: "https://img.example/dailies_frame.png" }],
              },
            }),
            { status: 200 },
          );
        }
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const input: ExecutionPlanInput = {
      planId: "daily_plan_1",
      storyboardId: "storyboard_1",
      branchId: "main",
      title: "Autonomous Dailies Batch",
      rationale: "Generate missing clips and apply continuity graph tweak",
      source: "dailies",
      sourceId: "reel_1",
      taskType: "dailies_batch",
      operations: [
        {
          opId: "op_graph_1",
          op: "create_node",
          title: "Create bridge node",
          rationale: "Continuity bridge",
          nodeId: "bridge_1",
          requiresHitl: true,
          payload: {
            nodeType: "scene",
            label: "Bridge Scene",
            segment: "Bridges daily reel continuity",
            position: { x: 60, y: 90 },
          },
        },
        {
          opId: "op_media_1",
          op: "generate_image",
          title: "Generate daily frame",
          rationale: "Missing clip coverage",
          nodeId: "node_2",
          requiresHitl: true,
          payload: {
            prompt: "Cinematic still of the next beat",
            negativePrompt: "identity drift",
            modelId: "gpt-image-1",
          },
        },
      ],
    };

    const result = await runExecutionPlanHitlApproval(deps, input, { approved: true });
    expect(isApprovedExecutionPlanResult(result)).toBe(true);
    if (!isApprovedExecutionPlanResult(result)) {
      throw new Error("Expected batch result");
    }
    expect(result.graphOperationCount).toBe(1);
    expect(result.mediaOperationCount).toBe(1);
    expect(result.mediaSuccessCount).toBe(1);
    expect(result.mediaFailureCount).toBe(0);
    expect(spies.simulateExecutionPlan.calls.length).toBe(1);
    expect(spies.commitPlanOps.calls.length).toBe(1);
    expect(spies.createMediaAsset.calls.length).toBe(1);
    expect(spies.updateDailiesStatus.calls.length).toBe(1);
    expect(spies.updateDailiesStatus.calls[0]?.status).toBe("applied");
  });

  it("rejects simulation critic batch and marks simulation run rejected", async () => {
    const { deps, spies } = createDeps();
    const input: ExecutionPlanInput = {
      planId: "critic_plan_1",
      storyboardId: "storyboard_1",
      branchId: "main",
      title: "Simulation Critic Batch",
      rationale: "Repair pacing concerns",
      source: "simulation_critic",
      sourceId: "sim_1",
      taskType: "simulation_critic_batch",
      operations: [
        {
          opId: "op_critic_1",
          op: "update_node",
          title: "Repair pacing",
          rationale: "Adjust shot transition",
          nodeId: "node_2",
          requiresHitl: true,
        },
      ],
    };

    const result = await runExecutionPlanHitlApproval(deps, input, { approved: false });
    expect("taskId" in result).toBe(true);
    expect(spies.updateSimulationRunStatus.calls.length).toBe(1);
    expect(spies.updateSimulationRunStatus.calls[0]?.status).toBe("rejected");
    expect(spies.commitPlanOps.calls.length).toBe(0);
  });

  it("enforces team tool allowlist and quota reservation for approved media prompts", async () => {
    const { deps, spies } = createDeps({
      runtimeResolvedTeam: {
        teamId: "producer_guarded_default",
        teamName: "Producer Guarded Default",
        revisionId: "producer_guarded_default:v1",
        version: 1,
        teamGoal: "Goal",
        members: [],
        toolAllowlist: ["graph.patch"],
        resourceScopes: ["storyboard.graph"],
        runtimePolicy: {
          requiresHitl: true,
          riskThresholds: { warnAt: "medium", blockAt: "high" },
          maxBatchSize: 4,
          quotaProfileId: "default_standard",
          maxRunOps: 24,
          maxConcurrentRuns: 2,
          quotaEnforced: true,
          dailyMediaBudget: 20,
          dailyMutationOps: 120,
        },
      },
    });
    const input: MediaPromptInput = {
      nodeId: "node_1",
      mediaType: "image",
      prompt: "A cinematic still with rain and neon.",
      negativePrompt: "identity drift",
      contextSummary: "Prior events summary",
    };

    await expect(runMediaHitlApproval(deps, input, { approved: true })).rejects.toThrow(
      "Media execution denied by tool allowlist",
    );
    expect(spies.checkAndReserveRunBudget.calls.length).toBe(0);
    expect(spies.releaseRunBudget.calls.length).toBe(0);
  });

  it("reserves and releases quota when runtime team policy enforces quotas", async () => {
    const { deps, spies } = createDeps({
      runtimeResolvedTeam: {
        teamId: "producer_guarded_default",
        teamName: "Producer Guarded Default",
        revisionId: "producer_guarded_default:v1",
        version: 1,
        teamGoal: "Goal",
        members: [],
        toolAllowlist: ["graph.patch", "media.image.generate", "media.video.generate"],
        resourceScopes: ["storyboard.graph", "media.apis"],
        runtimePolicy: {
          requiresHitl: true,
          riskThresholds: { warnAt: "medium", blockAt: "high" },
          maxBatchSize: 4,
          quotaProfileId: "default_standard",
          maxRunOps: 24,
          maxConcurrentRuns: 2,
          quotaEnforced: true,
          dailyMediaBudget: 20,
          dailyMutationOps: 120,
        },
      },
    });

    const input: GraphPatchInput = {
      patchId: "patch_quota",
      title: "Add branch",
      rationale: "Need alternate timeline",
      diffSummary: "Add one branch node.",
      operations: [
        {
          op: "create_node",
          nodeId: "branch_quota_1",
          nodeType: "branch",
          label: "Parallel path",
          segment: "Alternative path starts.",
          position: { x: 300, y: 100 },
        } satisfies GraphPatchOperation,
      ],
    };

    const result = await runGraphHitlApproval(deps, input, { approved: true });
    expect(isApprovedGraphResult(result)).toBe(true);
    expect(spies.checkAndReserveRunBudget.calls.length).toBe(1);
    expect(spies.releaseRunBudget.calls.length).toBe(1);
  });
});
