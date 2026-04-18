const resolveConvexSiteUrl = () => {
  const fromEnv = process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
  if (!fromEnv) {
    throw new Error("CONVEX_SITE_URL is not set.");
  }

  let parsed: URL;
  try {
    parsed = new URL(fromEnv);
  } catch {
    throw new Error(
      `CONVEX_SITE_URL is not a valid URL. Expected https://<deployment>.convex.site. Received: ${fromEnv}`,
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `CONVEX_SITE_URL must use https. Expected https://<deployment>.convex.site. Received: ${fromEnv}`,
    );
  }

  if (!parsed.hostname.endsWith(".convex.site")) {
    throw new Error(
      `CONVEX_SITE_URL host must end with .convex.site (got "${parsed.hostname}"). `
        + `Common mistakes: using the .convex.cloud API URL, or the dashboard.convex.dev URL. `
        + `Received: ${fromEnv}`,
    );
  }

  const hasPath = parsed.pathname !== "" && parsed.pathname !== "/";
  if (hasPath || parsed.search || parsed.hash) {
    throw new Error(
      `CONVEX_SITE_URL must be a bare origin with no path/query/hash (auth routes are appended). Received: ${fromEnv}`,
    );
  }

  // Strip any trailing slash so target URLs concatenate cleanly.
  return `${parsed.protocol}//${parsed.host}`;
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

  // Buffer the request body before forwarding. Streaming `request.body` + `duplex: "half"`
  // through Next.js 16 / undici was raising `TypeError: fetch failed` with cause
  // `expected non-null body source` on POSTs (sign-in, sign-up). Buffering matches the
  // pattern `bufferedBetterAuthHandler` uses in convex/http.ts. Let undici recompute
  // Content-Length from the buffer to avoid a mismatch when upstream chunked encoding
  // was negotiated by Next.
  let forwardBody: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    forwardBody = await request.arrayBuffer();
    headers.delete("content-length");
  }

  const upstream = await fetch(targetUrl, {
    method,
    headers,
    body: forwardBody,
    redirect: "manual",
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
