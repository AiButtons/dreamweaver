import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";

type QueryArgs = Record<string, unknown> | "skip";
type MutationArgs = Record<string, unknown>;

const queryCalls = new Map<string, QueryArgs[]>();
const mutationCalls = new Map<string, MutationArgs[]>();
let routeStoryboardId = "sb_route_1";

const recordQuery = (key: string, args: QueryArgs) => {
  const calls = queryCalls.get(key) ?? [];
  calls.push(args);
  queryCalls.set(key, calls);
};

const recordMutation = (key: string, args: MutationArgs) => {
  const calls = mutationCalls.get(key) ?? [];
  calls.push(args);
  mutationCalls.set(key, calls);
};

mock.module("reactflow/dist/style.css", () => ({}));

mock.module("reactflow", () => {
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    useNodesState: <T,>(initial: T[]) => {
      const [state, setState] = React.useState(initial);
      return [state, setState, () => undefined] as const;
    },
    useEdgesState: <T,>(initial: T[]) => {
      const [state, setState] = React.useState(initial);
      return [state, setState, () => undefined] as const;
    },
    addEdge: <T,>(edge: T, list: T[]) => [...list, edge],
  };
});

mock.module("next/navigation", () => ({
  useParams: () => ({ storyboardId: routeStoryboardId }),
}));

mock.module("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "user_1" } },
      isPending: false,
    }),
  },
}));

mock.module("convex/react", () => ({
  useQuery: (ref: unknown, args: QueryArgs) => {
    const key = String(ref);
    recordQuery(key, args);
    if (args === "skip") {
      return undefined;
    }
    if (key === "storyboards:getStoryboardSnapshot") {
      return {
        storyboard: {
          _id: routeStoryboardId,
          title: "Route Storyboard",
          updatedAt: Date.now() - 20_000,
        },
        nodes: [],
        edges: [],
        approvals: [],
      };
    }
    if (
      key === "approvals:listForStoryboard"
      || key === "narrativeGit:listDelegations"
      || key === "toolAudits:listForStoryboard"
      || key === "dailies:listAutonomousDailies"
      || key === "dailies:listSimulationRuns"
      || key === "narrativeGit:listBranches"
      || key === "narrativeGit:listBranchCommits"
    ) {
      return [];
    }
    if (key === "continuityOS:listConstraintBundle") {
      return {
        continuityViolations: [],
      };
    }
    if (key === "agentTeams:listTeams") {
      return [];
    }
    if (key === "agentTeams:resolveEffectiveRuntimeConfig") {
      return null;
    }
    if (key === "quotas:getUsageSummary") {
      return null;
    }
    return undefined;
  },
  useMutation: (ref: unknown) => {
    const key = String(ref);
    return async (args: MutationArgs) => {
      recordMutation(key, args);
      if (key === "approvals:createTask") {
        return "task_1";
      }
      return null;
    };
  },
}));

mock.module("@/components/storyboard/StoryGraph", () => ({
  __esModule: true,
  default: () => <div data-testid="story-graph" />,
}));

mock.module("@/components/storyboard/ChatPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="chat-panel" />,
}));

mock.module("@/components/storyboard/PropertiesPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="properties-panel" />,
}));

mock.module("@/components/storyboard/CanvasToolbar", () => ({
  __esModule: true,
  default: () => <div data-testid="canvas-toolbar" />,
}));

mock.module("@/components/storyboard/StoryboardCopilotBridge", () => ({
  StoryboardCopilotBridge: () => <div data-testid="copilot-bridge" />,
}));

mock.module("@/components/storyboard/OutlinePanel", () => ({
  OutlinePanel: () => <div data-testid="outline-panel" />,
}));

mock.module("@/components/storyboard/ProductionHubDrawer", () => ({
  ProductionHubDrawer: () => <div data-testid="production-drawer" />,
}));

import StoryboardEditorRoutePage from "@/app/storyboard/[storyboardId]/page";

describe("Storyboard editor route persistence wiring", () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalActFlag = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;

  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://localhost/storyboard/sb_route_1",
    });
    Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
    Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
    Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
    Object.defineProperty(globalThis, "getComputedStyle", {
      value: dom.window.getComputedStyle.bind(dom.window),
      configurable: true,
    });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      value: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
      configurable: true,
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      value: (id: number) => clearTimeout(id),
      configurable: true,
    });
    routeStoryboardId = "sb_route_1";
    queryCalls.clear();
    mutationCalls.clear();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    cleanup();
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: originalDocument, configurable: true });
    Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true });
    Object.defineProperty(globalThis, "getComputedStyle", { value: undefined, configurable: true });
    Object.defineProperty(globalThis, "requestAnimationFrame", { value: undefined, configurable: true });
    Object.defineProperty(globalThis, "cancelAnimationFrame", { value: undefined, configurable: true });
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalActFlag;
  });

  it("uses route param storyboardId for snapshot query and touch mutation", async () => {
    const view = render(<StoryboardEditorRoutePage />);
    expect(view.getByTestId("story-graph")).toBeTruthy();

    await waitFor(() => {
      const snapshotCalls = queryCalls.get("storyboards:getStoryboardSnapshot") ?? [];
      expect(snapshotCalls.length).toBeGreaterThan(0);
      expect(snapshotCalls[0]).toMatchObject({ storyboardId: "sb_route_1" });
    });

    await waitFor(() => {
      const touchCalls = mutationCalls.get("storyboards:touchStoryboardOpened") ?? [];
      expect(touchCalls.length).toBe(1);
      expect(touchCalls[0]).toMatchObject({ storyboardId: "sb_route_1" });
    });
  });
});
