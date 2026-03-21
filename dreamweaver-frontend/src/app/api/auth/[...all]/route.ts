const resolveConvexSiteUrl = () => {
  const fromEnv = process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
  if (!fromEnv) {
    throw new Error("CONVEX_SITE_URL is not set.");
  }
  if (fromEnv.endsWith(".convex.cloud")) {
    throw new Error(`CONVEX_SITE_URL must end with .convex.site. Received: ${fromEnv}`);
  }
  return fromEnv;
};

const forwardAuthRequest = async (request: Request) => {
  const siteUrl = resolveConvexSiteUrl();
  const requestUrl = new URL(request.url);
  const targetUrl = `${siteUrl}${requestUrl.pathname}${requestUrl.search}`;
  const headers = new Headers(request.headers);

  headers.delete("expect");
  // Prevent encoding mismatches when proxying through Node/Undici -> Next response stream.
  // We'll let the upstream decide and we'll return a normalized (identity) response body.
  headers.delete("accept-encoding");

  // Strip hop-by-hop headers.
  for (const hopHeader of [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]) {
    headers.delete(hopHeader);
  }

  // Keep content negotiation sane; don't override Accept-Encoding.
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }

  const method = request.method.toUpperCase();
  const upstream = await fetch(targetUrl, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : request.body,
    redirect: "manual",
    // Required when passing through a request stream in Node.js.
    // @ts-expect-error `duplex` exists at runtime for undici fetch.
    duplex: method === "GET" || method === "HEAD" ? undefined : "half",
  });

  // Normalize the response so browsers don't attempt to decode already-decoded bodies.
  const body = method === "HEAD" ? null : await upstream.arrayBuffer();
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  // Preserve multi-value Set-Cookie (undici exposes a non-standard helper).
  const getSetCookie = (upstream.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") {
    responseHeaders.delete("set-cookie");
    for (const cookie of getSetCookie.call(upstream.headers)) {
      responseHeaders.append("set-cookie", cookie);
    }
  }

  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};

export const GET = async (request: Request) => await forwardAuthRequest(request);
export const POST = async (request: Request) => await forwardAuthRequest(request);
