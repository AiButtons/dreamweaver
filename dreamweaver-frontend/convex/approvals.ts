import { ConvexError, v } from "convex/values";
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
      userId,
      taskType: args.taskType,
      dedupeKey: args.dedupeKey,
      status: args.status ?? "waiting_for_human",
      title: args.title,
      rationale: args.rationale,
      diffSummary: args.diffSummary,
      payloadJson: args.payloadJson,
      createdAt: now,
      updatedAt: now,
    });
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
        reviewerId: userId,
        justification: args.justification,
        decidedAt: now,
      },
      updatedAt: now,
    });
    await ctx.db.patch(task.storyboardId, { updatedAt: now });
    return args.taskId;
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
