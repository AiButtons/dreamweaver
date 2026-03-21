import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { getToken } from "@/lib/auth-server";

type SecretHandleMutationAction = "revoke" | "activate" | "update";
type SecretHandlesRouteErrorCode = "unauthorized" | "bad_request" | "internal_error";

type SecretHandlesRouteError = Error & {
  code?: SecretHandlesRouteErrorCode;
};

const queryRef = (path: string) =>
  path as unknown as FunctionReference<"query">;

const mutationRef = (path: string) =>
  path as unknown as FunctionReference<"mutation">;

const toRouteError = (
  code: SecretHandlesRouteErrorCode,
  message: string,
): SecretHandlesRouteError => {
  const error = new Error(message) as SecretHandlesRouteError;
  error.code = code;
  return error;
};

const toErrorResponse = (
  error: unknown,
  fallbackMessage: string,
  fallbackStatus: number,
) => {
  const routeError = error as SecretHandlesRouteError;
  const message = routeError instanceof Error ? routeError.message : fallbackMessage;
  const status = routeError.code === "unauthorized"
    ? 401
    : routeError.code === "bad_request"
      ? 400
      : fallbackStatus;
  return NextResponse.json({ error: message }, { status });
};

const getAuthedConvexClient = async () => {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw toRouteError("internal_error", "NEXT_PUBLIC_CONVEX_URL is not configured.");
  }
  const token = await getToken();
  if (!token) {
    throw toRouteError("unauthorized", "Unauthorized");
  }
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  return client;
};

export const GET = async (request: NextRequest) => {
  try {
    const client = await getAuthedConvexClient();
    const provider = request.nextUrl.searchParams.get("provider") ?? undefined;
    const includeRevoked = request.nextUrl.searchParams.get("includeRevoked") === "true";
    const handles = await client.query(queryRef("secretHandles:listHandles"), {
      provider,
      includeRevoked,
    });
    return NextResponse.json({ handles }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error, "Failed to list secret handles.", 500);
  }
};

export const POST = async (request: NextRequest) => {
  try {
    const body = await request.json() as {
      handleId?: string;
      provider: string;
      scope: string;
      secretRef: string;
    };
    if (!body.provider || !body.scope || !body.secretRef) {
      throw toRouteError("bad_request", "provider, scope, and secretRef are required.");
    }
    const client = await getAuthedConvexClient();
    const created = await client.mutation(mutationRef("secretHandles:createHandle"), {
      handleId: body.handleId,
      provider: body.provider,
      scope: body.scope,
      secretRef: body.secretRef,
    });
    return NextResponse.json({ handle: created }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "Failed to create secret handle.", 400);
  }
};

export const PATCH = async (request: NextRequest) => {
  try {
    const body = await request.json() as {
      handleId: string;
      action: SecretHandleMutationAction;
      provider?: string;
      scope?: string;
      secretRef?: string;
    };
    if (!body.handleId || !body.action) {
      throw toRouteError("bad_request", "handleId and action are required.");
    }
    const client = await getAuthedConvexClient();
    if (body.action === "activate") {
      const handle = await client.mutation(mutationRef("secretHandles:activateHandle"), {
        handleId: body.handleId,
      });
      return NextResponse.json({ handle }, { status: 200 });
    }
    if (body.action === "revoke") {
      const handle = await client.mutation(mutationRef("secretHandles:revokeHandle"), {
        handleId: body.handleId,
      });
      return NextResponse.json({ handle }, { status: 200 });
    }
    const handle = await client.mutation(mutationRef("secretHandles:updateHandle"), {
      handleId: body.handleId,
      provider: body.provider,
      scope: body.scope,
      secretRef: body.secretRef,
    });
    return NextResponse.json({ handle }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error, "Failed to update secret handle.", 400);
  }
};

export const DELETE = async (request: NextRequest) => {
  try {
    const body = await request.json() as { handleId: string };
    if (!body.handleId) {
      throw toRouteError("bad_request", "handleId is required.");
    }
    const client = await getAuthedConvexClient();
    const result = await client.mutation(mutationRef("secretHandles:deleteHandle"), {
      handleId: body.handleId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return toErrorResponse(error, "Failed to delete secret handle.", 400);
  }
};
