import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { ensureStoryboardOwner, requireUser } from "./storyboardAccess";

type StatsCtx = {
  db: {
    query: (table: string) => {
      withIndex: (
        index: string,
        cb: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => {
        collect: () => Promise<Array<Record<string, unknown>>>;
        order: (direction: "asc" | "desc") => { take: (n: number) => Promise<Array<Record<string, unknown>>> };
      };
    };
    patch: (id: Id<"storyboards">, value: Record<string, unknown>) => Promise<void>;
    get: (id: Id<"storyboards">) => Promise<Record<string, unknown> | null>;
  };
};

export const recomputeStoryboardStatsInternal = async (
  ctx: StatsCtx,
  storyboardId: Id<"storyboards">,
) => {
  const [nodes, edges, mediaCoverRows, mediaRows] = await Promise.all([
    ctx.db
      .query("storyboardNodes")
      .withIndex("by_storyboard_updatedAt", (q) => q.eq("storyboardId", storyboardId))
      .collect(),
    ctx.db
      .query("storyboardEdges")
      .withIndex("by_storyboard_edge", (q) => q.eq("storyboardId", storyboardId))
      .collect(),
    ctx.db
      .query("mediaAssets")
      .withIndex("by_storyboard_createdAt", (q) => q.eq("storyboardId", storyboardId))
      .order("desc")
      .take(1),
    ctx.db
      .query("mediaAssets")
      .withIndex("by_storyboard_createdAt", (q) => q.eq("storyboardId", storyboardId))
      .collect(),
  ]);

  const imageCount = mediaRows.filter((row) => row.kind === "image").length;
  const videoCount = mediaRows.filter((row) => row.kind === "video").length;
  const coverImageUrlRaw = mediaCoverRows[0]?.sourceUrl;
  const coverImageUrl = typeof coverImageUrlRaw === "string" ? coverImageUrlRaw : undefined;

  await ctx.db.patch(storyboardId, {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    imageCount,
    videoCount,
    coverImageUrl,
    updatedAt: Date.now(),
  });
};

export const recomputeStoryboardStats = mutation({
  args: {
    storyboardId: v.id("storyboards"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardOwner(ctx, args.storyboardId, userId);
    await recomputeStoryboardStatsInternal(ctx, args.storyboardId);
    return { ok: true };
  },
});

