import { NextRequest, NextResponse } from "next/server";
import {
  resolveSecretByHandleId,
  resolveSecretByProviderScope,
  toProviderAuthHeaders,
} from "@/server/vault/adapter";
import { getToken } from "@/lib/auth-server";

const allowedEndpoints = new Set([
  "/api/image/generate",
  "/api/image/compose",
  "/api/video/generate",
  "/api/consistency/evaluate",
]);

const getApiBaseUrl = () =>
  process.env.API_URL
  ?? process.env.NEXT_PUBLIC_API_URL
  ?? "http://localhost:8000";

export const POST = async (request: NextRequest) => {
  try {
    const token = await getToken();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json() as {
      endpoint: string;
      payload: Record<string, unknown>;
      provider?: string;
      scope?: string;
      handleId?: string;
    };

    if (!allowedEndpoints.has(body.endpoint)) {
      return NextResponse.json(
        { error: `Endpoint is not allowed: ${body.endpoint}` },
        { status: 403 },
      );
    }

    const provider = body.provider ?? "media_backend";
    const scope = body.scope ?? "storyboard_media";
    const resolved = body.handleId
      ? await resolveSecretByHandleId(body.handleId)
      : await resolveSecretByProviderScope(provider, scope);
    const authHeaders = resolved
      ? toProviderAuthHeaders(provider, resolved.value)
      : {};

    const response = await fetch(`${getApiBaseUrl()}${body.endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(body.payload ?? {}),
    });
    const text = await response.text();
    const parsed = (() => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return { raw: text };
      }
    })();

    return NextResponse.json(
      {
        status: response.status,
        ok: response.ok,
        data: parsed,
      },
      { status: response.status },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Media proxy request failed." },
      { status: 500 },
    );
  }
};
