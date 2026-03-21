import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureStoryboardEditable, requireUser } from "./storyboardAccess";

const toDayKey = (input: Date) =>
  `${input.getUTCFullYear()}-${String(input.getUTCMonth() + 1).padStart(2, "0")}-${String(input.getUTCDate()).padStart(2, "0")}`;

export const checkAndReserveRunBudget = mutation({
  args: {
    quotaProfileId: v.string(),
    runId: v.string(),
    storyboardId: v.optional(v.id("storyboards")),
    requestedMutationOps: v.number(),
    requestedMediaBudget: v.number(),
    requestedRunOps: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    if (args.storyboardId) {
      await ensureStoryboardEditable(ctx, args.storyboardId, ownerUserId);
    }

    const quotaProfile = await ctx.db
      .query("quotaProfiles")
      .withIndex("by_owner_profile", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("quotaProfileId", args.quotaProfileId),
      )
      .unique();
    if (!quotaProfile) {
      throw new ConvexError(`Quota profile not found: ${args.quotaProfileId}`);
    }

    const requestedMutationOps = Math.max(0, Math.floor(args.requestedMutationOps));
    const requestedMediaBudget = Math.max(0, Number(args.requestedMediaBudget.toFixed(4)));
    const requestedRunOps = Math.max(0, Math.floor(args.requestedRunOps ?? requestedMutationOps));
    if (requestedRunOps > Number(quotaProfile.maxRunOps)) {
      throw new ConvexError("Requested run exceeds maxRunOps policy");
    }

    const dayKey = toDayKey(new Date());
    const usageRow = await ctx.db
      .query("quotaUsageWindows")
      .withIndex("by_owner_profile_day", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("quotaProfileId", args.quotaProfileId).eq("dayKey", dayKey),
      )
      .unique();

    const currentMutationOps = usageRow ? Number(usageRow.mutationOpsUsed) : 0;
    const currentMediaBudget = usageRow ? Number(usageRow.mediaBudgetUsed) : 0;
    const currentActiveRuns = usageRow ? Number(usageRow.activeRuns) : 0;
    const nextMutationOps = currentMutationOps + requestedMutationOps;
    const nextMediaBudget = Number((currentMediaBudget + requestedMediaBudget).toFixed(4));
    const nextActiveRuns = currentActiveRuns + 1;

    if (nextMutationOps > Number(quotaProfile.dailyMutationOps)) {
      throw new ConvexError("Daily mutation quota exceeded");
    }
    if (nextMediaBudget > Number(quotaProfile.dailyMediaBudget)) {
      throw new ConvexError("Daily media budget exceeded");
    }
    if (nextActiveRuns > Number(quotaProfile.maxConcurrentRuns)) {
      throw new ConvexError("Concurrent run quota exceeded");
    }

    const now = Date.now();
    if (usageRow) {
      await ctx.db.patch(usageRow._id, {
        mediaBudgetUsed: nextMediaBudget,
        mutationOpsUsed: nextMutationOps,
        activeRuns: nextActiveRuns,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("quotaUsageWindows", {
        ownerUserId,
        quotaProfileId: args.quotaProfileId,
        dayKey,
        mediaBudgetUsed: nextMediaBudget,
        mutationOpsUsed: nextMutationOps,
        activeRuns: nextActiveRuns,
        updatedAt: now,
      });
    }

    return {
      reserved: true,
      runId: args.runId,
      quotaProfileId: args.quotaProfileId,
      usage: {
        dayKey,
        mediaBudgetUsed: nextMediaBudget,
        mutationOpsUsed: nextMutationOps,
        activeRuns: nextActiveRuns,
      },
      limits: {
        dailyMediaBudget: Number(quotaProfile.dailyMediaBudget),
        dailyMutationOps: Number(quotaProfile.dailyMutationOps),
        maxRunOps: Number(quotaProfile.maxRunOps),
        maxConcurrentRuns: Number(quotaProfile.maxConcurrentRuns),
      },
    };
  },
});

export const releaseRunBudget = mutation({
  args: {
    quotaProfileId: v.string(),
    runId: v.string(),
    releaseMutationOps: v.optional(v.number()),
    releaseMediaBudget: v.optional(v.number()),
    keepUsage: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const quotaProfile = await ctx.db
      .query("quotaProfiles")
      .withIndex("by_owner_profile", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("quotaProfileId", args.quotaProfileId),
      )
      .unique();
    if (!quotaProfile) {
      throw new ConvexError(`Quota profile not found: ${args.quotaProfileId}`);
    }

    const dayKey = toDayKey(new Date());
    const usageRow = await ctx.db
      .query("quotaUsageWindows")
      .withIndex("by_owner_profile_day", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("quotaProfileId", args.quotaProfileId).eq("dayKey", dayKey),
      )
      .unique();
    if (!usageRow) {
      return {
        released: true,
        runId: args.runId,
        usage: {
          dayKey,
          mediaBudgetUsed: 0,
          mutationOpsUsed: 0,
          activeRuns: 0,
        },
      };
    }

    const keepUsage = args.keepUsage ?? true;
    const releaseMutationOps = Math.max(0, Math.floor(args.releaseMutationOps ?? 0));
    const releaseMediaBudget = Math.max(0, Number((args.releaseMediaBudget ?? 0).toFixed(4)));
    const nextActiveRuns = Math.max(0, Number(usageRow.activeRuns) - 1);
    const nextMutationOps = keepUsage
      ? Number(usageRow.mutationOpsUsed)
      : Math.max(0, Number(usageRow.mutationOpsUsed) - releaseMutationOps);
    const nextMediaBudget = keepUsage
      ? Number(usageRow.mediaBudgetUsed)
      : Math.max(0, Number((Number(usageRow.mediaBudgetUsed) - releaseMediaBudget).toFixed(4)));

    await ctx.db.patch(usageRow._id, {
      mediaBudgetUsed: nextMediaBudget,
      mutationOpsUsed: nextMutationOps,
      activeRuns: nextActiveRuns,
      updatedAt: Date.now(),
    });

    return {
      released: true,
      runId: args.runId,
      usage: {
        dayKey,
        mediaBudgetUsed: nextMediaBudget,
        mutationOpsUsed: nextMutationOps,
        activeRuns: nextActiveRuns,
      },
    };
  },
});

export const getUsageSummary = query({
  args: {
    quotaProfileId: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const quotaProfile = await ctx.db
      .query("quotaProfiles")
      .withIndex("by_owner_profile", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("quotaProfileId", args.quotaProfileId),
      )
      .unique();
    if (!quotaProfile) {
      throw new ConvexError(`Quota profile not found: ${args.quotaProfileId}`);
    }

    const dayKey = toDayKey(new Date());
    const usageRow = await ctx.db
      .query("quotaUsageWindows")
      .withIndex("by_owner_profile_day", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("quotaProfileId", args.quotaProfileId).eq("dayKey", dayKey),
      )
      .unique();

    return {
      quotaProfile,
      usage: {
        dayKey,
        mediaBudgetUsed: usageRow ? Number(usageRow.mediaBudgetUsed) : 0,
        mutationOpsUsed: usageRow ? Number(usageRow.mutationOpsUsed) : 0,
        activeRuns: usageRow ? Number(usageRow.activeRuns) : 0,
      },
      remaining: {
        mediaBudget: Number(quotaProfile.dailyMediaBudget) - (usageRow ? Number(usageRow.mediaBudgetUsed) : 0),
        mutationOps: Number(quotaProfile.dailyMutationOps) - (usageRow ? Number(usageRow.mutationOpsUsed) : 0),
        concurrentRuns: Number(quotaProfile.maxConcurrentRuns) - (usageRow ? Number(usageRow.activeRuns) : 0),
      },
    };
  },
});
