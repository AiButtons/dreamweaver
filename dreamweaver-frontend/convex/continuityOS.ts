import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureStoryboardEditable, requireUser } from "./storyboardAccess";

const riskLevel = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("critical"),
);

export const upsertIdentityPack = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    packId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    dnaJson: v.string(),
    sourceCharacterId: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("project"), v.literal("workspace_opt_in"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const now = Date.now();

    const existing = await ctx.db
      .query("identityPacks")
      .withIndex("by_storyboard_pack", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("packId", args.packId),
      )
      .unique();
    if (!existing) {
      return await ctx.db.insert("identityPacks", {
        userId,
        storyboardId: args.storyboardId,
        packId: args.packId,
        name: args.name,
        description: args.description,
        dnaJson: args.dnaJson,
        sourceCharacterId: args.sourceCharacterId,
        visibility: args.visibility ?? "project",
        published: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(existing._id, {
      name: args.name,
      description: args.description,
      dnaJson: args.dnaJson,
      sourceCharacterId: args.sourceCharacterId ?? existing.sourceCharacterId,
      visibility: args.visibility ?? existing.visibility,
      updatedAt: now,
    });
    return existing._id;
  },
});

export const publishIdentityPack = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    packId: v.string(),
    publish: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const pack = await ctx.db
      .query("identityPacks")
      .withIndex("by_storyboard_pack", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("packId", args.packId),
      )
      .unique();
    if (!pack) {
      throw new ConvexError("Identity pack not found");
    }
    await ctx.db.patch(pack._id, {
      published: args.publish,
      visibility: args.publish ? "workspace_opt_in" : "project",
      updatedAt: Date.now(),
    });
    return pack._id;
  },
});

export const upsertGlobalConstraint = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    constraintId: v.string(),
    name: v.string(),
    description: v.string(),
    severity: riskLevel,
    scope: v.union(v.literal("character"), v.literal("narration"), v.literal("visual"), v.literal("timeline")),
    expressionJson: v.string(),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const now = Date.now();
    const existing = await ctx.db
      .query("globalConstraints")
      .withIndex("by_storyboard_constraint", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("constraintId", args.constraintId),
      )
      .unique();
    if (!existing) {
      return await ctx.db.insert("globalConstraints", {
        storyboardId: args.storyboardId,
        userId,
        constraintId: args.constraintId,
        name: args.name,
        description: args.description,
        severity: args.severity,
        scope: args.scope,
        expressionJson: args.expressionJson,
        enabled: args.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(existing._id, {
      name: args.name,
      description: args.description,
      severity: args.severity,
      scope: args.scope,
      expressionJson: args.expressionJson,
      enabled: args.enabled ?? existing.enabled,
      updatedAt: now,
    });
    return existing._id;
  },
});

export const detectContradictions = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    branchId: v.optional(v.string()),
    rollingSummary: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const summary = args.rollingSummary.toLowerCase();
    const violations: Array<{
      violationId: string;
      code: string;
      severity: "low" | "medium" | "high" | "critical";
      status: "open";
      message: string;
      nodeIds: string[];
      edgeIds: string[];
      suggestedFix: string;
    }> = [];

    if (summary.includes("dies") && summary.includes("alive")) {
      violations.push({
        violationId: `vio_${Date.now()}_timeline`,
        code: "TIMELINE_CONTRADICTION",
        severity: "high",
        status: "open",
        message: "Narrative indicates both death and alive states in same rolling context.",
        nodeIds: [],
        edgeIds: [],
        suggestedFix: "Insert explicit revival/flashback context or split branch continuity.",
      });
    }
    if (summary.includes("same outfit") && summary.includes("wardrobe change")) {
      violations.push({
        violationId: `vio_${Date.now()}_wardrobe`,
        code: "WARDROBE_CONTRADICTION",
        severity: "medium",
        status: "open",
        message: "Wardrobe continuity contradiction detected.",
        nodeIds: [],
        edgeIds: [],
        suggestedFix: "Align selected wardrobe variant for the affected node lineage.",
      });
    }

    const now = Date.now();
    for (const violation of violations) {
      await ctx.db.insert("continuityViolations", {
        storyboardId: args.storyboardId,
        userId,
        violationId: violation.violationId,
        branchId: args.branchId,
        code: violation.code,
        severity: violation.severity,
        status: violation.status,
        message: violation.message,
        nodeIds: violation.nodeIds,
        edgeIds: violation.edgeIds,
        suggestedFix: violation.suggestedFix,
        createdAt: now,
        updatedAt: now,
      });
    }
    return {
      found: violations.length,
      violations,
    };
  },
});

export const resolveViolation = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    violationId: v.string(),
    status: v.union(v.literal("acknowledged"), v.literal("resolved")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const row = await ctx.db
      .query("continuityViolations")
      .withIndex("by_storyboard_violation", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("violationId", args.violationId),
      )
      .unique();
    if (!row) {
      throw new ConvexError("Violation not found");
    }
    await ctx.db.patch(row._id, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return row._id;
  },
});

export const listConstraintBundle = query({
  args: {
    storyboardId: v.id("storyboards"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const [identityPacks, globalConstraints, continuityViolations] = await Promise.all([
      ctx.db
        .query("identityPacks")
        .withIndex("by_storyboard_pack", (q) => q.eq("storyboardId", args.storyboardId))
        .collect(),
      ctx.db
        .query("globalConstraints")
        .withIndex("by_storyboard_enabled_updatedAt", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("enabled", true),
        )
        .collect(),
      ctx.db
        .query("continuityViolations")
        .withIndex("by_storyboard_status_createdAt", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("status", "open"),
        )
        .collect(),
    ]);
    return {
      identityPacks,
      globalConstraints,
      continuityViolations,
    };
  },
});
