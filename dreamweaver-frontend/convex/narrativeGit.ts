import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureStoryboardEditable, ensureStoryboardOwner, requireUser } from "./storyboardAccess";

const nodeType = v.union(
  v.literal("scene"),
  v.literal("shot"),
  v.literal("branch"),
  v.literal("merge"),
  v.literal("character_ref"),
  v.literal("background_ref"),
);

const edgeType = v.union(
  v.literal("serial"),
  v.literal("parallel"),
  v.literal("branch"),
  v.literal("merge"),
);

const executionOperation = v.object({
  op: v.union(
    v.literal("create_node"),
    v.literal("update_node"),
    v.literal("delete_node"),
    v.literal("create_edge"),
    v.literal("update_edge"),
    v.literal("delete_edge"),
    v.literal("generate_image"),
    v.literal("generate_video"),
  ),
  opId: v.optional(v.string()),
  title: v.optional(v.string()),
  rationale: v.optional(v.string()),
  nodeId: v.optional(v.string()),
  edgeId: v.optional(v.string()),
  nodeType: v.optional(nodeType),
  label: v.optional(v.string()),
  segment: v.optional(v.string()),
  position: v.optional(v.object({ x: v.number(), y: v.number() })),
  sourceNodeId: v.optional(v.string()),
  targetNodeId: v.optional(v.string()),
  edgeType: v.optional(edgeType),
  branchId: v.optional(v.string()),
  order: v.optional(v.number()),
  isPrimary: v.optional(v.boolean()),
});

type GraphNodeSnapshot = {
  nodeId: string;
  nodeType: "scene" | "shot" | "branch" | "merge" | "character_ref" | "background_ref";
  label: string;
  segment: string;
  position: { x: number; y: number };
};

type GraphEdgeSnapshot = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: "serial" | "parallel" | "branch" | "merge";
  branchId?: string;
  order?: number;
  isPrimary: boolean;
};

const hashString = (raw: string) => {
  let hash = 5381;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 33) ^ raw.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
};

const toNodeDefaults = (
  now: number,
  node: GraphNodeSnapshot,
) => ({
  nodeId: node.nodeId,
  nodeType: node.nodeType,
  label: node.label,
  segment: node.segment,
  position: node.position,
  entityRefs: {
    characterIds: [] as string[],
  },
  continuity: {
    identityLockVersion: 1,
    wardrobeVariantIds: [] as string[],
    consistencyStatus: "ok" as const,
  },
  historyContext: {
    eventIds: [] as string[],
    rollingSummary: "",
    tokenBudgetUsed: 0,
    lineageHash: "",
  },
  promptPack: {
    continuityDirectives: [] as string[],
  },
  media: {
    images: [] as Array<{ mediaAssetId: string; url: string; modelId: string; createdAt: number }>,
    videos: [] as Array<{ mediaAssetId: string; url: string; modelId: string; createdAt: number }>,
  },
  status: "draft" as const,
  createdAt: now,
  updatedAt: now,
});

const captureSnapshot = async (
  ctx: {
    db: {
      query: (table: string) => {
        withIndex: (
          index: string,
          cb: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => { collect: () => Promise<Array<Record<string, unknown>>> };
      };
    };
  },
  storyboardId: string,
) => {
  const [nodesRaw, edgesRaw] = await Promise.all([
    ctx.db
      .query("storyboardNodes")
      .withIndex("by_storyboard_updatedAt", (q) => q.eq("storyboardId", storyboardId))
      .collect(),
    ctx.db
      .query("storyboardEdges")
      .withIndex("by_storyboard_edge", (q) => q.eq("storyboardId", storyboardId))
      .collect(),
  ]);

  const nodes: GraphNodeSnapshot[] = nodesRaw.map((row) => ({
    nodeId: String(row.nodeId),
    nodeType: row.nodeType as GraphNodeSnapshot["nodeType"],
    label: String(row.label),
    segment: String(row.segment),
    position: {
      x: Number((row.position as { x?: number })?.x ?? 0),
      y: Number((row.position as { y?: number })?.y ?? 0),
    },
  }));
  const edges: GraphEdgeSnapshot[] = edgesRaw.map((row) => ({
    edgeId: String(row.edgeId),
    sourceNodeId: String(row.sourceNodeId),
    targetNodeId: String(row.targetNodeId),
    edgeType: row.edgeType as GraphEdgeSnapshot["edgeType"],
    branchId: typeof row.branchId === "string" ? row.branchId : undefined,
    order: typeof row.order === "number" ? row.order : undefined,
    isPrimary: Boolean(row.isPrimary),
  }));

  return { nodes, edges };
};

const applyOpsToSnapshot = (
  snapshot: { nodes: GraphNodeSnapshot[]; edges: GraphEdgeSnapshot[] },
  operations: Array<{
    op: string;
    nodeId?: string;
    edgeId?: string;
    nodeType?: GraphNodeSnapshot["nodeType"];
    label?: string;
    segment?: string;
    position?: { x: number; y: number };
    sourceNodeId?: string;
    targetNodeId?: string;
    edgeType?: GraphEdgeSnapshot["edgeType"];
    branchId?: string;
    order?: number;
    isPrimary?: boolean;
  }>,
) => {
  const nodes = new Map(snapshot.nodes.map((node) => [node.nodeId, node]));
  const edges = new Map(snapshot.edges.map((edge) => [edge.edgeId, edge]));
  const issues: Array<{ code: string; severity: "low" | "medium" | "high" | "critical"; message: string }> = [];

  for (const operation of operations) {
    if (operation.op === "create_node") {
      if (!operation.nodeId || !operation.nodeType || !operation.label || !operation.segment || !operation.position) {
        issues.push({ code: "INVALID_CREATE_NODE", severity: "high", message: "create_node missing required fields" });
        continue;
      }
      nodes.set(operation.nodeId, {
        nodeId: operation.nodeId,
        nodeType: operation.nodeType,
        label: operation.label,
        segment: operation.segment,
        position: operation.position,
      });
      continue;
    }

    if (operation.op === "update_node") {
      if (!operation.nodeId || !nodes.has(operation.nodeId)) {
        issues.push({ code: "UPDATE_NODE_NOT_FOUND", severity: "high", message: "update_node target not found" });
        continue;
      }
      const current = nodes.get(operation.nodeId)!;
      nodes.set(operation.nodeId, {
        nodeId: current.nodeId,
        nodeType: operation.nodeType ?? current.nodeType,
        label: operation.label ?? current.label,
        segment: operation.segment ?? current.segment,
        position: operation.position ?? current.position,
      });
      continue;
    }

    if (operation.op === "delete_node") {
      if (!operation.nodeId) {
        issues.push({ code: "DELETE_NODE_INVALID", severity: "high", message: "delete_node missing nodeId" });
        continue;
      }
      nodes.delete(operation.nodeId);
      for (const [edgeId, edge] of edges.entries()) {
        if (edge.sourceNodeId === operation.nodeId || edge.targetNodeId === operation.nodeId) {
          edges.delete(edgeId);
        }
      }
      continue;
    }

    if (operation.op === "create_edge") {
      if (!operation.edgeId || !operation.sourceNodeId || !operation.targetNodeId || !operation.edgeType) {
        issues.push({ code: "INVALID_CREATE_EDGE", severity: "high", message: "create_edge missing required fields" });
        continue;
      }
      if (!nodes.has(operation.sourceNodeId) || !nodes.has(operation.targetNodeId)) {
        issues.push({ code: "CREATE_EDGE_NODE_MISSING", severity: "high", message: "create_edge references missing node" });
        continue;
      }
      edges.set(operation.edgeId, {
        edgeId: operation.edgeId,
        sourceNodeId: operation.sourceNodeId,
        targetNodeId: operation.targetNodeId,
        edgeType: operation.edgeType,
        branchId: operation.branchId,
        order: operation.order,
        isPrimary: operation.isPrimary ?? false,
      });
      continue;
    }

    if (operation.op === "update_edge") {
      if (!operation.edgeId || !edges.has(operation.edgeId)) {
        issues.push({ code: "UPDATE_EDGE_NOT_FOUND", severity: "high", message: "update_edge target not found" });
        continue;
      }
      const current = edges.get(operation.edgeId)!;
      const nextSource = operation.sourceNodeId ?? current.sourceNodeId;
      const nextTarget = operation.targetNodeId ?? current.targetNodeId;
      if (!nodes.has(nextSource) || !nodes.has(nextTarget)) {
        issues.push({ code: "UPDATE_EDGE_NODE_MISSING", severity: "high", message: "update_edge references missing node" });
        continue;
      }
      edges.set(operation.edgeId, {
        edgeId: current.edgeId,
        sourceNodeId: nextSource,
        targetNodeId: nextTarget,
        edgeType: operation.edgeType ?? current.edgeType,
        branchId: operation.branchId ?? current.branchId,
        order: operation.order ?? current.order,
        isPrimary: operation.isPrimary ?? current.isPrimary,
      });
      continue;
    }

    if (operation.op === "delete_edge") {
      if (!operation.edgeId) {
        issues.push({ code: "DELETE_EDGE_INVALID", severity: "high", message: "delete_edge missing edgeId" });
        continue;
      }
      edges.delete(operation.edgeId);
      continue;
    }
  }

  return {
    snapshot: {
      nodes: [...nodes.values()],
      edges: [...edges.values()],
    },
    issues,
  };
};

const syncSnapshotToDb = async (
  ctx: {
    db: {
      query: (table: string) => {
        withIndex: (
          index: string,
          cb: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => {
          collect: () => Promise<Array<Record<string, unknown>>>;
        };
      };
      insert: (table: string, value: Record<string, unknown>) => Promise<string>;
      patch: (id: string, value: Record<string, unknown>) => Promise<void>;
      delete: (id: string) => Promise<void>;
    };
  },
  storyboardId: string,
  userId: string,
  snapshot: { nodes: GraphNodeSnapshot[]; edges: GraphEdgeSnapshot[] },
) => {
  const now = Date.now();
  const [nodesRaw, edgesRaw] = await Promise.all([
    ctx.db
      .query("storyboardNodes")
      .withIndex("by_storyboard_updatedAt", (q) => q.eq("storyboardId", storyboardId))
      .collect(),
    ctx.db
      .query("storyboardEdges")
      .withIndex("by_storyboard_edge", (q) => q.eq("storyboardId", storyboardId))
      .collect(),
  ]);

  const existingNodes = new Map(nodesRaw.map((row) => [String(row.nodeId), row]));
  const existingEdges = new Map(edgesRaw.map((row) => [String(row.edgeId), row]));

  const expectedNodeIds = new Set(snapshot.nodes.map((node) => node.nodeId));
  const expectedEdgeIds = new Set(snapshot.edges.map((edge) => edge.edgeId));

  for (const node of snapshot.nodes) {
    const existing = existingNodes.get(node.nodeId);
    if (!existing) {
      await ctx.db.insert("storyboardNodes", {
        storyboardId,
        userId,
        ...toNodeDefaults(now, node),
      });
      continue;
    }
    await ctx.db.patch(String(existing._id), {
      nodeType: node.nodeType,
      label: node.label,
      segment: node.segment,
      position: node.position,
      updatedAt: now,
    });
  }

  for (const edge of snapshot.edges) {
    const existing = existingEdges.get(edge.edgeId);
    if (!existing) {
      await ctx.db.insert("storyboardEdges", {
        storyboardId,
        userId,
        edgeId: edge.edgeId,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        edgeType: edge.edgeType,
        branchId: edge.branchId,
        order: edge.order,
        isPrimary: edge.isPrimary,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }
    await ctx.db.patch(String(existing._id), {
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      edgeType: edge.edgeType,
      branchId: edge.branchId,
      order: edge.order,
      isPrimary: edge.isPrimary,
      updatedAt: now,
    });
  }

  for (const row of nodesRaw) {
    const nodeId = String(row.nodeId);
    if (!expectedNodeIds.has(nodeId)) {
      await ctx.db.delete(String(row._id));
    }
  }
  for (const row of edgesRaw) {
    const edgeId = String(row.edgeId);
    if (!expectedEdgeIds.has(edgeId)) {
      await ctx.db.delete(String(row._id));
    }
  }
};

export const createBranch = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    branchId: v.string(),
    name: v.string(),
    parentBranchId: v.optional(v.string()),
    parentCommitId: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);

    const existing = await ctx.db
      .query("narrativeBranches")
      .withIndex("by_storyboard_branch", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("branchId", args.branchId),
      )
      .unique();
    if (existing) {
      return existing._id;
    }

    const now = Date.now();
    return await ctx.db.insert("narrativeBranches", {
      storyboardId: args.storyboardId,
      userId,
      branchId: args.branchId,
      name: args.name,
      parentBranchId: args.parentBranchId,
      parentCommitId: args.parentCommitId,
      headCommitId: args.parentCommitId,
      isDefault: args.isDefault ?? false,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const listBranches = query({
  args: {
    storyboardId: v.id("storyboards"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    return await ctx.db
      .query("narrativeBranches")
      .withIndex("by_storyboard_branch_updatedAt", (q) => q.eq("storyboardId", args.storyboardId))
      .order("desc")
      .collect();
  },
});

export const simulateExecutionPlan = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    branchId: v.string(),
    operations: v.array(executionOperation),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const baseline = await captureSnapshot(ctx, args.storyboardId);
    const evaluation = applyOpsToSnapshot(baseline, args.operations);
    const operationCount = args.operations.length;

    let computedRisk: "low" | "medium" | "high" | "critical" = "low";
    if (evaluation.issues.some((issue) => issue.severity === "high")) {
      computedRisk = "high";
    } else if (evaluation.issues.some((issue) => issue.severity === "medium")) {
      computedRisk = "medium";
    }

    const planHash = `plan_${hashString(JSON.stringify({
      storyboardId: args.storyboardId,
      branchId: args.branchId,
      operations: args.operations,
    }))}`;
    const report = {
      storyboardId: args.storyboardId,
      userId,
      branchId: args.branchId,
      planHash,
      operationCount,
      valid: evaluation.issues.length === 0,
      riskLevel: computedRisk,
      summary: evaluation.issues.length === 0
        ? "Dry-run passed."
        : `Dry-run found ${evaluation.issues.length} issue(s).`,
      issuesJson: JSON.stringify(evaluation.issues),
      estimatedTotalCost: Number((operationCount * 0.18).toFixed(2)),
      estimatedDurationSec: Number((Math.max(operationCount, 1) * 1.6).toFixed(2)),
      createdAt: Date.now(),
    };

    await ctx.db.insert("dryRunReports", report);
    return {
      valid: report.valid,
      riskLevel: report.riskLevel,
      summary: report.summary,
      issues: evaluation.issues,
      estimatedTotalCost: report.estimatedTotalCost,
      estimatedDurationSec: report.estimatedDurationSec,
      planHash,
    };
  },
});

const applyCommitPlan = async (
  ctx: {
    auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> };
    db: {
      get: (id: string) => Promise<{ userId: string } | null>;
      query: (table: string) => {
        withIndex: (
          index: string,
          cb: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => {
          unique: () => Promise<Record<string, unknown> | null>;
          collect: () => Promise<Array<Record<string, unknown>>>;
        };
      };
      insert: (table: string, value: Record<string, unknown>) => Promise<string>;
      patch: (id: string, value: Record<string, unknown>) => Promise<void>;
    };
  },
  args: {
    storyboardId: string;
    branchId: string;
    title: string;
    rationale?: string;
    operations: Array<{
      op: "create_node" | "update_node" | "delete_node" | "create_edge" | "update_edge" | "delete_edge" | "generate_image" | "generate_video";
      opId?: string;
      title?: string;
      rationale?: string;
      nodeId?: string;
      edgeId?: string;
      nodeType?: "scene" | "shot" | "branch" | "merge" | "character_ref" | "background_ref";
      label?: string;
      segment?: string;
      position?: { x: number; y: number };
      sourceNodeId?: string;
      targetNodeId?: string;
      edgeType?: "serial" | "parallel" | "branch" | "merge";
      branchId?: string;
      order?: number;
      isPrimary?: boolean;
    }>;
    approvalToken: string;
    runId?: string;
  },
) => {
  const userId = await requireUser(ctx);
  await ensureStoryboardEditable(ctx, args.storyboardId, userId);
  if (!args.approvalToken.startsWith("approved:")) {
    throw new ConvexError("Missing explicit approval token");
  }

  const branch = await ctx.db
    .query("narrativeBranches")
    .withIndex("by_storyboard_branch", (q) =>
      q.eq("storyboardId", args.storyboardId).eq("branchId", args.branchId),
    )
    .unique();
  if (!branch) {
    throw new ConvexError("Branch not found");
  }

  const baseline = await captureSnapshot(ctx, args.storyboardId);
  const evaluation = applyOpsToSnapshot(baseline, args.operations);
  if (evaluation.issues.length > 0) {
    throw new ConvexError(`Plan has blocking issues: ${JSON.stringify(evaluation.issues)}`);
  }

  await syncSnapshotToDb(ctx, args.storyboardId, userId, evaluation.snapshot);
  const now = Date.now();
  const commitId = `c_${hashString(JSON.stringify({
    storyboardId: args.storyboardId,
    branchId: args.branchId,
    operations: args.operations,
    now,
  }))}`;

  await ctx.db.insert("narrativeCommits", {
    storyboardId: args.storyboardId,
    userId,
    branchId: args.branchId,
    commitId,
    parentCommitId: branch.headCommitId as string | undefined,
    summary: args.title,
    rationale: args.rationale,
    operationCount: args.operations.length,
    operationsJson: JSON.stringify(args.operations),
    semanticSummary: args.rationale ?? args.title,
    snapshotJson: JSON.stringify(evaluation.snapshot),
    appliedByRunId: args.runId,
    createdAt: now,
  });

  await ctx.db.patch(String(branch._id), {
    headCommitId: commitId,
    updatedAt: now,
  });

  await ctx.db.insert("storyEvents", {
    storyboardId: args.storyboardId,
    userId,
    branchId: args.branchId,
    eventType: "branch_create",
    summary: `Committed plan ${args.title}`,
    details: `Commit ${commitId}`,
    salience: 0.9,
    eventVersion: now,
    ancestorNodeIds: evaluation.snapshot.nodes.map((node) => node.nodeId),
    createdAt: now,
  });

  await ctx.db.patch(args.storyboardId, { updatedAt: now, activeBranch: args.branchId });
  return {
    commitId,
    branchId: args.branchId,
    operationCount: args.operations.length,
    previousHeadCommitId: branch.headCommitId as string | undefined,
  };
};

export const commitPlanOps = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    branchId: v.string(),
    title: v.string(),
    rationale: v.optional(v.string()),
    operations: v.array(executionOperation),
    approvalToken: v.string(),
    runId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await applyCommitPlan(ctx, args);
  },
});

export const rollbackToCommit = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    branchId: v.string(),
    commitId: v.string(),
    approvalToken: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    if (!args.approvalToken.startsWith("approved:")) {
      throw new ConvexError("Missing explicit approval token");
    }

    const [branch, commit] = await Promise.all([
      ctx.db
        .query("narrativeBranches")
        .withIndex("by_storyboard_branch", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("branchId", args.branchId),
        )
        .unique(),
      ctx.db
        .query("narrativeCommits")
        .withIndex("by_storyboard_commit", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("commitId", args.commitId),
        )
        .unique(),
    ]);
    if (!branch || !commit || commit.branchId !== args.branchId) {
      throw new ConvexError("Branch or commit not found");
    }

    let parsedSnapshot: { nodes: GraphNodeSnapshot[]; edges: GraphEdgeSnapshot[] };
    try {
      parsedSnapshot = JSON.parse(commit.snapshotJson) as { nodes: GraphNodeSnapshot[]; edges: GraphEdgeSnapshot[] };
    } catch {
      throw new ConvexError("Invalid commit snapshot payload");
    }

    await syncSnapshotToDb(ctx, args.storyboardId, userId, parsedSnapshot);
    await ctx.db.patch(branch._id, {
      headCommitId: args.commitId,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(args.storyboardId, { updatedAt: Date.now(), activeBranch: args.branchId });

    return {
      rolledBackTo: args.commitId,
      branchId: args.branchId,
      nodeCount: parsedSnapshot.nodes.length,
      edgeCount: parsedSnapshot.edges.length,
    };
  },
});

export const cherryPickCommit = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    sourceCommitId: v.string(),
    targetBranchId: v.string(),
    approvalToken: v.string(),
    runId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    if (!args.approvalToken.startsWith("approved:")) {
      throw new ConvexError("Missing explicit approval token");
    }

    const sourceCommit = await ctx.db
      .query("narrativeCommits")
      .withIndex("by_storyboard_commit", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("commitId", args.sourceCommitId),
      )
      .unique();
    if (!sourceCommit) {
      throw new ConvexError("Source commit not found");
    }

    let operations: Array<{
      op: "create_node" | "update_node" | "delete_node" | "create_edge" | "update_edge" | "delete_edge" | "generate_image" | "generate_video";
      opId?: string;
      title?: string;
      rationale?: string;
      nodeId?: string;
      edgeId?: string;
      nodeType?: "scene" | "shot" | "branch" | "merge" | "character_ref" | "background_ref";
      label?: string;
      segment?: string;
      position?: { x: number; y: number };
      sourceNodeId?: string;
      targetNodeId?: string;
      edgeType?: "serial" | "parallel" | "branch" | "merge";
      branchId?: string;
      order?: number;
      isPrimary?: boolean;
    }>;
    try {
      operations = JSON.parse(sourceCommit.operationsJson) as typeof operations;
    } catch {
      throw new ConvexError("Invalid source operations payload");
    }

    return await applyCommitPlan(ctx, {
      storyboardId: args.storyboardId,
      branchId: args.targetBranchId,
      title: `Cherry-pick ${args.sourceCommitId}`,
      rationale: `Cherry-picked from ${sourceCommit.branchId}`,
      operations,
      approvalToken: args.approvalToken,
      runId: args.runId,
    });
  },
});

export const applyMergePolicy = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    sourceBranchId: v.string(),
    targetBranchId: v.string(),
    policy: v.string(),
    approvalToken: v.string(),
    runId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    if (!args.approvalToken.startsWith("approved:")) {
      throw new ConvexError("Missing explicit approval token");
    }

    const [sourceBranch, targetBranch] = await Promise.all([
      ctx.db
        .query("narrativeBranches")
        .withIndex("by_storyboard_branch", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("branchId", args.sourceBranchId),
        )
        .unique(),
      ctx.db
        .query("narrativeBranches")
        .withIndex("by_storyboard_branch", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("branchId", args.targetBranchId),
        )
        .unique(),
    ]);
    if (!sourceBranch || !targetBranch) {
      throw new ConvexError("Source or target branch not found");
    }
    if (!sourceBranch.headCommitId) {
      throw new ConvexError("Source branch has no commits to merge");
    }

    const sourceHeadCommit = await ctx.db
      .query("narrativeCommits")
      .withIndex("by_storyboard_commit", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("commitId", String(sourceBranch.headCommitId)),
      )
      .unique();
    if (!sourceHeadCommit) {
      throw new ConvexError("Source branch head commit not found");
    }

    let operations: Array<{
      op: "create_node" | "update_node" | "delete_node" | "create_edge" | "update_edge" | "delete_edge" | "generate_image" | "generate_video";
      opId?: string;
      title?: string;
      rationale?: string;
      nodeId?: string;
      edgeId?: string;
      nodeType?: "scene" | "shot" | "branch" | "merge" | "character_ref" | "background_ref";
      label?: string;
      segment?: string;
      position?: { x: number; y: number };
      sourceNodeId?: string;
      targetNodeId?: string;
      edgeType?: "serial" | "parallel" | "branch" | "merge";
      branchId?: string;
      order?: number;
      isPrimary?: boolean;
    }>;
    try {
      operations = JSON.parse(sourceHeadCommit.operationsJson) as typeof operations;
    } catch {
      throw new ConvexError("Source head commit has invalid operations payload");
    }

    const commit = await applyCommitPlan(ctx, {
      storyboardId: args.storyboardId,
      branchId: args.targetBranchId,
      title: `Merge ${args.sourceBranchId} -> ${args.targetBranchId}`,
      rationale: `Policy: ${args.policy}`,
      operations,
      approvalToken: args.approvalToken,
      runId: args.runId,
    });

    await ctx.db.insert("storyEvents", {
      storyboardId: args.storyboardId,
      userId,
      branchId: args.targetBranchId,
      eventType: "branch_merge",
      summary: `Merged ${args.sourceBranchId} into ${args.targetBranchId}`,
      details: `Policy ${args.policy}, commit ${commit.commitId}`,
      salience: 0.92,
      eventVersion: Date.now(),
      ancestorNodeIds: [],
      createdAt: Date.now(),
    });

    return {
      ...commit,
      sourceBranchId: args.sourceBranchId,
      targetBranchId: args.targetBranchId,
      sourceCommitId: String(sourceHeadCommit.commitId),
      policy: args.policy,
    };
  },
});

export const computeSemanticDiff = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    fromCommitId: v.string(),
    toCommitId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const [fromCommit, toCommit] = await Promise.all([
      ctx.db
        .query("narrativeCommits")
        .withIndex("by_storyboard_commit", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("commitId", args.fromCommitId),
        )
        .unique(),
      ctx.db
        .query("narrativeCommits")
        .withIndex("by_storyboard_commit", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("commitId", args.toCommitId),
        )
        .unique(),
    ]);
    if (!fromCommit || !toCommit) {
      throw new ConvexError("Commit pair not found");
    }

    let fromOps: Array<{ op?: string; edgeType?: string; nodeType?: string }>;
    let toOps: Array<{ op?: string; edgeType?: string; nodeType?: string }>;
    try {
      fromOps = JSON.parse(fromCommit.operationsJson) as typeof fromOps;
      toOps = JSON.parse(toCommit.operationsJson) as typeof toOps;
    } catch {
      throw new ConvexError("Invalid commit operation payload");
    }

    const toSummary = {
      totalOps: toOps.length,
      nodeEdits: toOps.filter((operation) => String(operation.op ?? "").includes("node")).length,
      edgeEdits: toOps.filter((operation) => String(operation.op ?? "").includes("edge")).length,
      mergeOps: toOps.filter((operation) => operation.edgeType === "merge").length,
      branchOps: toOps.filter((operation) => operation.edgeType === "branch").length,
    };

    const fromSummary = {
      totalOps: fromOps.length,
      nodeEdits: fromOps.filter((operation) => String(operation.op ?? "").includes("node")).length,
      edgeEdits: fromOps.filter((operation) => String(operation.op ?? "").includes("edge")).length,
      mergeOps: fromOps.filter((operation) => operation.edgeType === "merge").length,
      branchOps: fromOps.filter((operation) => operation.edgeType === "branch").length,
    };

    const diff = {
      fromCommitId: args.fromCommitId,
      toCommitId: args.toCommitId,
      intentChanges: [
        `Operations delta: ${toSummary.totalOps - fromSummary.totalOps}`,
      ],
      continuityChanges: [
        `Node edits delta: ${toSummary.nodeEdits - fromSummary.nodeEdits}`,
      ],
      visualChanges: [
        `Edge edits delta: ${toSummary.edgeEdits - fromSummary.edgeEdits}`,
      ],
      pacingChanges: [
        `Branch ops delta: ${toSummary.branchOps - fromSummary.branchOps}`,
        `Merge ops delta: ${toSummary.mergeOps - fromSummary.mergeOps}`,
      ],
      riskNotes: toSummary.mergeOps > fromSummary.mergeOps
        ? ["Merge operations increased; run continuity simulation before apply."]
        : [],
    };

    await ctx.db.insert("semanticDiffs", {
      storyboardId: args.storyboardId,
      userId,
      fromCommitId: args.fromCommitId,
      toCommitId: args.toCommitId,
      diffJson: JSON.stringify(diff),
      createdAt: Date.now(),
    });

    return diff;
  },
});

export const listBranchCommits = query({
  args: {
    storyboardId: v.id("storyboards"),
    branchId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    return await ctx.db
      .query("narrativeCommits")
      .withIndex("by_storyboard_branch_createdAt", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("branchId", args.branchId),
      )
      .order("desc")
      .take(limit);
  },
});

export const startDelegation = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    runId: v.string(),
    delegationId: v.string(),
    agentName: v.string(),
    task: v.string(),
    inputJson: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const now = Date.now();
    return await ctx.db.insert("agentDelegations", {
      storyboardId: args.storyboardId,
      userId,
      runId: args.runId,
      delegationId: args.delegationId,
      agentName: args.agentName,
      task: args.task,
      status: "running",
      inputJson: args.inputJson,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const finishDelegation = mutation({
  args: {
    delegationId: v.id("agentDelegations"),
    status: v.union(v.literal("complete"), v.literal("failed")),
    outputJson: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const delegation = await ctx.db.get(args.delegationId);
    if (!delegation) {
      throw new ConvexError("Delegation not found");
    }
    await ensureStoryboardEditable(ctx, delegation.storyboardId, userId);
    await ctx.db.patch(args.delegationId, {
      status: args.status,
      outputJson: args.outputJson,
      latencyMs: args.latencyMs,
      updatedAt: Date.now(),
    });
    return args.delegationId;
  },
});

export const listDelegations = query({
  args: {
    storyboardId: v.id("storyboards"),
    runId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const limit = Math.min(Math.max(args.limit ?? 120, 1), 500);
    if (args.runId) {
      return await ctx.db
        .query("agentDelegations")
        .withIndex("by_storyboard_run_createdAt", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("runId", args.runId),
        )
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("agentDelegations")
      .withIndex("by_storyboard_run_createdAt", (q) => q.eq("storyboardId", args.storyboardId))
      .order("desc")
      .take(limit);
  },
});
