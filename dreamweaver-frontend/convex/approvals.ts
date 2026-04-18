import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { ensureStoryboardEditable, requireUser } from "./storyboardAccess";

const approvalStatus = v.union(
  v.literal("queued"),
  v.literal("executing"),
  v.literal("waiting_for_human"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("cancelled"),
  v.literal("complete"),
  v.literal("failed"),
);

export type ApprovalTaskType =
  | "graph_patch"
  | "media_prompt"
  | "execution_plan"
  | "batch_ops"
  | "merge_policy"
  | "repair_plan"
  | "dailies_batch"
  | "simulation_critic_batch";

/**
 * Shared approval-task insert logic. Extracted from the public `createTask`
 * mutation so sibling modules (dailies, etc.) can atomically create an
 * approval task alongside their own write without round-tripping through a
 * separate mutation. Caller is expected to have already authenticated (via
 * `requireUser`) and authorized (via `ensureStoryboardEditable`).
 */
export const createTaskCore = async (
  ctx: MutationCtx,
  args: {
    storyboardId: Id<"storyboards">;
    userId: string;
    taskType: ApprovalTaskType;
    title: string;
    rationale: string;
    diffSummary?: string;
    payloadJson: string;
    dedupeKey?: string;
    status?:
      | "queued"
      | "executing"
      | "waiting_for_human"
      | "approved"
      | "rejected"
      | "cancelled"
      | "complete"
      | "failed";
    // Provenance. Defaults to "human" so callers that predate this field keep
    // their existing behavior; agent-originated inserts (e.g. from the
    // `upsertAgent*` mutations) should pass "agent" explicitly.
    origin?: "agent" | "human";
  },
): Promise<Id<"approvalTasks">> => {
  const now = Date.now();
  if (args.dedupeKey) {
    const existingRows = await ctx.db
      .query("approvalTasks")
      .withIndex("by_storyboard_dedupe", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("dedupeKey", args.dedupeKey),
      )
      .take(1);
    const existing = existingRows[0];
    if (existing) {
      return existing._id;
    }
  }
  return await ctx.db.insert("approvalTasks", {
    storyboardId: args.storyboardId,
    userId: args.userId,
    taskType: args.taskType,
    dedupeKey: args.dedupeKey,
    status: args.status ?? "waiting_for_human",
    title: args.title,
    rationale: args.rationale,
    diffSummary: args.diffSummary,
    payloadJson: args.payloadJson,
    origin: args.origin ?? "human",
    createdAt: now,
    updatedAt: now,
  });
};

/**
 * Shared approval-task resolution logic. Idempotent: if the task already has
 * a matching decision the call is a no-op; a mismatched decision throws.
 * Caller handles auth.
 */
export const resolveTaskCore = async (
  ctx: MutationCtx,
  args: {
    taskId: Id<"approvalTasks">;
    userId: string;
    approved: boolean;
    editedPayloadJson?: string;
    justification?: string;
  },
): Promise<Id<"approvalTasks">> => {
  const task = await ctx.db.get(args.taskId);
  if (!task) {
    throw new ConvexError("Task not found");
  }
  if (task.decision) {
    if (task.decision.approved !== args.approved) {
      throw new ConvexError("Task already resolved with a different decision");
    }
    return args.taskId;
  }
  const now = Date.now();
  await ctx.db.patch(args.taskId, {
    status: args.approved ? "approved" : "rejected",
    decision: {
      approved: args.approved,
      editedPayloadJson: args.editedPayloadJson,
      reviewerId: args.userId,
      justification: args.justification,
      decidedAt: now,
    },
    updatedAt: now,
  });
  await ctx.db.patch(task.storyboardId, { updatedAt: now });
  return args.taskId;
};

/**
 * Mark the execution phase as started on an approval task. Idempotent — if
 * `executionStartedAt` is already set, the call is a no-op. Called by the
 * agent execution adapter right after `resolveTaskCore` (approve path), so
 * the task's lifecycle timeline reads: created -> decided -> started ->
 * finished.
 */
export const markExecutionStartedCore = async (
  ctx: MutationCtx,
  args: { taskId: Id<"approvalTasks"> },
): Promise<void> => {
  const task = await ctx.db.get(args.taskId);
  if (!task) {
    throw new ConvexError("Task not found");
  }
  if (task.executionStartedAt) {
    return;
  }
  const now = Date.now();
  await ctx.db.patch(args.taskId, {
    status: "executing",
    executionStartedAt: now,
    updatedAt: now,
  });
};

/**
 * Mark the execution phase as finished on an approval task. Caller passes
 * either a success payload (stored in `executionResultJson`) or a failure
 * payload with `failed: true` to flip status to `failed`. Idempotent on
 * repeated identical calls (last-write-wins on the JSON). If the task was
 * never marked started, this will stamp `executionStartedAt = now` as well
 * so timeline reporting doesn't show null.
 */
export const markExecutionFinishedCore = async (
  ctx: MutationCtx,
  args: {
    taskId: Id<"approvalTasks">;
    resultJson: string;
    failed?: boolean;
  },
): Promise<void> => {
  const task = await ctx.db.get(args.taskId);
  if (!task) {
    throw new ConvexError("Task not found");
  }
  const now = Date.now();
  const nextStatus = args.failed ? "failed" : "complete";
  if (!task.executionStartedAt) {
    await ctx.db.patch(args.taskId, {
      status: nextStatus,
      executionStartedAt: now,
      executionFinishedAt: now,
      executionResultJson: args.resultJson,
      updatedAt: now,
    });
  } else {
    await ctx.db.patch(args.taskId, {
      status: nextStatus,
      executionFinishedAt: now,
      executionResultJson: args.resultJson,
      updatedAt: now,
    });
  }
  await ctx.db.patch(task.storyboardId, { updatedAt: now });
};

export const markExecutionStarted = mutation({
  args: { taskId: v.id("approvalTasks") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new ConvexError("Task not found");
    }
    await ensureStoryboardEditable(ctx, task.storyboardId, userId);
    await markExecutionStartedCore(ctx, args);
    return args.taskId;
  },
});

export const markExecutionFinished = mutation({
  args: {
    taskId: v.id("approvalTasks"),
    resultJson: v.string(),
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new ConvexError("Task not found");
    }
    await ensureStoryboardEditable(ctx, task.storyboardId, userId);
    await markExecutionFinishedCore(ctx, args);
    return args.taskId;
  },
});

export const createTask = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    taskType: v.union(
      v.literal("graph_patch"),
      v.literal("media_prompt"),
      v.literal("execution_plan"),
      v.literal("batch_ops"),
      v.literal("merge_policy"),
      v.literal("repair_plan"),
      v.literal("dailies_batch"),
      v.literal("simulation_critic_batch"),
    ),
    title: v.string(),
    rationale: v.string(),
    diffSummary: v.optional(v.string()),
    payloadJson: v.string(),
    dedupeKey: v.optional(v.string()),
    status: v.optional(approvalStatus),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    return await createTaskCore(ctx, { ...args, userId });
  },
});

export const resolveTask = mutation({
  args: {
    taskId: v.id("approvalTasks"),
    approved: v.boolean(),
    editedPayloadJson: v.optional(v.string()),
    justification: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new ConvexError("Task not found");
    }
    await ensureStoryboardEditable(ctx, task.storyboardId, userId);
    return await resolveTaskCore(ctx, { ...args, userId });
  },
});

export const listForStoryboard = query({
  args: {
    storyboardId: v.id("storyboards"),
    status: v.optional(approvalStatus),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
    if (args.status) {
      return await ctx.db
        .query("approvalTasks")
        .withIndex("by_storyboard_status_createdAt", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("status", args.status),
        )
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("approvalTasks")
      .withIndex("by_storyboard_createdAt", (q) => q.eq("storyboardId", args.storyboardId))
      .order("desc")
      .take(limit);
  },
});
