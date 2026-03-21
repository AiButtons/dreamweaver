import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

const secretStatus = v.union(
  v.literal("active"),
  v.literal("revoked"),
);

const secretRefPattern = /^env:[A-Z][A-Z0-9_]*$/;

const requireUser = async (ctx: {
  auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> };
}) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Unauthorized");
  }
  return identity.tokenIdentifier;
};

const toStableId = (prefix: string, seed: string) => {
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33) ^ seed.charCodeAt(index);
  }
  return `${prefix}_${(hash >>> 0).toString(16)}`;
};

const sanitizeMetadata = (row: {
  _id: string;
  handleId: string;
  provider: string;
  scope: string;
  ownerUserId: string;
  status: "active" | "revoked";
  createdAt: number;
}) => ({
  _id: row._id,
  handleId: row.handleId,
  provider: row.provider,
  scope: row.scope,
  ownerUserId: row.ownerUserId,
  status: row.status,
  createdAt: row.createdAt,
});

const assertVaultAccessToken = (providedToken: string) => {
  const expectedToken = process.env.VAULT_ACCESS_TOKEN;
  if (!expectedToken || expectedToken.length < 24) {
    throw new ConvexError("Vault access token is not configured.");
  }
  if (providedToken !== expectedToken) {
    throw new ConvexError("Invalid vault access token.");
  }
};

export const createHandle = mutation({
  args: {
    handleId: v.optional(v.string()),
    provider: v.string(),
    scope: v.string(),
    secretRef: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    if (!secretRefPattern.test(args.secretRef)) {
      throw new ConvexError("secretRef must follow env:VAR_NAME format.");
    }

    const now = Date.now();
    const handleId = args.handleId && args.handleId.trim().length > 0
      ? args.handleId.trim()
      : toStableId("secret", `${ownerUserId}:${args.provider}:${args.scope}:${now}`);

    const existing = await ctx.db
      .query("secretHandles")
      .withIndex("by_owner_handle", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("handleId", handleId),
      )
      .unique();
    if (existing) {
      throw new ConvexError(`Handle already exists: ${handleId}`);
    }

    const docId = await ctx.db.insert("secretHandles", {
      handleId,
      provider: args.provider.trim(),
      scope: args.scope.trim(),
      ownerUserId,
      secretRef: args.secretRef.trim(),
      status: "active",
      createdAt: now,
    });
    const created = await ctx.db.get(docId);
    if (!created) {
      throw new ConvexError("Failed to create secret handle.");
    }
    return sanitizeMetadata({
      _id: String(created._id),
      handleId: created.handleId,
      provider: created.provider,
      scope: created.scope,
      ownerUserId: created.ownerUserId,
      status: created.status,
      createdAt: created.createdAt,
    });
  },
});

export const updateHandle = mutation({
  args: {
    handleId: v.string(),
    provider: v.optional(v.string()),
    scope: v.optional(v.string()),
    secretRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const row = await ctx.db
      .query("secretHandles")
      .withIndex("by_owner_handle", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("handleId", args.handleId),
      )
      .unique();
    if (!row) {
      throw new ConvexError("Secret handle not found.");
    }
    if (args.secretRef && !secretRefPattern.test(args.secretRef)) {
      throw new ConvexError("secretRef must follow env:VAR_NAME format.");
    }
    await ctx.db.patch(row._id, {
      provider: args.provider?.trim() ?? row.provider,
      scope: args.scope?.trim() ?? row.scope,
      secretRef: args.secretRef?.trim() ?? row.secretRef,
      status: row.status,
    });
    return sanitizeMetadata({
      _id: String(row._id),
      handleId: row.handleId,
      provider: args.provider?.trim() ?? row.provider,
      scope: args.scope?.trim() ?? row.scope,
      ownerUserId: row.ownerUserId,
      status: row.status,
      createdAt: row.createdAt,
    });
  },
});

export const revokeHandle = mutation({
  args: {
    handleId: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const row = await ctx.db
      .query("secretHandles")
      .withIndex("by_owner_handle", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("handleId", args.handleId),
      )
      .unique();
    if (!row) {
      throw new ConvexError("Secret handle not found.");
    }
    await ctx.db.patch(row._id, {
      status: "revoked",
    });
    return sanitizeMetadata({
      _id: String(row._id),
      handleId: row.handleId,
      provider: row.provider,
      scope: row.scope,
      ownerUserId: row.ownerUserId,
      status: "revoked",
      createdAt: row.createdAt,
    });
  },
});

export const activateHandle = mutation({
  args: {
    handleId: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const row = await ctx.db
      .query("secretHandles")
      .withIndex("by_owner_handle", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("handleId", args.handleId),
      )
      .unique();
    if (!row) {
      throw new ConvexError("Secret handle not found.");
    }
    await ctx.db.patch(row._id, {
      status: "active",
    });
    return sanitizeMetadata({
      _id: String(row._id),
      handleId: row.handleId,
      provider: row.provider,
      scope: row.scope,
      ownerUserId: row.ownerUserId,
      status: "active",
      createdAt: row.createdAt,
    });
  },
});

export const deleteHandle = mutation({
  args: {
    handleId: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const row = await ctx.db
      .query("secretHandles")
      .withIndex("by_owner_handle", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("handleId", args.handleId),
      )
      .unique();
    if (!row) {
      return { deleted: false };
    }
    await ctx.db.delete(row._id);
    return { deleted: true };
  },
});

export const listHandles = query({
  args: {
    provider: v.optional(v.string()),
    includeRevoked: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const rows = await ctx.db.query("secretHandles").collect();
    const filtered = rows
      .filter((row) => row.ownerUserId === ownerUserId)
      .filter((row) => (args.provider ? row.provider === args.provider : true))
      .filter((row) => args.includeRevoked ? true : row.status === "active")
      .sort((left, right) => Number(right.createdAt) - Number(left.createdAt));
    return filtered.map((row) =>
      sanitizeMetadata({
        _id: String(row._id),
        handleId: row.handleId,
        provider: row.provider,
        scope: row.scope,
        ownerUserId: row.ownerUserId,
        status: row.status,
        createdAt: row.createdAt,
      })
    );
  },
});

export const listHandlesAll = query({
  args: {
    includeRevoked: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const rows = await ctx.db.query("secretHandles").collect();
    const filtered = rows
      .filter((row) => row.ownerUserId === ownerUserId)
      .filter((row) => args.includeRevoked ? true : row.status === "active")
      .sort((left, right) => Number(right.createdAt) - Number(left.createdAt));
    return filtered.map((row) =>
      sanitizeMetadata({
        _id: String(row._id),
        handleId: row.handleId,
        provider: row.provider,
        scope: row.scope,
        ownerUserId: row.ownerUserId,
        status: row.status,
        createdAt: row.createdAt,
      })
    );
  },
});

export const getHandleMetadata = query({
  args: {
    handleId: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const row = await ctx.db
      .query("secretHandles")
      .withIndex("by_owner_handle", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("handleId", args.handleId),
      )
      .unique();
    if (!row) {
      return null;
    }
    return sanitizeMetadata({
      _id: String(row._id),
      handleId: row.handleId,
      provider: row.provider,
      scope: row.scope,
      ownerUserId: row.ownerUserId,
      status: row.status,
      createdAt: row.createdAt,
    });
  },
});

export const getHandleForServer = query({
  args: {
    handleId: v.string(),
    vaultAccessToken: v.string(),
  },
  handler: async (ctx, args) => {
    assertVaultAccessToken(args.vaultAccessToken);
    const rows = await ctx.db.query("secretHandles").collect();
    const row = rows.find((item) => item.handleId === args.handleId);
    if (!row || row.status !== "active") {
      return null;
    }
    return {
      handleId: row.handleId,
      provider: row.provider,
      scope: row.scope,
      status: row.status,
      secretRef: row.secretRef,
      createdAt: row.createdAt,
    };
  },
});

export const getHandleByProviderScopeForServer = query({
  args: {
    provider: v.string(),
    scope: v.string(),
    vaultAccessToken: v.string(),
  },
  handler: async (ctx, args) => {
    assertVaultAccessToken(args.vaultAccessToken);
    const rows = await ctx.db.query("secretHandles").collect();
    const match = rows
      .filter((row) => row.provider === args.provider)
      .sort((left, right) => Number(right.createdAt) - Number(left.createdAt))
      .find((row) => row.scope === args.scope && row.status === "active");
    if (!match) {
      return null;
    }
    return {
      handleId: match.handleId,
      provider: match.provider,
      scope: match.scope,
      status: match.status,
      secretRef: match.secretRef,
      createdAt: match.createdAt,
    };
  },
});
