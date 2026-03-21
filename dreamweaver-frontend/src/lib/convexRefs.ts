import type { FunctionReference } from "convex/server";

export const mutationRef = (path: string) =>
  path as unknown as FunctionReference<"mutation">;

export const queryRef = (path: string) =>
  path as unknown as FunctionReference<"query">;

