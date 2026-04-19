import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ensureStoryboardEditable, requireUser } from "./storyboardAccess";

// Cap stored bodies at this length so a pathological paste doesn't blow up
// row size or the UI render. Matches the envelope we use on error messages.
const MEDIA_COMMENT_MAX_BODY_LEN = 4000;

const clampTimecodeMs = (ms: number | undefined): number | undefined => {
  if (ms === undefined) return undefined;
  if (!Number.isFinite(ms)) return undefined;
  return Math.max(0, Math.floor(ms));
};

/**
 * Create a new comment on a media asset. When `parentCommentId` is provided
 * the result is a reply — single-level threading is enforced here (a reply
 * to a reply is rejected), and the parent is required to belong to the same
 * asset so cross-asset threading is impossible.
 *
 * `timecodeMs` is clamped to >= 0. When a reply is posted the caller may
 * pass its own timecode but typical UX is to inherit the parent's timecode
 * upstream — this server path doesn't enforce inheritance.
 */
export const addMediaComment = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    mediaAssetId: v.id("mediaAssets"),
    body: v.string(),
    timecodeMs: v.optional(v.number()),
    parentCommentId: v.optional(v.id("mediaComments")),
    authorName: v.optional(v.string()),
    authorEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);

    const body = args.body.trim();
    if (body.length === 0) {
      throw new ConvexError("Comment body cannot be empty");
    }

    // Confirm the asset exists and belongs to the same storyboard as the
    // auth-checked context. This prevents a caller from dropping comments on
    // an asset they couldn't otherwise see.
    const asset = await ctx.db.get(args.mediaAssetId);
    if (!asset) {
      throw new ConvexError("Media asset not found");
    }
    if (asset.storyboardId !== args.storyboardId) {
      throw new ConvexError("Media asset does not belong to this storyboard");
    }

    if (args.parentCommentId) {
      const parent = await ctx.db.get(args.parentCommentId);
      if (!parent) {
        throw new ConvexError("Parent comment not found");
      }
      if (parent.mediaAssetId !== args.mediaAssetId) {
        throw new ConvexError("Parent comment belongs to a different asset");
      }
      if (parent.parentCommentId !== undefined) {
        throw new ConvexError("Replies to replies are not allowed (single-level threading)");
      }
    }

    const now = Date.now();
    const insertArgs: {
      storyboardId: Id<"storyboards">;
      mediaAssetId: Id<"mediaAssets">;
      userId: string;
      authorName?: string;
      authorEmail?: string;
      parentCommentId?: Id<"mediaComments">;
      timecodeMs?: number;
      body: string;
      status: "open";
      createdAt: number;
      updatedAt: number;
    } = {
      storyboardId: args.storyboardId,
      mediaAssetId: args.mediaAssetId,
      userId,
      body: body.slice(0, MEDIA_COMMENT_MAX_BODY_LEN),
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    if (args.authorName !== undefined) insertArgs.authorName = args.authorName;
    if (args.authorEmail !== undefined) insertArgs.authorEmail = args.authorEmail;
    if (args.parentCommentId !== undefined) insertArgs.parentCommentId = args.parentCommentId;
    const tc = clampTimecodeMs(args.timecodeMs);
    if (tc !== undefined) insertArgs.timecodeMs = tc;

    const commentId = await ctx.db.insert("mediaComments", insertArgs);
    return commentId;
  },
});

/**
 * Edit a comment's body. Only the original author may edit. A deleted
 * comment is immutable — the call is a no-op rather than throwing so stale
 * clients don't display a scary error on a comment they already saw removed.
 */
export const editMediaComment = mutation({
  args: {
    commentId: v.id("mediaComments"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) {
      throw new ConvexError("Comment not found");
    }
    if (comment.userId !== userId) {
      throw new ConvexError("Only the author can edit this comment");
    }
    if (comment.status === "deleted") {
      return args.commentId;
    }
    await ensureStoryboardEditable(ctx, comment.storyboardId, userId);
    const nextBody = args.body.trim();
    if (nextBody.length === 0) {
      throw new ConvexError("Comment body cannot be empty");
    }
    await ctx.db.patch(args.commentId, {
      body: nextBody.slice(0, MEDIA_COMMENT_MAX_BODY_LEN),
      updatedAt: Date.now(),
    });
    return args.commentId;
  },
});

/**
 * Soft-delete a comment: flips status to "deleted" and blanks the body with
 * a placeholder so prior revisions aren't leaked. Only the author can
 * delete. Replies to the deleted top-level remain so the conversation shape
 * is preserved — the UI is responsible for rendering "[deleted]" above them.
 */
export const deleteMediaComment = mutation({
  args: {
    commentId: v.id("mediaComments"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) {
      throw new ConvexError("Comment not found");
    }
    if (comment.userId !== userId) {
      throw new ConvexError("Only the author can delete this comment");
    }
    await ensureStoryboardEditable(ctx, comment.storyboardId, userId);
    if (comment.status === "deleted") {
      return args.commentId;
    }
    await ctx.db.patch(args.commentId, {
      status: "deleted",
      body: "[deleted]",
      updatedAt: Date.now(),
    });
    return args.commentId;
  },
});

/**
 * Resolve/reopen a comment. Any user with storyboard-edit access may resolve
 * or reopen (not just the author) — matches Frame.io's team-review flow
 * where a supervisor closes out notes from their staff.
 */
export const resolveMediaComment = mutation({
  args: {
    commentId: v.id("mediaComments"),
    resolved: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) {
      throw new ConvexError("Comment not found");
    }
    await ensureStoryboardEditable(ctx, comment.storyboardId, userId);
    if (comment.status === "deleted") {
      throw new ConvexError("Deleted comments cannot be resolved or reopened");
    }
    const now = Date.now();
    const patch: {
      status: "open" | "resolved";
      updatedAt: number;
      resolvedAt?: number;
      resolvedByUserId?: string;
    } = {
      status: args.resolved ? "resolved" : "open",
      updatedAt: now,
    };
    if (args.resolved) {
      patch.resolvedAt = now;
      patch.resolvedByUserId = userId;
    }
    await ctx.db.patch(args.commentId, patch);
    return args.commentId;
  },
});

/**
 * List all comments on a given media asset. Deleted rows are excluded by
 * default (pass `includeDeleted: true` for audit views). Results are
 * returned in createdAt-ascending order; the UI uses `groupComments` to
 * split into top-level vs replies and to sort the top-level by timecode.
 */
export const listMediaComments = query({
  args: {
    mediaAssetId: v.id("mediaAssets"),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const asset = await ctx.db.get(args.mediaAssetId);
    if (!asset) {
      throw new ConvexError("Media asset not found");
    }
    await ensureStoryboardEditable(ctx, asset.storyboardId, userId);
    const rows = await ctx.db
      .query("mediaComments")
      .withIndex("by_asset_createdAt", (q) => q.eq("mediaAssetId", args.mediaAssetId))
      .order("asc")
      .collect();
    const includeDeleted = args.includeDeleted ?? false;
    return includeDeleted ? rows : rows.filter((r) => r.status !== "deleted");
  },
});

/**
 * List open comments across an entire storyboard, newest first. Used by any
 * storyboard-wide review inbox — not currently wired into the UI but
 * exposed now so downstream surfaces (Enhancement #5+) can opt in without a
 * schema/index change.
 */
export const listOpenCommentsForStoryboard = query({
  args: {
    storyboardId: v.id("storyboards"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const rows = await ctx.db
      .query("mediaComments")
      .withIndex("by_storyboard_status_createdAt", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("status", "open"),
      )
      .order("desc")
      .take(limit);
    return rows;
  },
});
