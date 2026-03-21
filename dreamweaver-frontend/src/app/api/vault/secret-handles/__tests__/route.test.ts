import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";

const getTokenMock = mock(async (): Promise<string | null> => "convex_auth_token");
const queryMock = mock(
  async (_path: unknown, _args: unknown, _authToken: string | null): Promise<unknown> => [],
);
const mutationMock = mock(
  async (_path: unknown, _args: unknown, _authToken: string | null): Promise<unknown> => ({}),
);

class MockConvexHttpClient {
  private authToken: string | null = null;
  constructor(_url: string) {}

  setAuth(token: string) {
    this.authToken = token;
  }

  async query(path: unknown, args: unknown) {
    return await queryMock(path, args, this.authToken);
  }

  async mutation(path: unknown, args: unknown) {
    return await mutationMock(path, args, this.authToken);
  }
}

mock.module("convex/browser", () => ({
  ConvexHttpClient: MockConvexHttpClient,
}));

mock.module("@/lib/auth-server", () => ({
  getToken: getTokenMock,
}));

describe("secret handles API route", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "http://convex.local";
    getTokenMock.mockResolvedValue("convex_auth_token");
    queryMock.mockReset();
    mutationMock.mockReset();
  });

  afterEach(() => {
    queryMock.mockReset();
    mutationMock.mockReset();
  });

  it("returns metadata-only handles via GET", async () => {
    const { GET } = await import("@/app/api/vault/secret-handles/route");
    queryMock.mockResolvedValueOnce([
      {
        handleId: "h_media",
        provider: "media_backend",
        scope: "storyboard_media",
        ownerUserId: "user_1",
        status: "active",
        createdAt: Date.now(),
      },
    ]);

    const request = new NextRequest("http://localhost/api/vault/secret-handles?provider=media_backend", {
      method: "GET",
    });
    const response = await GET(request);
    const json = await response.json() as {
      handles: Array<Record<string, unknown>>;
    };
    expect(response.status).toBe(200);
    expect(json.handles.length).toBe(1);
    expect("secretRef" in (json.handles[0] ?? {})).toBe(false);
  });

  it("creates a handle via POST", async () => {
    const { POST } = await import("@/app/api/vault/secret-handles/route");
    mutationMock.mockResolvedValueOnce({
      handleId: "h_langsmith",
      provider: "langsmith",
      scope: "observability",
      status: "active",
      createdAt: Date.now(),
    });

    const request = new NextRequest("http://localhost/api/vault/secret-handles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "langsmith",
        scope: "observability",
        secretRef: "env:LANGSMITH_KEY",
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const json = await response.json() as { handle: { handleId: string } };
    expect(json.handle.handleId).toBe("h_langsmith");
  });

  it("updates a handle via PATCH action=update", async () => {
    const { PATCH } = await import("@/app/api/vault/secret-handles/route");
    mutationMock.mockResolvedValueOnce({
      handleId: "h_langsmith",
      provider: "langsmith",
      scope: "observability",
      status: "active",
      createdAt: Date.now(),
    });
    const request = new NextRequest("http://localhost/api/vault/secret-handles", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handleId: "h_langsmith",
        action: "update",
        scope: "observability",
        secretRef: "env:LANGSMITH_KEY_NEXT",
      }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(200);
    const json = await response.json() as { handle: { handleId: string; scope: string } };
    expect(json.handle.handleId).toBe("h_langsmith");
    expect(json.handle.scope).toBe("observability");
  });

  it("revokes and activates handles via PATCH actions", async () => {
    const { PATCH } = await import("@/app/api/vault/secret-handles/route");
    mutationMock.mockResolvedValueOnce({
      handleId: "h_media",
      provider: "media_backend",
      scope: "storyboard_media",
      status: "revoked",
      createdAt: Date.now(),
    });
    const revokeRequest = new NextRequest("http://localhost/api/vault/secret-handles", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handleId: "h_media",
        action: "revoke",
      }),
    });
    const revokeResponse = await PATCH(revokeRequest);
    expect(revokeResponse.status).toBe(200);
    const revokeJson = await revokeResponse.json() as { handle: { status: string } };
    expect(revokeJson.handle.status).toBe("revoked");

    mutationMock.mockResolvedValueOnce({
      handleId: "h_media",
      provider: "media_backend",
      scope: "storyboard_media",
      status: "active",
      createdAt: Date.now(),
    });
    const activateRequest = new NextRequest("http://localhost/api/vault/secret-handles", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handleId: "h_media",
        action: "activate",
      }),
    });
    const activateResponse = await PATCH(activateRequest);
    expect(activateResponse.status).toBe(200);
    const activateJson = await activateResponse.json() as { handle: { status: string } };
    expect(activateJson.handle.status).toBe("active");
  });

  it("deletes handle via DELETE", async () => {
    const { DELETE } = await import("@/app/api/vault/secret-handles/route");
    mutationMock.mockResolvedValueOnce({ deleted: true });
    const request = new NextRequest("http://localhost/api/vault/secret-handles", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handleId: "h_media",
      }),
    });
    const response = await DELETE(request);
    expect(response.status).toBe(200);
    const json = await response.json() as { deleted: boolean };
    expect(json.deleted).toBe(true);
  });

  it("rejects requests when auth token is unavailable", async () => {
    const { GET } = await import("@/app/api/vault/secret-handles/route");
    getTokenMock.mockResolvedValueOnce(null);
    const request = new NextRequest("http://localhost/api/vault/secret-handles", {
      method: "GET",
    });
    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});
