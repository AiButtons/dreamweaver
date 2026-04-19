import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureStoryboardEditable, requireUser } from "./storyboardAccess";

// Portrait-view validator. Keep in sync with `src/lib/identity-portraits/types.ts`
// and the `identityReferenceAssets` table in `convex/schema.ts`.
const portraitViewValidator = v.union(
  v.literal("front"),
  v.literal("side"),
  v.literal("back"),
  v.literal("three_quarter"),
  v.literal("custom"),
);

/**
 * Attach a reference portrait to an identity pack. The pack must belong to
 * the same storyboard the caller owns. Always writes role="portrait" with
 * status="active"; wardrobe / cameo_reference rows will be introduced via a
 * separate mutation when their UIs land.
 */
export const addIdentityPortrait = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    ownerPackId: v.id("identityPacks"),
    portraitView: portraitViewValidator,
    sourceUrl: v.string(),
    modelId: v.optional(v.string()),
    prompt: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);

    // Defense-in-depth: verify the referenced pack exists and belongs to
    // this storyboard before letting the row attach. Without this, a pack
    // id from a different storyboard could be smuggled in.
    const pack = await ctx.db.get(args.ownerPackId);
    if (!pack || pack.storyboardId !== args.storyboardId) {
      throw new ConvexError("Identity pack not found for this storyboard");
    }

    const now = Date.now();
    return await ctx.db.insert("identityReferenceAssets", {
      storyboardId: args.storyboardId,
      userId,
      ownerPackId: args.ownerPackId,
      role: "portrait",
      portraitView: args.portraitView,
      sourceUrl: args.sourceUrl,
      modelId: args.modelId,
      prompt: args.prompt,
      notes: args.notes,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Soft-archive an identity reference row. We patch status rather than
 * deleting to preserve an audit trail; `listIdentityPortraitsForPack` hides
 * archived rows by default.
 */
export const removeIdentityReference = mutation({
  args: {
    referenceId: v.id("identityReferenceAssets"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const row = await ctx.db.get(args.referenceId);
    if (!row) {
      throw new ConvexError("Reference not found");
    }
    await ensureStoryboardEditable(ctx, row.storyboardId, userId);
    await ctx.db.patch(row._id, {
      status: "archived",
      updatedAt: Date.now(),
    });
    return row._id;
  },
});

/**
 * List portrait-role references for a single identity pack, oldest first.
 * Stable ordering is intentional: the UI layers canonical view ordering on
 * top via `orderPortraitsCanonically`, so the server just returns rows by
 * creation time. Archived rows are hidden unless `includeArchived` is true.
 */
export const listIdentityPortraitsForPack = query({
  args: {
    storyboardId: v.id("storyboards"),
    ownerPackId: v.id("identityPacks"),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);

    const rows = await ctx.db
      .query("identityReferenceAssets")
      .withIndex("by_owner_pack_createdAt", (q) =>
        q.eq("ownerPackId", args.ownerPackId),
      )
      .collect();

    const includeArchived = args.includeArchived === true;
    return rows.filter(
      (row) =>
        row.storyboardId === args.storyboardId &&
        row.role === "portrait" &&
        (includeArchived || row.status === "active"),
    );
  },
});
