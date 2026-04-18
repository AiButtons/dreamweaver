import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureStoryboardEditable, requireUser } from "./storyboardAccess";
import { recomputeStoryboardStatsInternal } from "./storyboardStats";

// Pending media generations older than this are considered zombies and flipped to
// "failed" by the sweeper. LTX-2.3 video can take ~15min end-to-end; 30min gives
// a generous buffer before we assume the request was lost to a process crash /
// network flake / route timeout.
const STALE_MEDIA_THRESHOLD_MS = 30 * 60 * 1000;

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

/**
 * Creates a `pending` media asset row before the upstream generation request is
 * fired. The returned assetId doubles as the job handle: the caller passes it to
 * {@link completeMediaGeneration} on success or {@link failMediaGeneration} on
 * failure/abort. The storyboardNodes row is NOT patched here — the node only
 * gains the media entry once the generation actually produces a URL.
 *
 * Pending rows survive page reloads and process restarts, so a user refreshing
 * mid-generation still sees a pending asset (and can be shown a spinner/retry).
 * Rows stuck in `pending` are cleaned up by {@link sweepStaleMediaGenerations}.
 */
export const startMediaGeneration = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    nodeId: v.string(),
    kind: v.union(v.literal("image"), v.literal("video")),
    modelId: v.string(),
    prompt: v.string(),
    negativePrompt: v.optional(v.string()),
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
      // Empty sourceUrl is the sentinel for "not yet completed"; filled in by
      // completeMediaGeneration. Schema requires v.string() so "" is used.
      sourceUrl: "",
      modelId: args.modelId,
      prompt: args.prompt,
      negativePrompt: args.negativePrompt,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return assetId;
  },
});

/**
 * Flips a pending row to `completed`, writes the final URL, optional consistency
 * scores, and patches the storyboardNodes row so the media surface in the UI
 * starts rendering. Mirrors the node-patching behavior that used to live in the
 * single-shot {@link createMediaAsset} path.
 */
export const completeMediaGeneration = mutation({
  args: {
    mediaAssetId: v.id("mediaAssets"),
    sourceUrl: v.string(),
    modelId: v.optional(v.string()),
    identityScore: v.optional(v.number()),
    consistencyScore: v.optional(v.number()),
    wardrobeCompliance: v.optional(
      v.union(v.literal("matching"), v.literal("deviation"), v.literal("unknown")),
    ),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const asset = await ctx.db.get(args.mediaAssetId);
    if (!asset) {
      throw new ConvexError("Media asset not found");
    }
    await ensureStoryboardEditable(ctx, asset.storyboardId, userId);
    // Refuse to complete a row that was already terminal — otherwise a late
    // fetch resolving after the sweeper flipped the row to failed would clobber
    // the failure record.
    if (asset.status !== "pending") {
      return args.mediaAssetId;
    }

    const now = Date.now();
    await ctx.db.patch(args.mediaAssetId, {
      status: "completed",
      sourceUrl: args.sourceUrl,
      modelId: args.modelId ?? asset.modelId,
      identityScore: args.identityScore,
      consistencyScore: args.consistencyScore,
      wardrobeCompliance: args.wardrobeCompliance,
      metadata: args.metadata,
      updatedAt: now,
    });

    const node = await ctx.db
      .query("storyboardNodes")
      .withIndex("by_storyboard_node", (q) =>
        q.eq("storyboardId", asset.storyboardId).eq("nodeId", asset.nodeId),
      )
      .unique();
    if (node) {
      const effectiveModelId = args.modelId ?? asset.modelId;
      const nextImages = asset.kind === "image"
        ? [
            ...node.media.images,
            { mediaAssetId: args.mediaAssetId, url: args.sourceUrl, modelId: effectiveModelId, createdAt: now },
          ]
        : node.media.images;
      const nextVideos = asset.kind === "video"
        ? [
            ...node.media.videos,
            { mediaAssetId: args.mediaAssetId, url: args.sourceUrl, modelId: effectiveModelId, createdAt: now },
          ]
        : node.media.videos;

      await ctx.db.patch(node._id, {
        media: {
          images: nextImages,
          videos: nextVideos,
          activeImageId: asset.kind === "image" ? args.mediaAssetId : node.media.activeImageId,
          activeVideoId: asset.kind === "video" ? args.mediaAssetId : node.media.activeVideoId,
        },
        updatedAt: now,
      });
    }

    await recomputeStoryboardStatsInternal(ctx, asset.storyboardId);
    return args.mediaAssetId;
  },
});

/**
 * Flips a pending row to `failed`, stashing the error message under metadata.error
 * so the UI can surface it. No-op if the row is already terminal. The storyboard
 * node is intentionally NOT patched — a failed generation should never leak into
 * the node's media arrays.
 */
export const failMediaGeneration = mutation({
  args: {
    mediaAssetId: v.id("mediaAssets"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const asset = await ctx.db.get(args.mediaAssetId);
    if (!asset) {
      throw new ConvexError("Media asset not found");
    }
    await ensureStoryboardEditable(ctx, asset.storyboardId, userId);
    if (asset.status !== "pending") {
      return args.mediaAssetId;
    }
    const now = Date.now();
    // Cap the stored error message so a pathological upstream stack trace
    // doesn't blow up the row size.
    const truncatedError = args.errorMessage.slice(0, 1000);
    await ctx.db.patch(args.mediaAssetId, {
      status: "failed",
      metadata: { ...(asset.metadata ?? {}), error: truncatedError },
      updatedAt: now,
    });
    return args.mediaAssetId;
  },
});

/**
 * Marks rows stuck in `pending` beyond {@link STALE_MEDIA_THRESHOLD_MS} as
 * `failed` with a generic zombie error. Called on storyboard open so a
 * page-reload / process-crash mid-generation doesn't leave forever-spinning
 * placeholders.
 */
export const sweepStaleMediaGenerations = mutation({
  args: {
    storyboardId: v.id("storyboards"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const cutoff = Date.now() - STALE_MEDIA_THRESHOLD_MS;
    const candidates = await ctx.db
      .query("mediaAssets")
      .withIndex("by_storyboard_createdAt", (q) => q.eq("storyboardId", args.storyboardId))
      .collect();
    let swept = 0;
    for (const row of candidates) {
      if (row.status === "pending" && row.updatedAt < cutoff) {
        await ctx.db.patch(row._id, {
          status: "failed",
          metadata: {
            ...(row.metadata ?? {}),
            error: "Generation exceeded the stale threshold and was marked failed by the sweeper.",
          },
          updatedAt: Date.now(),
        });
        swept += 1;
      }
    }
    return { swept };
  },
});

/**
 * Compensation for partial batch failures in `executeApprovedExecutionPlan`:
 * given a set of mediaAsset IDs that were created by earlier successful ops in
 * a batch which subsequently failed, flip each row to `"rolled_back"` and
 * remove it from its node's active media arrays. Preserves the row + prompt
 * for audit so reviewers can see what was generated and then reverted.
 *
 * Idempotent: rows already in `rolled_back`/`failed` are skipped. Rows still
 * `pending` are fast-forwarded to `rolled_back` (a concurrent complete call
 * that races this will short-circuit because it checks `status === "pending"`
 * before patching the node).
 */
export const revertBatchMediaAssets = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    mediaAssetIds: v.array(v.id("mediaAssets")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const now = Date.now();
    const reason = args.reason?.slice(0, 500);

    // Build a set for O(1) lookup when cleaning each node's media arrays.
    const rollbackSet = new Set<string>(args.mediaAssetIds.map((id) => String(id)));

    // Track which nodes need patching. We may encounter the same node
    // multiple times (one batch can touch the same node multiple ops, though
    // unusual) so dedupe by nodeId.
    const touchedNodeIds = new Set<string>();
    let reverted = 0;
    let skipped = 0;

    for (const assetId of args.mediaAssetIds) {
      const asset = await ctx.db.get(assetId);
      if (!asset) {
        skipped += 1;
        continue;
      }
      if (asset.storyboardId !== args.storyboardId) {
        // Wrong storyboard: caller error, but fail soft rather than abort
        // mid-loop and leave some assets compensated and others not.
        skipped += 1;
        continue;
      }
      if (asset.status === "rolled_back" || asset.status === "failed") {
        skipped += 1;
        continue;
      }
      await ctx.db.patch(assetId, {
        status: "rolled_back",
        metadata: {
          ...(asset.metadata ?? {}),
          ...(reason ? { rollbackReason: reason } : {}),
          rolledBackAt: String(now),
        },
        updatedAt: now,
      });
      touchedNodeIds.add(asset.nodeId);
      reverted += 1;
    }

    // Strip the reverted assets out of each affected node's media arrays and
    // clear activeImageId/activeVideoId if they point at a rolled-back asset.
    for (const nodeId of touchedNodeIds) {
      const node = await ctx.db
        .query("storyboardNodes")
        .withIndex("by_storyboard_node", (q) =>
          q.eq("storyboardId", args.storyboardId).eq("nodeId", nodeId),
        )
        .unique();
      if (!node) continue;
      const nextImages = node.media.images.filter(
        (entry) => !rollbackSet.has(String(entry.mediaAssetId)),
      );
      const nextVideos = node.media.videos.filter(
        (entry) => !rollbackSet.has(String(entry.mediaAssetId)),
      );
      const nextActiveImage =
        node.media.activeImageId && rollbackSet.has(String(node.media.activeImageId))
          ? nextImages[nextImages.length - 1]?.mediaAssetId
          : node.media.activeImageId;
      const nextActiveVideo =
        node.media.activeVideoId && rollbackSet.has(String(node.media.activeVideoId))
          ? nextVideos[nextVideos.length - 1]?.mediaAssetId
          : node.media.activeVideoId;
      await ctx.db.patch(node._id, {
        media: {
          images: nextImages,
          videos: nextVideos,
          activeImageId: nextActiveImage,
          activeVideoId: nextActiveVideo,
        },
        updatedAt: now,
      });
    }

    await recomputeStoryboardStatsInternal(ctx, args.storyboardId);

    return { reverted, skipped };
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
