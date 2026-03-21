import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureStoryboardEditable, requireUser } from "./storyboardAccess";

const runStatus = v.union(
  v.literal("queued"),
  v.literal("executing"),
  v.literal("waiting_for_human"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("cancelled"),
  v.literal("complete"),
  v.literal("failed"),
);


export const startRun = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    runId: v.string(),
    agentName: v.string(),
    graphId: v.string(),
    intent: v.string(),
    actionsJson: v.string(),
    status: v.optional(runStatus),
    diagnostics: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const now = Date.now();
    const existing = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        storyboardId: args.storyboardId,
        userId,
        agentName: args.agentName,
        graphId: args.graphId,
        intent: args.intent,
        actionsJson: args.actionsJson,
        status: args.status ?? "executing",
        diagnostics: args.diagnostics,
        startedAt: now,
        finishedAt: undefined,
      });
      return existing._id;
    }
    return await ctx.db.insert("agentRuns", {
      storyboardId: args.storyboardId,
      userId,
      runId: args.runId,
      agentName: args.agentName,
      graphId: args.graphId,
      intent: args.intent,
      status: args.status ?? "executing",
      actionsJson: args.actionsJson,
      diagnostics: args.diagnostics,
      startedAt: now,
    });
  },
});

export const finishRun = mutation({
  args: {
    runId: v.string(),
    status: v.union(v.literal("complete"), v.literal("failed"), v.literal("cancelled")),
    diagnostics: v.optional(v.string()),
    error: v.optional(v.string()),
    actionsJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const run = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .unique();
    if (!run) {
      throw new ConvexError("Run not found");
    }
    await ensureStoryboardEditable(ctx, run.storyboardId, userId);
    await ctx.db.patch(run._id, {
      status: args.status,
      diagnostics: args.diagnostics ?? run.diagnostics,
      error: args.error,
      actionsJson: args.actionsJson ?? run.actionsJson,
      finishedAt: Date.now(),
    });
    return run._id;
  },
});

export const listRuns = query({
  args: {
    storyboardId: v.id("storyboards"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    return await ctx.db
      .query("agentRuns")
      .withIndex("by_storyboard_startedAt", (q) => q.eq("storyboardId", args.storyboardId))
      .order("desc")
      .take(limit);
  },
});
