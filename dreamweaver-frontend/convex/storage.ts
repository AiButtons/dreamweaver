import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./storyboardAccess";

/**
 * Server-side handle around Convex's built-in file storage. Used by the
 * AutoCameo upload flow (M3 #6) to replace the data-URL MVP with a
 * proper blob reference:
 *
 *   1. Client calls `storage:generateCameoUploadUrl` → short-lived POST URL.
 *   2. Client POSTs the watermarked PNG bytes to that URL directly; Convex
 *      returns a `{ storageId }`.
 *   3. Client passes `storageId` to `identityReferences:addCameoReference`,
 *      which resolves the storage row to an HTTPS URL via
 *      `storage:getStorageUrl` (or `storage:resolveStorageUrl` at read
 *      time) and stores that URL on `sourceUrl`.
 *
 * The split between `getStorageUrl` (caller supplies an id after upload)
 * and `resolveStorageUrl` (read-path helper) keeps mutation/query
 * semantics clean without forcing callers to pre-resolve.
 */

/**
 * Issues a short-lived (~15 min) POST URL that the client PUTs a blob
 * into. The URL is single-use for one blob upload and can only be
 * obtained by an authenticated user.
 */
export const generateCameoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Resolves a storage id to a publicly-fetchable HTTPS URL. Used right
 * after the client finishes the upload, before calling
 * `addCameoReference`. Separate from `resolveStorageUrl` (query) so the
 * caller can stamp a URL into a mutation input atomically.
 */
export const getStorageUrl = mutation({
  args: {
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) {
      throw new ConvexError(`Storage id ${args.storageId} not found`);
    }
    return url;
  },
});

/**
 * Read-path helper — the UI can ask for a fresh URL when it only has a
 * storage id (e.g. for re-rendering a cameo preview after the cache
 * expires). Returns null when the id is unknown so the UI can fall
 * back gracefully.
 */
export const resolveStorageUrl = query({
  args: {
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return await ctx.storage.getUrl(args.storageId);
  },
});
