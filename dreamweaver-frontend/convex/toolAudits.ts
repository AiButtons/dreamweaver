import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureStoryboardEditable, requireUser } from "./storyboardAccess";

export const recordToolCallAudit = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    runId: v.optional(v.string()),
    teamId: v.optional(v.string()),
    revisionId: v.optional(v.string()),
    member: v.string(),
    tool: v.string(),
    scope: v.array(v.string()),
    result: v.union(v.literal("success"), v.literal("failure"), v.literal("blocked")),
    detailsJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    return await ctx.db.insert("toolCallAudits", {
      storyboardId: args.storyboardId,
      userId,
      runId: args.runId,
      teamId: args.teamId,
      revisionId: args.revisionId,
      member: args.member,
      tool: args.tool,
      scope: args.scope,
      result: args.result,
      detailsJson: args.detailsJson,
      createdAt: Date.now(),
    });
  },
});

export const listForStoryboard = query({
  args: {
    storyboardId: v.id("storyboards"),
    runId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    if (args.runId) {
      return await ctx.db
        .query("toolCallAudits")
        .withIndex("by_storyboard_run_createdAt", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("runId", args.runId),
        )
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("toolCallAudits")
      .withIndex("by_storyboard_createdAt", (q) => q.eq("storyboardId", args.storyboardId))
      .order("desc")
      .take(limit);
  },
});
