import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { NextRequest, NextResponse } from "next/server";
import { getToken } from "@/lib/auth-server";
import { resolveSecretByHandleId, resolveSecretByProviderScope } from "@/server/vault/adapter";

const deploymentUrl = process.env.LANGGRAPH_STORYBOARD_DEPLOYMENT_URL ?? "http://localhost:8123";

const resolveLangsmithApiKey = async () => {
  const explicitHandleId = process.env.LANGSMITH_SECRET_HANDLE_ID;
  if (explicitHandleId) {
    try {
      const resolved = await resolveSecretByHandleId(explicitHandleId);
      if (resolved?.value) {
        return resolved.value;
      }
    } catch {
      // Fall back to env key or provider/scope lookup.
    }
  }
  try {
    const resolved = await resolveSecretByProviderScope("langsmith", "observability");
    if (resolved?.value) {
      return resolved.value;
    }
  } catch {
    // Fall back to plain env var.
  }
  return process.env.LANGSMITH_API_KEY ?? "";
};

const serviceAdapter = new ExperimentalEmptyAdapter();

export const POST = async (request: NextRequest) => {
  // Require an authenticated session before proxying to the LangGraph agent.
  // Unauthenticated callers cannot drive the agent, even though downstream
  // mutations have their own `requireUser` guard — we want the agent itself
  // to run only for signed-in users so prompts, audits, and tool calls all
  // attribute cleanly to a driver.
  let sessionToken: string | null | undefined = null;
  try {
    sessionToken = await getToken();
  } catch {
    sessionToken = null;
  }
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const langsmithApiKey = await resolveLangsmithApiKey();
  const storyboardAgent = new LangGraphAgent({
    deploymentUrl,
    graphId: "storyboard_agent",
    langsmithApiKey,
  });
  const runtime = new CopilotRuntime({
    agents: {
      storyboard_agent: storyboardAgent as unknown as never,
    },
  });
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit/storyboard",
  });
  return handleRequest(request);
};
