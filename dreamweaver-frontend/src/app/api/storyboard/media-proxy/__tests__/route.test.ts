import { afterEach, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";

const resolveSecretByHandleIdMock = mock(async () => null);
const resolveSecretByProviderScopeMock = mock(async () => ({
  handleId: "handle_media",
  provider: "media_backend",
  scope: "storyboard_media",
  value: "media_secret_key",
}));
const toProviderAuthHeadersMock = mock((provider: string, secretValue: string) => ({
  Authorization: `Bearer ${provider}:${secretValue}`,
}));

mock.module("@/server/vault/adapter", () => ({
  resolveSecretByHandleId: resolveSecretByHandleIdMock,
  resolveSecretByProviderScope: resolveSecretByProviderScopeMock,
  toProviderAuthHeaders: toProviderAuthHeadersMock,
}));

const getTokenMock = mock(async (): Promise<string | null> => "convex_auth_token");
mock.module("@/lib/auth-server", () => ({
  getToken: getTokenMock,
}));

describe("media proxy route", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    getTokenMock.mockClear();
    resolveSecretByHandleIdMock.mockClear();
    resolveSecretByProviderScopeMock.mockClear();
    toProviderAuthHeadersMock.mockClear();
  });

  it("proxies allowed media endpoint with vault-derived auth headers", async () => {
    const { POST } = await import("@/app/api/storyboard/media-proxy/route");
    process.env.API_URL = "http://backend.local";
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe("http://backend.local/api/image/generate");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe("Bearer media_backend:media_secret_key");
      return new Response(
        JSON.stringify({ images: [{ url: "https://img.example/proxy.png" }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const request = new NextRequest("http://localhost/api/storyboard/media-proxy", {
      method: "POST",
      body: JSON.stringify({
        endpoint: "/api/image/generate",
        payload: { prompt: "test prompt" },
      }),
      headers: { "content-type": "application/json" },
    });
    const response = await POST(request);
    const json = await response.json() as {
      ok: boolean;
      status: number;
      data: { images: Array<{ url: string }> };
    };
    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.images[0]?.url).toBe("https://img.example/proxy.png");
    expect(resolveSecretByProviderScopeMock).toHaveBeenCalledTimes(1);
  });

  it("blocks endpoints outside allowlist", async () => {
    const { POST } = await import("@/app/api/storyboard/media-proxy/route");
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const request = new NextRequest("http://localhost/api/storyboard/media-proxy", {
      method: "POST",
      body: JSON.stringify({
        endpoint: "/api/system/delete-all",
        payload: {},
      }),
      headers: { "content-type": "application/json" },
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(called).toBe(false);
  });

  it("returns 401 when auth token is missing", async () => {
    const { POST } = await import("@/app/api/storyboard/media-proxy/route");
    getTokenMock.mockResolvedValueOnce(null);
    const request = new NextRequest("http://localhost/api/storyboard/media-proxy", {
      method: "POST",
      body: JSON.stringify({
        endpoint: "/api/image/generate",
        payload: { prompt: "x" },
      }),
      headers: { "content-type": "application/json" },
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
