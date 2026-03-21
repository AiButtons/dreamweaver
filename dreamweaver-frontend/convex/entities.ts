import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureStoryboardEditable, requireUser } from "./storyboardAccess";

export const upsertCharacter = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    characterId: v.string(),
    name: v.string(),
    description: v.string(),
    identityProfile: v.object({
      facialMarkers: v.array(v.string()),
      ageBand: v.string(),
      bodySilhouette: v.string(),
      skinHairSignature: v.string(),
      voiceTags: v.array(v.string()),
    }),
    lockVersion: v.optional(v.number()),
    activeWardrobeVariantId: v.optional(v.id("wardrobeVariants")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const now = Date.now();
    const existing = await ctx.db
      .query("characters")
      .withIndex("by_storyboard_character", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("characterId", args.characterId),
      )
      .unique();
    if (!existing) {
      return await ctx.db.insert("characters", {
        storyboardId: args.storyboardId,
        userId,
        characterId: args.characterId,
        name: args.name,
        description: args.description,
        identityProfile: args.identityProfile,
        lockVersion: args.lockVersion ?? 1,
        activeWardrobeVariantId: args.activeWardrobeVariantId,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(existing._id, {
      name: args.name,
      description: args.description,
      identityProfile: args.identityProfile,
      lockVersion: args.lockVersion ?? existing.lockVersion + 1,
      activeWardrobeVariantId: args.activeWardrobeVariantId ?? existing.activeWardrobeVariantId,
      updatedAt: now,
    });
    await ctx.db.patch(args.storyboardId, { updatedAt: now });
    return existing._id;
  },
});

export const upsertWardrobeVariant = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    characterId: v.string(),
    variantId: v.string(),
    name: v.string(),
    description: v.string(),
    palette: v.array(v.string()),
    props: v.array(v.string()),
    hairMakeupDelta: v.string(),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const now = Date.now();
    const existing = await ctx.db
      .query("wardrobeVariants")
      .withIndex("by_character_variant", (q) =>
        q.eq("characterId", args.characterId).eq("variantId", args.variantId),
      )
      .unique();
    if (!existing) {
      return await ctx.db.insert("wardrobeVariants", {
        storyboardId: args.storyboardId,
        userId,
        characterId: args.characterId,
        variantId: args.variantId,
        name: args.name,
        description: args.description,
        palette: args.palette,
        props: args.props,
        hairMakeupDelta: args.hairMakeupDelta,
        isDefault: args.isDefault ?? false,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(existing._id, {
      name: args.name,
      description: args.description,
      palette: args.palette,
      props: args.props,
      hairMakeupDelta: args.hairMakeupDelta,
      isDefault: args.isDefault ?? existing.isDefault,
      updatedAt: now,
    });
    return existing._id;
  },
});

export const upsertBackground = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    backgroundId: v.string(),
    name: v.string(),
    description: v.string(),
    visualDirectives: v.array(v.string()),
    referenceImageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const now = Date.now();
    const existing = await ctx.db
      .query("backgrounds")
      .withIndex("by_storyboard_background", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("backgroundId", args.backgroundId),
      )
      .unique();
    if (!existing) {
      return await ctx.db.insert("backgrounds", {
        storyboardId: args.storyboardId,
        userId,
        backgroundId: args.backgroundId,
        name: args.name,
        description: args.description,
        visualDirectives: args.visualDirectives,
        referenceImageUrl: args.referenceImageUrl,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(existing._id, {
      name: args.name,
      description: args.description,
      visualDirectives: args.visualDirectives,
      referenceImageUrl: args.referenceImageUrl ?? existing.referenceImageUrl,
      updatedAt: now,
    });
    return existing._id;
  },
});

export const upsertScene = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    sceneId: v.string(),
    title: v.string(),
    synopsis: v.string(),
    location: v.optional(v.string()),
    timeOfDay: v.optional(v.string()),
    tone: v.optional(v.string()),
    characterIds: v.array(v.string()),
    backgroundId: v.optional(v.string()),
    continuityNotes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const now = Date.now();
    const existing = await ctx.db
      .query("scenes")
      .withIndex("by_storyboard_scene", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("sceneId", args.sceneId),
      )
      .unique();
    if (!existing) {
      return await ctx.db.insert("scenes", {
        storyboardId: args.storyboardId,
        userId,
        sceneId: args.sceneId,
        title: args.title,
        synopsis: args.synopsis,
        location: args.location,
        timeOfDay: args.timeOfDay,
        tone: args.tone,
        characterIds: args.characterIds,
        backgroundId: args.backgroundId,
        continuityNotes: args.continuityNotes,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(existing._id, {
      title: args.title,
      synopsis: args.synopsis,
      location: args.location ?? existing.location,
      timeOfDay: args.timeOfDay ?? existing.timeOfDay,
      tone: args.tone ?? existing.tone,
      characterIds: args.characterIds,
      backgroundId: args.backgroundId ?? existing.backgroundId,
      continuityNotes: args.continuityNotes,
      updatedAt: now,
    });
    return existing._id;
  },
});

export const upsertShot = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    shotId: v.string(),
    sceneId: v.optional(v.string()),
    title: v.string(),
    beat: v.string(),
    cameraMovement: v.optional(v.string()),
    framing: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    promptNotes: v.array(v.string()),
    characterIds: v.array(v.string()),
    backgroundId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const now = Date.now();
    const existing = await ctx.db
      .query("shots")
      .withIndex("by_storyboard_shot", (q) =>
        q.eq("storyboardId", args.storyboardId).eq("shotId", args.shotId),
      )
      .unique();
    if (!existing) {
      return await ctx.db.insert("shots", {
        storyboardId: args.storyboardId,
        userId,
        shotId: args.shotId,
        sceneId: args.sceneId,
        title: args.title,
        beat: args.beat,
        cameraMovement: args.cameraMovement,
        framing: args.framing,
        durationSec: args.durationSec,
        promptNotes: args.promptNotes,
        characterIds: args.characterIds,
        backgroundId: args.backgroundId,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(existing._id, {
      sceneId: args.sceneId ?? existing.sceneId,
      title: args.title,
      beat: args.beat,
      cameraMovement: args.cameraMovement ?? existing.cameraMovement,
      framing: args.framing ?? existing.framing,
      durationSec: args.durationSec ?? existing.durationSec,
      promptNotes: args.promptNotes,
      characterIds: args.characterIds,
      backgroundId: args.backgroundId ?? existing.backgroundId,
      updatedAt: now,
    });
    return existing._id;
  },
});

export const listEntityBundle = query({
  args: {
    storyboardId: v.id("storyboards"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, userId);
    const [characters, wardrobeVariants, backgrounds, scenes, shots] = await Promise.all([
      ctx.db
        .query("characters")
        .withIndex("by_storyboard_character", (q) => q.eq("storyboardId", args.storyboardId))
        .collect(),
      ctx.db
        .query("wardrobeVariants")
        .withIndex("by_storyboard_character", (q) => q.eq("storyboardId", args.storyboardId))
        .collect(),
      ctx.db
        .query("backgrounds")
        .withIndex("by_storyboard_background", (q) => q.eq("storyboardId", args.storyboardId))
        .collect(),
      ctx.db
        .query("scenes")
        .withIndex("by_storyboard_scene", (q) => q.eq("storyboardId", args.storyboardId))
        .collect(),
      ctx.db
        .query("shots")
        .withIndex("by_storyboard_shot", (q) => q.eq("storyboardId", args.storyboardId))
        .collect(),
    ]);
    return { characters, wardrobeVariants, backgrounds, scenes, shots };
  },
});
