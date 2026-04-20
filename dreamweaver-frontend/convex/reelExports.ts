import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureStoryboardEditable, requireUser } from "./storyboardAccess";

/**
 * M5 — persisted reel exports. The /api/storyboard/export-reel route
 * writes a row here after a successful ffmpeg run so producers can
 * re-open / re-download a reel without paying ffmpeg cost again.
 *
 * Row lifecycle: insert-only. Exports are immutable by design — if a
 * producer wants a new cut (different shots, re-rendered video), they
 * trigger a fresh export and a new row appears. Old rows stick around
 * for audit + download-link preservation.
 */

export const recordReelExport = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    storageId: v.id("_storage"),
    sourceUrl: v.string(),
    shotCount: v.number(),
    totalDurationS: v.number(),
    byteLength: v.number(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    return await ctx.db.insert("reelExports", {
      storyboardId: args.storyboardId,
      userId,
      storageId: args.storageId,
      sourceUrl: args.sourceUrl,
      shotCount: args.shotCount,
      totalDurationS: args.totalDurationS,
      byteLength: args.byteLength,
      title: args.title,
      createdAt: Date.now(),
    });
  },
});

/**
 * List the last ~20 reel exports for a storyboard, newest first. The UI
 * uses this to render a sidebar of "Past exports" in the ReelPlayer.
 * `limit` caps at 50 to keep the response bounded even on storyboards
 * with heavy export churn.
 */
export const listReelExportsForStoryboard = query({
  args: {
    storyboardId: v.id("storyboards"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const rows = await ctx.db
      .query("reelExports")
      .withIndex("by_storyboard_createdAt", (q) =>
        q.eq("storyboardId", args.storyboardId),
      )
      .order("desc")
      .take(Math.min(Math.max(1, args.limit ?? 20), 50));
    return rows.map((r) => ({
      _id: String(r._id),
      storageId: String(r.storageId),
      sourceUrl: r.sourceUrl,
      shotCount: r.shotCount,
      totalDurationS: r.totalDurationS,
      byteLength: r.byteLength,
      title: r.title,
      createdAt: r.createdAt,
    }));
  },
});
