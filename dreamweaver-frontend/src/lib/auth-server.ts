import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const convexSiteUrl = process.env.CONVEX_SITE_URL
  ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL
  ?? "";

export const { handler, getToken } = convexBetterAuthNextJs({
  convexUrl,
  convexSiteUrl,
});
