import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth";

import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import schema from "./auth_config/schema";

export const authComponent = createClient<DataModel, typeof schema>(
  components.betterAuth,
  {
    local: { schema },
    verbose: false,
  },
);

export const createAuthOptions = (
  ctx: GenericCtx<DataModel>,
): BetterAuthOptions => ({
  // On Convex, Better Auth routes are served from the Convex site URL.
  // Using SITE_URL here can cause origin checks to reject requests.
  baseURL: process.env.CONVEX_SITE_URL ?? process.env.SITE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: authComponent.adapter(ctx),
  // Requests originate from the Next.js app (e.g. http://127.0.0.1:3002) but are proxied
  // to the Convex site. Better Auth will 403 if the request Origin isn't trusted.
  trustedOrigins: [
    process.env.SITE_URL ? new URL(process.env.SITE_URL).origin : null,
    // Common local variant if the user opens the app via localhost instead of 127.0.0.1.
    process.env.SITE_URL?.includes("127.0.0.1") ? "http://localhost:3002" : null,
  ].filter((value): value is string => Boolean(value)),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  // When running the Next.js app on plain HTTP (e.g. http://127.0.0.1),
  // browsers will reject `Secure` cookies and `__Secure-` cookie prefixes.
  // Convex runs over HTTPS, so Better Auth defaults to secure cookies unless we override.
  // This override is safe for local development only.
  advanced:
    process.env.BETTER_AUTH_INSECURE_COOKIES === "true"
      || (process.env.SITE_URL?.startsWith("http://") ?? false)
      ? { useSecureCookies: false }
      : undefined,
  plugins: [convex({ authConfig })],
});

export const options = createAuthOptions({} as GenericCtx<DataModel>);

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));
