import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { NextRequest } from "next/server";
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
