import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureStoryboardEditable, requireUser } from "./storyboardAccess";
import { recomputeStoryboardStatsInternal } from "./storyboardStats";

export const createMediaAsset = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    nodeId: v.string(),
    kind: v.union(v.literal("image"), v.literal("video")),
    sourceUrl: v.string(),
    modelId: v.string(),
    prompt: v.string(),
    negativePrompt: v.optional(v.string()),
    status: v.optional(v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"))),
    metadata: v.optional(v.record(v.string(), v.string())),
    identityScore: v.optional(v.number()),
    consistencyScore: v.optional(v.number()),
    wardrobeCompliance: v.optional(
      v.union(v.literal("matching"), v.literal("deviation"), v.literal("unknown")),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const now = Date.now();
    const assetId = await ctx.db.insert("mediaAssets", {
      storyboardId: args.storyboardId,
      userId,
      nodeId: args.nodeId,
      kind: args.kind,
      sourceUrl: args.sourceUrl,
      modelId: args.modelId,
      prompt: args.prompt,
      negativePrompt: args.negativePrompt,
      status: args.status ?? "completed",
      metadata: args.metadata,
      identityScore: args.identityScore,
      consistencyScore: args.consistencyScore,
      wardrobeCompliance: args.wardrobeCompliance,
      createdAt: now,
      updatedAt: now,
    });

    const node = await ctx.db
      .query("storyboardNodes")
      .withIndex("by_storyboard_node", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("nodeId", args.nodeId),
      )
      .unique();
    if (node) {
      const nextImages = args.kind === "image"
        ? [
            ...node.media.images,
            { mediaAssetId: assetId, url: args.sourceUrl, modelId: args.modelId, createdAt: now },
          ]
        : node.media.images;
      const nextVideos = args.kind === "video"
        ? [
            ...node.media.videos,
            { mediaAssetId: assetId, url: args.sourceUrl, modelId: args.modelId, createdAt: now },
          ]
        : node.media.videos;

      await ctx.db.patch(node._id, {
        media: {
          images: nextImages,
          videos: nextVideos,
          activeImageId: args.kind === "image" ? assetId : node.media.activeImageId,
          activeVideoId: args.kind === "video" ? assetId : node.media.activeVideoId,
        },
        updatedAt: now,
      });
    }

    await recomputeStoryboardStatsInternal(ctx, args.storyboardId);
    return assetId;
  },
});

export const setActiveMediaVariant = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    nodeId: v.string(),
    mediaAssetId: v.id("mediaAssets"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const [node, asset] = await Promise.all([
      ctx.db
        .query("storyboardNodes")
        .withIndex("by_storyboard_node", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("nodeId", args.nodeId),
        )
        .unique(),
      ctx.db.get(args.mediaAssetId),
    ]);

    if (!node || !asset || asset.storyboardId !== args.storyboardId) {
      throw new ConvexError("Node or media asset not found");
    }

    await ctx.db.patch(node._id, {
      media: {
        images: node.media.images,
        videos: node.media.videos,
        activeImageId: asset.kind === "image" ? args.mediaAssetId : node.media.activeImageId,
        activeVideoId: asset.kind === "video" ? args.mediaAssetId : node.media.activeVideoId,
      },
      updatedAt: Date.now(),
    });
    await ctx.db.patch(args.storyboardId, { updatedAt: Date.now() });
    return node._id;
  },
});

export const updateConsistencyScores = mutation({
  args: {
    mediaAssetId: v.id("mediaAssets"),
    identityScore: v.number(),
    consistencyScore: v.number(),
    wardrobeCompliance: v.union(v.literal("matching"), v.literal("deviation"), v.literal("unknown")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const asset = await ctx.db.get(args.mediaAssetId);
    if (!asset) {
      throw new ConvexError("Media asset not found");
    }
    await ensureStoryboardEditable(ctx, asset.storyboardId, userId);
    await ctx.db.patch(args.mediaAssetId, {
      identityScore: args.identityScore,
      consistencyScore: args.consistencyScore,
      wardrobeCompliance: args.wardrobeCompliance,
      updatedAt: Date.now(),
    });
    return args.mediaAssetId;
  },
});

export const listNodeMedia = query({
  args: {
    storyboardId: v.id("storyboards"),
    nodeId: v.string(),
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const mediaRows = await ctx.db
      .query("mediaAssets")
      .withIndex("by_storyboard_node_kind_createdAt", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("nodeId", args.nodeId),
      )
      .order("desc")
      .take(limit);
    if (!args.kind) {
      return mediaRows;
    }
    return mediaRows.filter((row) => row.kind === args.kind);
  },
});
