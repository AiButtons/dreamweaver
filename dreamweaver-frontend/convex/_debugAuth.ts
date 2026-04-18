import { v } from "convex/values";

import { action, mutation, query } from "./_generated/server";
import { createAuth } from "./auth";

export const inspectAuthEnv = query({
  args: {},
  handler: async () => {
    return {
      SITE_URL: process.env.SITE_URL ?? null,
      CONVEX_SITE_URL: process.env.CONVEX_SITE_URL ?? null,
      BETTER_AUTH_SECRET_SET: Boolean(process.env.BETTER_AUTH_SECRET),
      BETTER_AUTH_SECRET_LENGTH: process.env.BETTER_AUTH_SECRET?.length ?? 0,
    };
  },
});

export const inspectAuthRuntime = query({
  args: {},
  handler: async (ctx) => {
    const auth = createAuth(ctx);
    const apiKeys = Object.keys(auth.api ?? {});
    return {
      hasHandler: typeof auth.handler === "function",
      apiKeyCount: apiKeys.length,
      apiKeys: apiKeys.slice(0, 40),
    };
  },
});

export const probeAuthSignIn = mutation({
  args: {},
  handler: async (ctx) => {
    const auth = createAuth(ctx);
    const request = new Request("https://hardy-tern-884.eu-west-1.convex.site/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3002",
        referer: "http://127.0.0.1:3002/auth",
      },
      body: JSON.stringify({
        email: "nobody@example.com",
        password: "Passw0rd123",
      }),
    });
    const response = await auth.handler(request);
    const text = await response.text();
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: text,
    };
  },
});

export const probeAuthSignUp = mutation({
  args: {},
  handler: async (ctx) => {
    const auth = createAuth(ctx);
    const email = `probe_${Date.now()}_${Math.floor(Math.random() * 100000)}@example.com`;
    const request = new Request("http://127.0.0.1:3002/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3002",
        referer: "http://127.0.0.1:3002/auth",
      },
      body: JSON.stringify({
        name: "Probe User",
        email,
        password: "Passw0rd123",
        callbackURL: "/storyboard",
      }),
    });
    const response = await auth.handler(request);
    const text = await response.text();
    return {
      email,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: text,
    };
  },
});

/**
 * Dev-only: resets a user's password by email without requiring the old password
 * or an email-based reset token. Gated by BETTER_AUTH_ALLOW_DEV_PASSWORD_RESET
 * on the Convex deployment so it's impossible to enable by accident in prod.
 *
 * Looks up the user by email, hashes the new password with better-auth's
 * configured hasher, and writes it via internalAdapter.updatePassword (which
 * targets the providerId="credential" account row).
 */
export const resetPasswordDev = mutation({
  args: { email: v.string(), newPassword: v.string() },
  handler: async (ctx, { email, newPassword }) => {
    if (process.env.BETTER_AUTH_ALLOW_DEV_PASSWORD_RESET !== "true") {
      throw new Error(
        "Dev password reset is disabled. Set BETTER_AUTH_ALLOW_DEV_PASSWORD_RESET=true on the Convex deployment to enable.",
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new Error("Email is required.");
    }
    if (newPassword.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }

    const auth = createAuth(ctx);
    // `$context` is the resolved AuthContext; exposes password hasher + internalAdapter.
    const authContext = await (auth as unknown as { $context: Promise<AuthRuntimeContext> }).$context;

    const user = await authContext.internalAdapter.findUserByEmail(normalizedEmail);
    if (!user) {
      throw new Error(`No user found with email "${normalizedEmail}".`);
    }
    const userId = (user as { user?: { id?: string }; id?: string }).user?.id
      ?? (user as { id?: string }).id;
    if (!userId) {
      throw new Error("User record has no id field — database schema mismatch.");
    }

    const hashed = await authContext.password.hash(newPassword);
    await authContext.internalAdapter.updatePassword(userId, hashed);

    return { ok: true, email: normalizedEmail };
  },
});

type AuthRuntimeContext = {
  password: { hash: (plain: string) => Promise<string> };
  internalAdapter: {
    findUserByEmail: (email: string) => Promise<unknown>;
    updatePassword: (userId: string, hashedPassword: string) => Promise<void>;
  };
};

export const probeAuthSignUpAction = action({
  args: {},
  handler: async (ctx) => {
    const auth = createAuth(ctx as any);
    const email = `probe_action_${Date.now()}_${Math.floor(Math.random() * 100000)}@example.com`;
    const request = new Request("https://hardy-tern-884.eu-west-1.convex.site/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3002",
        referer: "http://127.0.0.1:3002/auth",
      },
      body: JSON.stringify({
        name: "Probe Action",
        email,
        password: "Passw0rd123",
        callbackURL: "/storyboard",
      }),
    });
    const response = await auth.handler(request);
    const text = await response.text();
    return {
      email,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: text,
    };
  },
});
