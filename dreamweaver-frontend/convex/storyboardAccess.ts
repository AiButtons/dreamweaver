import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";

type AuthIdentity = { tokenIdentifier: string } | null;

type AuthCtx = {
  auth: {
    getUserIdentity: () => Promise<AuthIdentity>;
  };
};

type StoryboardRecord = {
  _id: Id<"storyboards">;
  userId: string;
  status?: "active" | "trashed";
};

type StoryboardDbCtx = {
  db: {
    get: (id: Id<"storyboards">) => Promise<StoryboardRecord | null>;
  };
};

export const requireUser = async (ctx: AuthCtx): Promise<string> => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Unauthorized");
  }
  return identity.tokenIdentifier;
};

export const ensureStoryboardOwner = async (
  ctx: StoryboardDbCtx,
  storyboardId: Id<"storyboards">,
  userId: string,
): Promise<StoryboardRecord> => {
  const storyboard = await ctx.db.get(storyboardId);
  if (!storyboard || storyboard.userId !== userId) {
    throw new ConvexError("Storyboard not found");
  }
  return storyboard;
};

export const ensureStoryboardEditable = async (
  ctx: StoryboardDbCtx,
  storyboardId: Id<"storyboards">,
  userId: string,
): Promise<StoryboardRecord> => {
  const storyboard = await ensureStoryboardOwner(ctx, storyboardId, userId);
  if ((storyboard.status ?? "active") !== "active") {
    throw new ConvexError("Storyboard is trashed");
  }
  return storyboard;
};

