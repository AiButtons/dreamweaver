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
