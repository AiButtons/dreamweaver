import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

const AUTH_BASE_PATH = "/api/auth";

http.route({
  path: "/api/ping",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const text = await request.text();
    return new Response(JSON.stringify({ ok: true, length: text.length }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }),
});

http.route({
  path: "/api/echo",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const text = await request.text();
    return new Response(
      JSON.stringify({
        ok: true,
        method: request.method,
        url: request.url,
        length: text.length,
        head: text.slice(0, 120),
        headers: Object.fromEntries(request.headers.entries()),
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }),
});

const bufferedBetterAuthHandler = httpAction(async (ctx, request) => {
  const auth = createAuth(ctx);

  // Convex HTTP requests provide a streaming body. Better Auth is reliable with
  // a buffered string body (matching how we probe it inside mutations).
  const method = request.method.toUpperCase();
  let bodyText: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    bodyText = await request.text();
  }

  const bufferedRequest = new Request(request.url, {
    method,
    headers: request.headers,
    body: bodyText,
  });

  return await auth.handler(bufferedRequest);
});

// Redirect root well-known to Convex-site well-known under /api/auth.
http.route({
  path: "/.well-known/openid-configuration",
  method: "GET",
  handler: httpAction(async () => {
    const siteUrl = process.env.CONVEX_SITE_URL ?? "";
    const url = `${siteUrl}${AUTH_BASE_PATH}/convex/.well-known/openid-configuration`;
    return Response.redirect(url);
  }),
});

http.route({
  pathPrefix: `${AUTH_BASE_PATH}/`,
  method: "GET",
  handler: bufferedBetterAuthHandler,
});

http.route({
  pathPrefix: `${AUTH_BASE_PATH}/`,
  method: "POST",
  handler: bufferedBetterAuthHandler,
});

const debugAuthHandler = httpAction(async (ctx, request) => {
  try {
    const auth = createAuth(ctx);
    const requestUrl = new URL(request.url);
    requestUrl.pathname = requestUrl.pathname.replace("/api/auth-debug", "/api/auth");
    const method = request.method.toUpperCase();
    let bodyText: string | undefined;
    if (method !== "GET" && method !== "HEAD") {
      bodyText = await request.text();
    }
    const rewrittenRequest = new Request(requestUrl.toString(), {
      method,
      headers: request.headers,
      body: bodyText,
    });
    return await auth.handler(rewrittenRequest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown auth error";
    const stack = error instanceof Error ? error.stack : null;
    return new Response(
      JSON.stringify({
        error: message,
        stack,
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
});

http.route({
  path: "/api/auth-debug/get-session",
  method: "GET",
  handler: debugAuthHandler,
});

http.route({
  path: "/api/auth-debug/convex/token",
  method: "GET",
  handler: debugAuthHandler,
});

http.route({
  path: "/api/auth-debug/sign-in/email",
  method: "POST",
  handler: debugAuthHandler,
});

http.route({
  path: "/api/auth-debug/sign-up/email",
  method: "POST",
  handler: debugAuthHandler,
});

export default http;
