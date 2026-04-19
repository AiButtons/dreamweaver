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
 * M3 #6 AutoCameo — attach a user-supplied cameo photo as a
 * `role="cameo_reference"` asset. Consent, watermark, and attribution are
 * required up-front so the shot-batch pipeline can honor them without
 * re-validating at render time.
 *
 * Rules:
 *   - `consentStatus` must be "approved" for the asset to be usable by
 *     the shot batch. "pending" and "denied" rows still persist for audit.
 *   - `watermarkApplied` must be true; a false value surfaces as a
 *     `ConvexError` so the UI cannot submit an un-watermarked real photo.
 *   - `cameoSourcePhotoHash` is the sha256 of the PRE-watermark bytes,
 *     recorded purely for forensic dedup — never displayed to the user.
 *   - Attribution text is mandatory and embedded into the asset's `notes`.
 *
 * See `src/lib/cameo/` for the client helpers that compute the hash and
 * apply the watermark before this mutation runs.
 */
export const addCameoReference = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    ownerPackId: v.id("identityPacks"),
    // Either `sourceUrl` (legacy data-URL MVP) or `cameoStorageId` (new
    // Convex storage path) must be provided. The storage path is
    // preferred; when both are set the storage id wins and sourceUrl is
    // re-resolved to the CDN URL before the row is written.
    sourceUrl: v.optional(v.string()),
    cameoStorageId: v.optional(v.id("_storage")),
    consentStatus: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied"),
    ),
    watermarkApplied: v.boolean(),
    attributionText: v.string(),
    cameoSourcePhotoHash: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);

    const pack = await ctx.db.get(args.ownerPackId);
    if (!pack || pack.storyboardId !== args.storyboardId) {
      throw new ConvexError("Identity pack not found for this storyboard");
    }

    if (!args.watermarkApplied) {
      throw new ConvexError(
        "Cameo references require an applied watermark. Apply the watermark before uploading.",
      );
    }
    const attribution = args.attributionText.trim();
    if (attribution.length === 0) {
      throw new ConvexError(
        "Cameo references require attribution text (who the photo depicts).",
      );
    }
    const photoHash = args.cameoSourcePhotoHash.trim();
    if (photoHash.length < 16) {
      throw new ConvexError("Cameo references require a valid photo hash.");
    }

    // Resolve source URL — prefer Convex storage over legacy data-URL.
    let sourceUrl: string;
    if (args.cameoStorageId) {
      const resolved = await ctx.storage.getUrl(args.cameoStorageId);
      if (!resolved) {
        throw new ConvexError(
          "Cameo storage id could not be resolved — was the upload completed?",
        );
      }
      sourceUrl = resolved;
    } else if (args.sourceUrl && args.sourceUrl.length > 0) {
      sourceUrl = args.sourceUrl;
    } else {
      throw new ConvexError(
        "addCameoReference requires either sourceUrl or cameoStorageId",
      );
    }

    const now = Date.now();
    const insertedId = await ctx.db.insert("identityReferenceAssets", {
      storyboardId: args.storyboardId,
      userId,
      ownerPackId: args.ownerPackId,
      role: "cameo_reference",
      portraitView: "custom",
      sourceUrl,
      notes: args.notes,
      status: "active",
      consentStatus: args.consentStatus,
      watermarkApplied: args.watermarkApplied,
      attributionText: attribution,
      uploadedByUserId: userId,
      cameoSourcePhotoHash: photoHash,
      cameoStorageId: args.cameoStorageId,
      createdAt: now,
      updatedAt: now,
    });

    // Tag the owning identity pack as cameo-backed so the character chip UI
    // can render a "CAMEO" badge. Idempotent — patching a pack that is
    // already "cameo" is a no-op.
    if (pack.sourceType !== "cameo") {
      await ctx.db.patch(args.ownerPackId, {
        sourceType: "cameo",
        updatedAt: now,
      });
    }

    return insertedId;
  },
});

/**
 * Flip consent status on an existing cameo row. Used when a reviewer
 * approves or denies a previously pending cameo. Does not allow flipping
 * non-cameo rows.
 */
export const reviewCameoReference = mutation({
  args: {
    referenceId: v.id("identityReferenceAssets"),
    decision: v.union(v.literal("approved"), v.literal("denied")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const row = await ctx.db.get(args.referenceId);
    if (!row) throw new ConvexError("Reference not found");
    await ensureStoryboardEditable(ctx, row.storyboardId, userId);
    if (row.role !== "cameo_reference") {
      throw new ConvexError("Only cameo references can be reviewed.");
    }
    await ctx.db.patch(row._id, {
      consentStatus: args.decision,
      updatedAt: Date.now(),
    });
    return row._id;
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

/**
 * List every active portrait across every identity pack in a storyboard,
 * grouped by the pack's `sourceCharacterId` (the character identifier the
 * ViMax ingester uses to tag shots). Used by the shot-generation batch to
 * resolve `shot.entityRefs.characterIds` → reference-image URLs in a single
 * query instead of N sequential `listIdentityPortraitsForPack` calls.
 *
 * Packs without `sourceCharacterId` are grouped under their `name` so
 * manually-created packs still surface; callers may match either key.
 */
export const listPortraitsForStoryboard = query({
  args: {
    storyboardId: v.id("storyboards"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);

    const packs = await ctx.db
      .query("identityPacks")
      .withIndex("by_storyboard_pack", (q) => q.eq("storyboardId", args.storyboardId))
      .collect();
    const packsById = new Map<string, { key: string; name: string }>();
    for (const p of packs) {
      const key = p.sourceCharacterId && p.sourceCharacterId.length > 0
        ? p.sourceCharacterId
        : p.name;
      packsById.set(p._id, { key, name: p.name });
    }

    // One table scan per role via the compound index; we filter status +
    // pack membership in-memory. Cameo references are only included when
    // their consent status is "approved" — the shot-batch selector must
    // never pick up a pending/denied cameo.
    const portraitRows = await ctx.db
      .query("identityReferenceAssets")
      .withIndex("by_storyboard_role_createdAt", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("role", "portrait"),
      )
      .collect();
    const cameoRows = await ctx.db
      .query("identityReferenceAssets")
      .withIndex("by_storyboard_role_createdAt", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("role", "cameo_reference"),
      )
      .collect();

    const groups: Record<
      string,
      Array<{
        _id: string;
        portraitView: string | undefined;
        sourceUrl: string;
        createdAt: number;
        role?: "portrait" | "cameo_reference";
      }>
    > = {};
    for (const row of portraitRows) {
      if (row.status !== "active") continue;
      const meta = packsById.get(row.ownerPackId);
      if (!meta) continue;
      (groups[meta.key] ??= []).push({
        _id: String(row._id),
        portraitView: row.portraitView,
        sourceUrl: row.sourceUrl,
        createdAt: row.createdAt,
        role: "portrait",
      });
    }
    for (const row of cameoRows) {
      if (row.status !== "active") continue;
      // Hard consent gate — un-approved cameos are never surfaced to the
      // shot-batch pipeline. Pending rows show up in the cameo list UI
      // via `listCameoReferencesForPack` instead.
      if (row.consentStatus !== "approved") continue;
      const meta = packsById.get(row.ownerPackId);
      if (!meta) continue;
      (groups[meta.key] ??= []).push({
        _id: String(row._id),
        portraitView: row.portraitView,
        sourceUrl: row.sourceUrl,
        createdAt: row.createdAt,
        role: "cameo_reference",
      });
    }
    return { groups, packCount: packs.length };
  },
});

/**
 * List cameo references for a single identity pack, including pending +
 * denied rows. Used by the cameo-upload UI to show review state per row.
 */
export const listCameoReferencesForPack = query({
  args: {
    storyboardId: v.id("storyboards"),
    ownerPackId: v.id("identityPacks"),
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

    return rows
      .filter(
        (row) =>
          row.storyboardId === args.storyboardId &&
          row.role === "cameo_reference" &&
          row.status === "active",
      )
      .map((row) => ({
        _id: String(row._id),
        sourceUrl: row.sourceUrl,
        consentStatus: row.consentStatus ?? "pending",
        watermarkApplied: row.watermarkApplied ?? false,
        attributionText: row.attributionText ?? "",
        createdAt: row.createdAt,
      }));
  },
});
