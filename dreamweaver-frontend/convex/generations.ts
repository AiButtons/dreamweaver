import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

type AuthContext = {
  auth: {
    getUserIdentity: () => Promise<{ tokenIdentifier: string } | null>;
  };
};

const requireUser = async (ctx: AuthContext) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Unauthorized");
  }
  return identity.tokenIdentifier;
};

export const create = mutation({
  args: {
    kind: v.union(v.literal("image"), v.literal("video")),
    prompt: v.string(),
    modelId: v.string(),
    resultUrls: v.array(v.string()),
    status: v.union(v.literal("completed"), v.literal("failed")),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    return await ctx.db.insert("generations", {
      userId,
      kind: args.kind,
      prompt: args.prompt,
      modelId: args.modelId,
      resultUrls: args.resultUrls,
      status: args.status,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});

export const listMine = query({
  args: {
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);

    const rows = await ctx.db
      .query("generations")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);

    if (!args.kind) {
      return rows;
    }

    return rows.filter((row) => row.kind === args.kind);
  },
});
