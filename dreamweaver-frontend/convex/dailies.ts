import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureStoryboardEditable, requireUser } from "./storyboardAccess";
import { createTaskCore, resolveTaskCore } from "./approvals";

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
  payload: v.optional(v.object({
    suggestedFix: v.optional(v.string()),
    prompt: v.optional(v.string()),
    negativePrompt: v.optional(v.string()),
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
  })),
});

const hashString = (raw: string) => {
  let hash = 5381;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 33) ^ raw.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
};

const riskRank = (value: "low" | "medium" | "high" | "critical") => {
  switch (value) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
};

const maxRisk = (
  left: "low" | "medium" | "high" | "critical",
  right: "low" | "medium" | "high" | "critical",
) => (riskRank(left) >= riskRank(right) ? left : right);

type CriticIssue = {
  code: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  nodeIds: string[];
  edgeIds: string[];
  suggestedFix?: string;
};

const parseViolations = (raw: string): CriticIssue[] => {
  try {
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item, index) => {
      const severityRaw = typeof item.severity === "string" ? item.severity : "medium";
      const severity = (
        severityRaw === "low"
        || severityRaw === "medium"
        || severityRaw === "high"
        || severityRaw === "critical"
      )
        ? severityRaw
        : "medium";
      const nodeIds = Array.isArray(item.nodeIds)
        ? item.nodeIds.filter((nodeId): nodeId is string => typeof nodeId === "string")
        : [];
      const edgeIds = Array.isArray(item.edgeIds)
        ? item.edgeIds.filter((edgeId): edgeId is string => typeof edgeId === "string")
        : [];
      return {
        code: typeof item.code === "string" ? item.code : `VIOLATION_${index + 1}`,
        severity,
        message: typeof item.message === "string" ? item.message : "Continuity violation detected.",
        nodeIds,
        edgeIds,
        suggestedFix: typeof item.suggestedFix === "string" ? item.suggestedFix : undefined,
      };
    });
  } catch {
    return [];
  }
};

export const generateAutonomousDailies = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    branchId: v.string(),
    maxClips: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);

    const maxClips = Math.min(Math.max(args.maxClips ?? 8, 3), 20);
    const [mediaRows, nodeRows, violationRows] = await Promise.all([
      ctx.db
        .query("mediaAssets")
        .withIndex("by_storyboard_createdAt", (q) => q.eq("storyboardId", args.storyboardId))
        .order("desc")
        .take(250),
      ctx.db
        .query("storyboardNodes")
        .withIndex("by_storyboard_updatedAt", (q) => q.eq("storyboardId", args.storyboardId))
        .collect(),
      ctx.db
        .query("continuityViolations")
        .withIndex("by_storyboard_status_createdAt", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("status", "open"),
        )
        .order("desc")
        .take(25),
    ]);

    const latestMediaByNode = new Map<string, (typeof mediaRows)[number]>();
    for (const row of mediaRows) {
      if (!latestMediaByNode.has(row.nodeId)) {
        latestMediaByNode.set(row.nodeId, row);
      }
      if (latestMediaByNode.size >= maxClips) {
        break;
      }
    }

    const selectedMedia = [...latestMediaByNode.values()].slice(0, maxClips);
    const clipNodeIds = selectedMedia.map((asset) => asset.nodeId);
    const clipMediaAssetIds = selectedMedia.map((asset) => asset._id);
    const highlights = selectedMedia.map(
      (asset, index) =>
        `Clip ${index + 1}: ${asset.kind.toUpperCase()} for node ${asset.nodeId} (${asset.modelId})`,
    );

    let continuityRiskLevel: "low" | "medium" | "high" | "critical" =
      selectedMedia.length < 3 ? "medium" : "low";
    for (const violation of violationRows) {
      continuityRiskLevel = maxRisk(continuityRiskLevel, violation.severity);
    }

    const continuityRisks: CriticIssue[] = violationRows.map((violation) => ({
      code: violation.code,
      severity: violation.severity,
      message: violation.message,
      nodeIds: violation.nodeIds,
      edgeIds: violation.edgeIds,
      suggestedFix: violation.suggestedFix,
    }));

    const nodesMissingMedia = nodeRows
      .filter((node) => node.nodeType === "shot" || node.nodeType === "scene")
      .filter((node) => !latestMediaByNode.has(node.nodeId))
      .slice(0, Math.max(2, Math.ceil(maxClips / 3)));

    const generationOps = nodesMissingMedia.map((node, index) => ({
      opId: `daily_gen_${index + 1}`,
      op: node.nodeType === "shot" ? "generate_video" : "generate_image",
      title: `Generate ${node.nodeType === "shot" ? "video" : "image"} for ${node.label}`,
      rationale: "Autonomous dailies coverage for missing media artifacts.",
      nodeId: node.nodeId,
      requiresHitl: true,
      payload: {
        prompt: node.historyContext.rollingSummary || node.segment,
        negativePrompt: "identity drift, continuity mismatch",
      },
    }));

    const continuityOps = continuityRisks.slice(0, 4).map((issue, index) => ({
      opId: `daily_fix_${index + 1}`,
      op: "update_node" as const,
      title: `Continuity repair: ${issue.code}`,
      rationale: issue.message,
      nodeId: issue.nodeIds[0],
      requiresHitl: true,
      payload: issue.suggestedFix ? { suggestedFix: issue.suggestedFix } : undefined,
    }));

    const proposedOperations = [...generationOps, ...continuityOps];
    const now = Date.now();
    const reelId = `reel_${hashString(JSON.stringify({
      storyboardId: args.storyboardId,
      branchId: args.branchId,
      clipNodeIds,
      now,
    }))}`;
    const planId = `daily_plan_${hashString(`${reelId}:${proposedOperations.length}`)}`;
    const title = `Autonomous Dailies - ${new Date(now).toISOString().slice(0, 10)}`;
    const summary = selectedMedia.length > 0
      ? `Generated ${selectedMedia.length} candidate clip(s) with ${continuityRisks.length} continuity risk(s).`
      : "No media clips found. Proposed generation-first dailies recovery plan.";

    const executionPlan = {
      planId,
      storyboardId: args.storyboardId,
      branchId: args.branchId,
      title: `${title} - Batch Apply`,
      rationale: "Producer-approved autonomous dailies operations.",
      source: "dailies" as const,
      sourceId: reelId,
      taskType: "dailies_batch" as const,
      operations: proposedOperations,
      dryRun: {
        valid: true,
        riskLevel: continuityRiskLevel,
        summary,
        issues: continuityRisks,
        estimatedTotalCost: Number((proposedOperations.length * 0.22).toFixed(2)),
        estimatedDurationSec: Number((Math.max(proposedOperations.length, 1) * 2.3).toFixed(2)),
        planHash: `daily_${hashString(JSON.stringify(proposedOperations))}`,
      },
    };

    // Atomically: create the approval task (with the full executionPlan as
    // payload so a reviewer sees exactly what will run), insert the dailies
    // row pointing at that task, then patch the task's dedupeKey via reelId
    // so regenerating the same reel dedupes instead of piling up tasks.
    const approvalTaskId = await createTaskCore(ctx, {
      storyboardId: args.storyboardId,
      userId,
      taskType: "dailies_batch",
      title,
      rationale: summary,
      diffSummary: `${proposedOperations.length} op(s), ${continuityRisks.length} risk(s), risk=${continuityRiskLevel}`,
      payloadJson: JSON.stringify(executionPlan),
      dedupeKey: `dailies:${reelId}`,
      status: "waiting_for_human",
    });

    await ctx.db.insert("autonomousDailies", {
      storyboardId: args.storyboardId,
      userId,
      branchId: args.branchId,
      reelId,
      title,
      summary,
      clipNodeIds,
      clipMediaAssetIds,
      highlights,
      continuityRiskLevel,
      continuityRisksJson: JSON.stringify(continuityRisks),
      proposedOperationsJson: JSON.stringify(proposedOperations),
      status: "drafted",
      approvalTaskId,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("storyEvents", {
      storyboardId: args.storyboardId,
      userId,
      branchId: args.branchId,
      eventType: "dailies_generate",
      summary: `Autonomous dailies drafted: ${title}`,
      details: summary,
      salience: 0.76,
      eventVersion: now,
      ancestorNodeIds: clipNodeIds,
      createdAt: now,
    });

    await ctx.db.patch(args.storyboardId, { updatedAt: now });
    return {
      reelId,
      title,
      summary,
      branchId: args.branchId,
      highlights,
      continuityRiskLevel,
      continuityRisks,
      approvalTaskId,
      clips: selectedMedia.map((asset) => ({
        nodeId: asset.nodeId,
        mediaAssetId: asset._id,
        kind: asset.kind,
        sourceUrl: asset.sourceUrl,
      })),
      executionPlan,
    };
  },
});

/**
 * Idempotent upsert called when the storyboard agent emits an
 * `approve_dailies_batch` HITL card — the dailies panel should reflect the
 * agent's proposal immediately (before the producer decides) and the cascade
 * from `updateDailiesStatus` into `resolveTaskCore` needs a linked task to
 * exist. Keyed by `(storyboardId, reelId)`; re-emitting the same reelId is a
 * no-op that returns the existing ids.
 */
export const upsertAgentDailies = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    branchId: v.string(),
    reelId: v.string(),
    title: v.string(),
    summary: v.string(),
    continuityRiskLevel: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    continuityRisksJson: v.string(),
    proposedOperationsJson: v.string(),
    executionPlanPayloadJson: v.string(),
    clipNodeIds: v.optional(v.array(v.string())),
    highlights: v.optional(v.array(v.string())),
    diffSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);

    const existing = await ctx.db
      .query("autonomousDailies")
      .withIndex("by_storyboard_reel", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("reelId", args.reelId),
      )
      .unique();
    if (existing) {
      return { reelId: args.reelId, _id: existing._id, approvalTaskId: existing.approvalTaskId };
    }

    const approvalTaskId = await createTaskCore(ctx, {
      storyboardId: args.storyboardId,
      userId,
      taskType: "dailies_batch",
      title: args.title,
      rationale: args.summary,
      diffSummary: args.diffSummary,
      payloadJson: args.executionPlanPayloadJson,
      dedupeKey: `dailies:${args.reelId}`,
      status: "waiting_for_human",
      origin: "agent",
    });

    const now = Date.now();
    const insertedId = await ctx.db.insert("autonomousDailies", {
      storyboardId: args.storyboardId,
      userId,
      branchId: args.branchId,
      reelId: args.reelId,
      title: args.title,
      summary: args.summary,
      clipNodeIds: args.clipNodeIds ?? [],
      clipMediaAssetIds: [],
      highlights: args.highlights ?? [],
      continuityRiskLevel: args.continuityRiskLevel,
      continuityRisksJson: args.continuityRisksJson,
      proposedOperationsJson: args.proposedOperationsJson,
      status: "drafted",
      approvalTaskId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.storyboardId, { updatedAt: now });
    return { reelId: args.reelId, _id: insertedId, approvalTaskId };
  },
});

export const updateDailiesStatus = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    reelId: v.string(),
    status: v.union(v.literal("approved"), v.literal("rejected"), v.literal("applied")),
    justification: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);

    const reel = await ctx.db
      .query("autonomousDailies")
      .withIndex("by_storyboard_reel", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("reelId", args.reelId),
      )
      .unique();
    if (!reel) {
      throw new ConvexError("Dailies reel not found");
    }

    const now = Date.now();
    await ctx.db.patch(reel._id, {
      status: args.status,
      updatedAt: now,
    });

    // Cascade into the linked approval task so the approvals feed matches the
    // reel's state. "approved" and "applied" both count as human-approved
    // ("applied" meaning the producer has also confirmed runtime execution).
    // "rejected" flips the task to rejected. resolveTaskCore is idempotent —
    // re-issuing the same decision is a no-op.
    if (reel.approvalTaskId) {
      await resolveTaskCore(ctx, {
        taskId: reel.approvalTaskId,
        userId,
        approved: args.status !== "rejected",
        justification: args.justification,
      });
    }

    await ctx.db.patch(args.storyboardId, { updatedAt: now });
    return reel._id;
  },
});

export const listAutonomousDailies = query({
  args: {
    storyboardId: v.id("storyboards"),
    branchId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const rows = await ctx.db
      .query("autonomousDailies")
      .withIndex("by_storyboard_branch_createdAt", (q) => q.eq("storyboardId", args.storyboardId))
      .order("desc")
      .take(limit * 2);
    if (!args.branchId) {
      return rows.slice(0, limit);
    }
    return rows.filter((row) => row.branchId === args.branchId).slice(0, limit);
  },
});

export const runSimulationCritic = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    branchId: v.string(),
    sourcePlanId: v.optional(v.string()),
    operations: v.optional(v.array(executionOperation)),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);

    const [nodes, edges, events, violations] = await Promise.all([
      ctx.db
        .query("storyboardNodes")
        .withIndex("by_storyboard_updatedAt", (q) => q.eq("storyboardId", args.storyboardId))
        .collect(),
      ctx.db
        .query("storyboardEdges")
        .withIndex("by_storyboard_edge", (q) => q.eq("storyboardId", args.storyboardId))
        .collect(),
      ctx.db
        .query("storyEvents")
        .withIndex("by_storyboard_createdAt", (q) => q.eq("storyboardId", args.storyboardId))
        .order("desc")
        .take(200),
      ctx.db
        .query("continuityViolations")
        .withIndex("by_storyboard_status_createdAt", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("status", "open"),
        )
        .order("desc")
        .take(25),
    ]);

    const issues: CriticIssue[] = [];
    const outgoingCount = new Map<string, number>();
    const incomingCount = new Map<string, number>();
    for (const edge of edges) {
      outgoingCount.set(edge.sourceNodeId, (outgoingCount.get(edge.sourceNodeId) ?? 0) + 1);
      incomingCount.set(edge.targetNodeId, (incomingCount.get(edge.targetNodeId) ?? 0) + 1);
    }

    for (const node of nodes) {
      const inCount = incomingCount.get(node.nodeId) ?? 0;
      const outCount = outgoingCount.get(node.nodeId) ?? 0;
      if (node.nodeType === "shot" && outCount === 0 && nodes.length > 1) {
        issues.push({
          code: "PACING_DEAD_END_SHOT",
          severity: "medium",
          message: `Shot node ${node.nodeId} is a dead end; pacing may stall.`,
          nodeIds: [node.nodeId],
          edgeIds: [],
          suggestedFix: "Connect shot to a continuation or merge node.",
        });
      }
      if (node.nodeType === "scene" && inCount === 0 && outCount === 0) {
        issues.push({
          code: "ORPHAN_SCENE",
          severity: "high",
          message: `Scene node ${node.nodeId} is isolated from the timeline.`,
          nodeIds: [node.nodeId],
          edgeIds: [],
          suggestedFix: "Attach scene into primary lineage.",
        });
      }
    }

    const branchEdges = edges.filter((edge) => edge.edgeType === "branch").length;
    const mergeEdges = edges.filter((edge) => edge.edgeType === "merge").length;
    if (branchEdges > mergeEdges + 2) {
      issues.push({
        code: "BRANCH_MERGE_IMBALANCE",
        severity: "medium",
        message: "Branch count significantly exceeds merge count; narrative convergence risk is high.",
        nodeIds: [],
        edgeIds: [],
        suggestedFix: "Schedule merge nodes for unresolved branches.",
      });
    }

    const eventText = events.map((event) => event.summary.toLowerCase()).join(" | ");
    if (eventText.includes("dies") && eventText.includes("alive")) {
      issues.push({
        code: "CAUSALITY_CONTRADICTION",
        severity: "high",
        message: "Potential causality contradiction detected in event timeline.",
        nodeIds: [],
        edgeIds: [],
        suggestedFix: "Insert transition event clarifying revival/alternate timeline.",
      });
    }

    for (const violation of violations) {
      issues.push({
        code: `CONTINUITY_${violation.code}`,
        severity: violation.severity,
        message: violation.message,
        nodeIds: violation.nodeIds,
        edgeIds: violation.edgeIds,
        suggestedFix: violation.suggestedFix,
      });
    }

    const importedIssues = (args.operations ?? []).flatMap((operation) => {
      if (operation.op === "delete_node" && operation.nodeId) {
        return [
          {
            code: "DELETE_NODE_CAUSALITY_CHECK",
            severity: "medium" as const,
            message: `Planned node deletion ${operation.nodeId} requires causality review.`,
            nodeIds: [operation.nodeId],
            edgeIds: [],
            suggestedFix: "Confirm replacement beats exist before deletion.",
          },
        ];
      }
      return [];
    });
    issues.push(...importedIssues);

    let computedRisk: "low" | "medium" | "high" | "critical" = "low";
    for (const issue of issues) {
      computedRisk = maxRisk(computedRisk, issue.severity);
    }
    if (issues.length >= 8 && computedRisk !== "critical") {
      computedRisk = "high";
    }

    const repairOperations = issues.slice(0, 10).map((issue, index) => ({
      opId: `critic_fix_${index + 1}`,
      op: issue.code.includes("PACING") ? "create_edge" : "update_node",
      title: `Critic repair: ${issue.code}`,
      rationale: issue.message,
      nodeId: issue.nodeIds[0],
      requiresHitl: true,
      payload: {
        suggestedFix: issue.suggestedFix ?? "Apply minimal continuity repair",
      },
    }));

    const confidence = Number(
      Math.max(0.45, Math.min(0.92, 0.92 - (issues.length * 0.035))).toFixed(2),
    );
    const impactScore = Number(
      Math.min(1, Math.max(0.15, (issues.length * 0.07) + (riskRank(computedRisk) * 0.12))).toFixed(2),
    );
    const summary = issues.length === 0
      ? "Simulation critic pass: no blocking narrative issues detected."
      : `Simulation critic found ${issues.length} issue(s) requiring producer review.`;

    const now = Date.now();
    const simulationRunId = `sim_${hashString(JSON.stringify({
      storyboardId: args.storyboardId,
      branchId: args.branchId,
      sourcePlanId: args.sourcePlanId,
      issueCount: issues.length,
      now,
    }))}`;

    const executionPlan = {
      planId: `critic_plan_${simulationRunId}`,
      storyboardId: args.storyboardId,
      branchId: args.branchId,
      title: "Simulation Critic Repair Batch",
      rationale: summary,
      source: "simulation_critic" as const,
      sourceId: simulationRunId,
      taskType: "simulation_critic_batch" as const,
      operations: repairOperations,
      dryRun: {
        valid: true,
        riskLevel: computedRisk,
        summary,
        issues,
        estimatedTotalCost: Number((repairOperations.length * 0.15).toFixed(2)),
        estimatedDurationSec: Number((Math.max(repairOperations.length, 1) * 1.8).toFixed(2)),
        planHash: `critic_${hashString(JSON.stringify(repairOperations))}`,
      },
    };

    // Atomically: create the approval task (with the full executionPlan as
    // payload so a reviewer sees exactly what will run), insert the simulation
    // run pointing at that task, dedupeKey scoped by simulationRunId so a
    // regenerated run dedupes instead of piling up tasks.
    const approvalTaskId = await createTaskCore(ctx, {
      storyboardId: args.storyboardId,
      userId,
      taskType: "simulation_critic_batch",
      title: "Simulation Critic Repair Batch",
      rationale: summary,
      diffSummary: `${repairOperations.length} repair op(s), ${issues.length} issue(s), risk=${computedRisk}`,
      payloadJson: JSON.stringify(executionPlan),
      dedupeKey: `simulation:${simulationRunId}`,
      status: "waiting_for_human",
    });

    await ctx.db.insert("simulationCriticRuns", {
      storyboardId: args.storyboardId,
      userId,
      branchId: args.branchId,
      simulationRunId,
      sourcePlanId: args.sourcePlanId,
      status: "waiting_for_human",
      summary,
      riskLevel: computedRisk,
      issuesJson: JSON.stringify(issues),
      repairOperationsJson: JSON.stringify(repairOperations),
      confidence,
      impactScore,
      approvalTaskId,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("storyEvents", {
      storyboardId: args.storyboardId,
      userId,
      branchId: args.branchId,
      eventType: "simulation_critic",
      summary,
      details: `Run ${simulationRunId}`,
      salience: 0.84,
      eventVersion: now,
      ancestorNodeIds: issues.flatMap((issue) => issue.nodeIds).slice(0, 20),
      createdAt: now,
    });

    await ctx.db.patch(args.storyboardId, { updatedAt: now });
    return {
      simulationRunId,
      summary,
      riskLevel: computedRisk,
      issues,
      repairOperations,
      confidence,
      impactScore,
      approvalTaskId,
      executionPlan,
    };
  },
});

/**
 * Idempotent upsert for agent-emitted `preview_simulation_critic_plan`. See
 * `upsertAgentDailies` for rationale — mirror behaviour keyed by
 * `(storyboardId, simulationRunId)`.
 */
export const upsertAgentSimulationRun = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    branchId: v.string(),
    simulationRunId: v.string(),
    sourcePlanId: v.optional(v.string()),
    summary: v.string(),
    riskLevel: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    issuesJson: v.string(),
    repairOperationsJson: v.string(),
    confidence: v.number(),
    impactScore: v.number(),
    executionPlanPayloadJson: v.string(),
    diffSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);

    const existing = await ctx.db
      .query("simulationCriticRuns")
      .withIndex("by_storyboard_run", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("simulationRunId", args.simulationRunId),
      )
      .unique();
    if (existing) {
      return {
        simulationRunId: args.simulationRunId,
        _id: existing._id,
        approvalTaskId: existing.approvalTaskId,
      };
    }

    const approvalTaskId = await createTaskCore(ctx, {
      storyboardId: args.storyboardId,
      userId,
      taskType: "simulation_critic_batch",
      title: "Simulation Critic Repair Batch",
      rationale: args.summary,
      diffSummary: args.diffSummary,
      payloadJson: args.executionPlanPayloadJson,
      dedupeKey: `simulation:${args.simulationRunId}`,
      status: "waiting_for_human",
      origin: "agent",
    });

    const now = Date.now();
    const insertedId = await ctx.db.insert("simulationCriticRuns", {
      storyboardId: args.storyboardId,
      userId,
      branchId: args.branchId,
      simulationRunId: args.simulationRunId,
      sourcePlanId: args.sourcePlanId,
      status: "waiting_for_human",
      summary: args.summary,
      riskLevel: args.riskLevel,
      issuesJson: args.issuesJson,
      repairOperationsJson: args.repairOperationsJson,
      confidence: args.confidence,
      impactScore: args.impactScore,
      approvalTaskId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.storyboardId, { updatedAt: now });
    return { simulationRunId: args.simulationRunId, _id: insertedId, approvalTaskId };
  },
});

export const updateSimulationRunStatus = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    simulationRunId: v.string(),
    status: v.union(v.literal("applied"), v.literal("rejected"), v.literal("failed"), v.literal("complete")),
    justification: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);

    const run = await ctx.db
      .query("simulationCriticRuns")
      .withIndex("by_storyboard_run", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("simulationRunId", args.simulationRunId),
      )
      .unique();
    if (!run) {
      throw new ConvexError("Simulation run not found");
    }

    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: args.status,
      updatedAt: now,
    });

    // Cascade into the linked approval task. "applied" and "complete" are
    // human-approved paths (producer signed off, then the batch succeeded or
    // was marked applied). "rejected" flips the task to rejected. "failed" is
    // a runtime-failure signal — leave the approval decision untouched so the
    // reviewer can still act on the task (re-approve / reject / retry) once
    // the failure is investigated.
    if (run.approvalTaskId && args.status !== "failed") {
      await resolveTaskCore(ctx, {
        taskId: run.approvalTaskId,
        userId,
        approved: args.status !== "rejected",
        justification: args.justification,
      });
    }

    await ctx.db.patch(args.storyboardId, { updatedAt: now });
    return run._id;
  },
});

export const listSimulationRuns = query({
  args: {
    storyboardId: v.id("storyboards"),
    branchId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
    const rows = await ctx.db
      .query("simulationCriticRuns")
      .withIndex("by_storyboard_branch_createdAt", (q) => q.eq("storyboardId", args.storyboardId))
      .order("desc")
      .take(limit * 2);
    if (!args.branchId) {
      return rows.slice(0, limit);
    }
    return rows.filter((row) => row.branchId === args.branchId).slice(0, limit);
  },
});

export const parseStoredContinuityRisks = query({
  args: {
    storyboardId: v.id("storyboards"),
    reelId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const reel = await ctx.db
      .query("autonomousDailies")
      .withIndex("by_storyboard_reel", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("reelId", args.reelId),
      )
      .unique();
    if (!reel) {
      throw new ConvexError("Dailies reel not found");
    }
    return parseViolations(reel.continuityRisksJson);
  },
});
