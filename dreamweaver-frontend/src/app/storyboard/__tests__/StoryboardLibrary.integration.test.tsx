import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import StoryboardLibraryPage from "@/app/storyboard/page";
import type { StoryboardLibraryItem, StoryboardTemplate } from "@/app/storyboard/types";

type SessionEnvelope = {
  user?: { id?: string | null } | null;
  session?: { id?: string | null } | null;
} | null;

type QueryArgs = Record<string, unknown> | "skip";
type MutationArgs = Record<string, unknown>;

const routerPushCalls: string[] = [];
const mutationCalls = new Map<string, MutationArgs[]>();

const mutationReturnValues = new Map<string, unknown>([
  ["storyboards:createStoryboardFromTemplate", "sb_new_1"],
  ["storyboards:duplicateStoryboard", "sb_copy_1"],
  ["storyboards:renameStoryboard", "sb_active_1"],
  ["storyboards:setStoryboardPinned", "sb_active_1"],
  ["storyboards:trashStoryboard", "sb_active_1"],
  ["storyboards:restoreStoryboard", "sb_trashed_1"],
  ["storyboards:deleteStoryboardPermanently", { purged: true }],
  ["storyboards:backfillStoryboardMetadata", { updated: 1 }],
]);

const state: {
  session: { data: SessionEnvelope; isPending: boolean };
  activeRows: StoryboardLibraryItem[];
  trashedRows: StoryboardLibraryItem[];
  templates: StoryboardTemplate[];
  lastLibraryArgs: QueryArgs;
} = {
  session: {
    data: { user: { id: "user_1" } },
    isPending: false,
  },
  activeRows: [],
  trashedRows: [],
  templates: [],
  lastLibraryArgs: "skip",
};

const asRecord = (value: QueryArgs): Record<string, unknown> => {
  if (value === "skip") {
    return {};
  }
  return value;
};

const getMutationCalls = (key: string) => mutationCalls.get(key) ?? [];

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: (path: string) => {
      routerPushCalls.push(path);
    },
  }),
}));

mock.module("convex/react", () => ({
  useQuery: (ref: unknown, args: QueryArgs) => {
    const key = String(ref);
    if (args === "skip") {
      return undefined;
    }
    if (key === "storyboards:listLibrary") {
      state.lastLibraryArgs = args;
      const status = asRecord(args).status;
      return status === "trashed" ? state.trashedRows : state.activeRows;
    }
    if (key === "storyboards:listTemplates") {
      return state.templates;
    }
    return undefined;
  },
  useMutation: (ref: unknown) => {
    const key = String(ref);
    return async (args: MutationArgs) => {
      const calls = mutationCalls.get(key) ?? [];
      calls.push(args);
      mutationCalls.set(key, calls);
      return mutationReturnValues.get(key);
    };
  },
}));

mock.module("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => state.session,
  },
}));

mock.module("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

mock.module("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  ),
}));

describe("Storyboard library persistence flow", () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalPrompt = globalThis.prompt;
  const originalActFlag = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;

  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://localhost/storyboard",
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

    routerPushCalls.length = 0;
    mutationCalls.clear();
    state.lastLibraryArgs = "skip";
    state.session = {
      data: { user: { id: "user_1" } },
      isPending: false,
    };
    state.activeRows = [
      {
        _id: "sb_active_1",
        title: "The Grand Entrance",
        description: "Haunted mansion opener.",
        status: "active",
        isPinned: false,
        updatedAt: Date.now() - 30_000,
        createdAt: Date.now() - 1_000_000,
        nodeCount: 6,
        edgeCount: 5,
        imageCount: 3,
        videoCount: 1,
      },
    ];
    state.trashedRows = [
      {
        _id: "sb_trashed_1",
        title: "Discarded Branch",
        description: "Old variation",
        status: "trashed",
        isPinned: false,
        updatedAt: Date.now() - 120_000,
        createdAt: Date.now() - 2_000_000,
        nodeCount: 2,
        edgeCount: 1,
        imageCount: 0,
        videoCount: 0,
      },
    ];
    state.templates = [
      {
        templateId: "blank_canvas",
        name: "Blank Canvas",
        description: "Start from scratch.",
        visualTheme: "cinematic_studio",
        mode: "graph_studio",
      },
    ];

    const promptImpl = (message?: string) => {
      if (message?.includes("Rename")) {
        return "Renamed Board";
      }
      if (message?.includes("Duplicate")) {
        return "Copy of The Grand Entrance";
      }
      return "Untitled";
    };
    Object.defineProperty(globalThis, "prompt", { value: promptImpl, configurable: true });
    Object.defineProperty(dom.window, "prompt", { value: promptImpl, configurable: true });

    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    cleanup();
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: originalDocument, configurable: true });
    Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true });
    Object.defineProperty(globalThis, "prompt", { value: originalPrompt, configurable: true });
    Object.defineProperty(globalThis, "getComputedStyle", { value: undefined, configurable: true });
    Object.defineProperty(globalThis, "requestAnimationFrame", { value: undefined, configurable: true });
    Object.defineProperty(globalThis, "cancelAnimationFrame", { value: undefined, configurable: true });
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = originalActFlag;
  });

  it("renders saved storyboards and opens a selected project route", async () => {
    const view = render(<StoryboardLibraryPage />);

    expect(view.getByText("Storyboard Library")).toBeTruthy();
    expect(view.getByText("The Grand Entrance")).toBeTruthy();
    expect(view.getByText("6 nodes")).toBeTruthy();
    expect(view.getByText("3 images")).toBeTruthy();
    expect(view.getByText("1 videos")).toBeTruthy();

    fireEvent.click(view.getByRole("heading", { name: "The Grand Entrance" }));

    await waitFor(() => {
      expect(routerPushCalls).toContain("/storyboard/sb_active_1");
    });

    await waitFor(() => {
      expect(getMutationCalls("storyboards:backfillStoryboardMetadata").length).toBe(1);
    });
  });

  it("creates from template and navigates to route-based editor", async () => {
    const view = render(<StoryboardLibraryPage />);

    fireEvent.click(await view.findByRole("button", { name: /blank canvas/i }));

    await waitFor(() => {
      const createCalls = getMutationCalls("storyboards:createStoryboardFromTemplate");
      expect(createCalls.length).toBe(1);
      expect(createCalls[0]).toMatchObject({ templateId: "blank_canvas", title: "Blank Canvas" });
      expect(routerPushCalls).toContain("/storyboard/sb_new_1");
    });
  });

  it("supports rename, duplicate, pin, trash, restore, and permanent delete actions", async () => {
    const view = render(<StoryboardLibraryPage />);

    fireEvent.click(await view.findByText("Rename"));
    fireEvent.click(await view.findByText("Duplicate"));
    fireEvent.click(await view.findByText("Pin"));
    fireEvent.click(await view.findByText("Move to trash"));

    await waitFor(() => {
      expect(getMutationCalls("storyboards:renameStoryboard")[0]).toMatchObject({
        storyboardId: "sb_active_1",
        title: "Renamed Board",
      });
      expect(getMutationCalls("storyboards:duplicateStoryboard")[0]).toMatchObject({
        storyboardId: "sb_active_1",
        title: "Copy of The Grand Entrance",
      });
      expect(getMutationCalls("storyboards:setStoryboardPinned")[0]).toMatchObject({
        storyboardId: "sb_active_1",
        isPinned: true,
      });
      expect(getMutationCalls("storyboards:trashStoryboard")[0]).toMatchObject({
        storyboardId: "sb_active_1",
      });
      expect(routerPushCalls).toContain("/storyboard/sb_copy_1");
    });

    fireEvent.click(view.getByRole("button", { name: "Trash" }));
    expect(asRecord(state.lastLibraryArgs).status).toBe("trashed");

    fireEvent.click(await view.findByText("Restore"));
    fireEvent.click(await view.findByText("Delete permanently"));

    await waitFor(() => {
      expect(getMutationCalls("storyboards:restoreStoryboard")[0]).toMatchObject({
        storyboardId: "sb_trashed_1",
      });
      expect(getMutationCalls("storyboards:deleteStoryboardPermanently")[0]).toMatchObject({
        storyboardId: "sb_trashed_1",
      });
    });
  });
});
