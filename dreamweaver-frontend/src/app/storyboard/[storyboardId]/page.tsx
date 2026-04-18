"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  useNodesState,
  useEdgesState,
  addEdge,
  OnConnect,
  Node,
  Connection,
  ReactFlowInstance,
  ReactFlowProvider,
  Edge,
} from "reactflow";
import { v4 as uuidv4 } from "uuid";
import { useMutation, useQuery } from "convex/react";
import "reactflow/dist/style.css";

import StoryGraph from "@/components/storyboard/StoryGraph";
import ChatPanel from "@/components/storyboard/ChatPanel";
import PropertiesPanel from "@/components/storyboard/PropertiesPanel";
import CanvasToolbar from "@/components/storyboard/CanvasToolbar";
import { StoryboardCopilotBridge } from "@/components/storyboard/StoryboardCopilotBridge";
import { OutlinePanel } from "@/components/storyboard/OutlinePanel";
import { ProductionHubDrawer } from "@/components/storyboard/ProductionHubDrawer";
import { mutationRef, queryRef } from "@/lib/convexRefs";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { createDefaultStoryNodeData } from "@/app/storyboard/defaults";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import {
  StoryNode,
  StoryEdge,
  ChatMessage,
  MediaType,
  NodeType,
  StoryboardMediaConfig,
  StoryNodeData,
  MediaVariant,
  QuotaUsageSummary,
  RuntimeResolvedTeam,
  TeamDefinition,
  TeamPromptDraft,
  TeamPolicy,
  TeamMemberConfig,
  ApprovalTaskRecord,
  AgentDelegationRecord,
  ToolCallAuditRecord,
  SimulationCriticRunRecord,
  AutonomousDailiesRecord,
  ConstraintBundle,
  NarrativeBranchRecord,
  NarrativeCommitRecord,
} from "@/app/storyboard/types";
import { generateStoryGraph, editNodeText, generateMedia } from "@/app/storyboard/services/apiService";

const generateId = () => uuidv4();
const INITIAL_NODES: StoryNode[] = [];
const INITIAL_EDGES: StoryEdge[] = [];
const EMPTY_APPROVALS: Array<{ _id: string; taskType: string; status: string; title: string }> = [];

type SnapshotNode = {
  nodeId: string;
  nodeType: NodeType;
  label: string;
  segment: string;
  position: { x: number; y: number };
  entityRefs?: StoryNodeData["entityRefs"];
  continuity?: StoryNodeData["continuity"];
  historyContext?: {
    eventIds: string[];
    rollingSummary: string;
    tokenBudgetUsed: number;
    lineageHash: string;
  };
  promptPack?: StoryNodeData["promptPack"];
  media?: {
    images: Array<{ mediaAssetId: string; url: string; modelId: string; createdAt: number }>;
    videos: Array<{ mediaAssetId: string; url: string; modelId: string; createdAt: number }>;
    activeImageId?: string;
    activeVideoId?: string;
  };
};

type SnapshotEdge = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: "serial" | "parallel" | "branch" | "merge";
  branchId?: string;
  order?: number;
  isPrimary?: boolean;
};

type SavedViewport = { x: number; y: number; zoom: number };

type StoryboardSnapshot = {
  storyboard:
    | {
        _id: string;
        title: string;
        updatedAt?: number;
        editorState?: { viewport?: SavedViewport } | null;
      }
    | null;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
  approvals: Array<{ _id: string; taskType: string; status: string; title: string }>;
};

type TeamSelectionPayload = {
  teamId: string;
  revisionId?: string;
};

type TeamRevisionRow = {
  revisionId: string;
  version: number;
  teamGoal: string;
  published: boolean;
  createdAt: number;
};

type AuthSessionEnvelope = {
  user?: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
  } | null;
  session?: { id?: string | null } | null;
} | null;

const mapNodeMedia = (
  nodeMedia: SnapshotNode["media"] | undefined,
): StoryNodeData["media"] => {
  if (!nodeMedia) {
    return { images: [], videos: [] };
  }
  const images: MediaVariant[] = nodeMedia.images.map((row) => ({
    id: row.mediaAssetId,
    kind: "image",
    url: row.url,
    modelId: row.modelId,
    prompt: "",
    status: "completed",
    createdAt: row.createdAt,
  }));
  const videos: MediaVariant[] = nodeMedia.videos.map((row) => ({
    id: row.mediaAssetId,
    kind: "video",
    url: row.url,
    modelId: row.modelId,
    prompt: "",
    status: "completed",
    createdAt: row.createdAt,
  }));
  return {
    images,
    videos,
    activeImageId: nodeMedia.activeImageId,
    activeVideoId: nodeMedia.activeVideoId,
  };
};

const toFlowEdge = (edge: SnapshotEdge): StoryEdge => ({
  id: edge.edgeId,
  source: edge.sourceNodeId,
  target: edge.targetNodeId,
  type: "smoothstep",
  animated: true,
  style: {
    stroke:
      edge.edgeType === "branch"
        ? "#fb7185"
        : edge.edgeType === "merge"
          ? "#6366f1"
          : edge.edgeType === "parallel"
            ? "#10b981"
            : "#94a3b8",
    strokeWidth: 2,
  },
  data: {
    edgeType: edge.edgeType,
    branchId: edge.branchId,
    order: edge.order,
    isPrimary: edge.isPrimary,
  },
});

const buildAncestry = (edges: StoryEdge[], nodeId: string) => {
  const lineage: string[] = [];
  let cursor: string | undefined = nodeId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    lineage.push(cursor);
    seen.add(cursor);
    const parent = edges.find((edge) => edge.target === cursor);
    cursor = parent?.source;
  }
  return lineage.reverse();
};

const formatSavedTime = (timestamp: number | undefined) => {
  if (!timestamp) return "Not saved yet";
  const delta = Date.now() - timestamp;
  if (delta < 10_000) return "Saved just now";
  if (delta < 60_000) return "Saved <1m ago";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `Saved ${minutes}m ago`;
  return `Saved ${new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

type StoryboardPageProps = {
  storyboardIdOverride?: string | null;
};

export default function StoryboardPage({ storyboardIdOverride = null }: StoryboardPageProps) {
  return (
    <ReactFlowProvider>
      <AppContent storyboardIdOverride={storyboardIdOverride} />
    </ReactFlowProvider>
  );
}

function AppContent({ storyboardIdOverride }: StoryboardPageProps) {
  const params = useParams<{ storyboardId: string }>();
  const storyboardMode = "graph_studio" as const;
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const [selectedNode, setSelectedNode] = useState<StoryNode | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "Welcome to StoryNodes. Start by describing your story idea, or add nodes manually.",
      timestamp: Date.now(),
    },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const activeStoryboardId = storyboardIdOverride ?? params?.storyboardId ?? null;
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [leftTab, setLeftTab] = useState<"outline" | "assistant">("outline");
  const [inspectorAnchor, setInspectorAnchor] = useState<{ x: number; y: number } | null>(null);
  const graphCanvasRef = useRef<HTMLDivElement | null>(null);
  const bootstrappedTeamsRef = useRef(false);
  const touchedStoryboardRef = useRef<string | null>(null);
  const sweptMediaRef = useRef<string | null>(null);
  const sessionState = authClient.useSession();
  const sessionData = (sessionState.data as AuthSessionEnvelope | undefined) ?? null;
  const isAuthLoading = sessionState.isPending;
  const isAuthenticated = Boolean(sessionData?.user?.id ?? sessionData?.session?.id);
  const userIdentity = useMemo(() => {
    const userId = sessionData?.user?.id ?? null;
    if (!userId) return null;
    return {
      userId,
      email: sessionData?.user?.email ?? null,
      name: sessionData?.user?.name ?? null,
    };
  }, [sessionData?.user?.id, sessionData?.user?.email, sessionData?.user?.name]);

  const snapshot = useQuery(
    queryRef("storyboards:getStoryboardSnapshot"),
    activeStoryboardId ? { storyboardId: activeStoryboardId } : "skip",
  ) as StoryboardSnapshot | null | undefined;
  const teams = useQuery(
    queryRef("agentTeams:listTeams"),
    isAuthenticated
      ? { includeArchived: false, includePrebuilt: true, limit: 100 }
      : "skip",
  ) as TeamDefinition[] | undefined;
  const runtimeTeam = useQuery(
    queryRef("agentTeams:resolveEffectiveRuntimeConfig"),
    activeStoryboardId ? { storyboardId: activeStoryboardId } : "skip",
  ) as RuntimeResolvedTeam | null | undefined;
  const activeTeamRevisions = useQuery(
    queryRef("agentTeams:listRevisions"),
    runtimeTeam?.teamId
      ? { teamId: runtimeTeam.teamId, limit: 50 }
      : "skip",
  ) as TeamRevisionRow[] | undefined;
  const quotaSummary = useQuery(
    queryRef("quotas:getUsageSummary"),
    runtimeTeam?.runtimePolicy.quotaProfileId
      ? { quotaProfileId: runtimeTeam.runtimePolicy.quotaProfileId }
      : "skip",
  ) as QuotaUsageSummary | undefined;
  const fullApprovals = useQuery(
    queryRef("approvals:listForStoryboard"),
    activeStoryboardId
      ? { storyboardId: activeStoryboardId, limit: 60 }
      : "skip",
  ) as ApprovalTaskRecord[] | undefined;
  const delegations = useQuery(
    queryRef("narrativeGit:listDelegations"),
    activeStoryboardId
      ? { storyboardId: activeStoryboardId, limit: 120 }
      : "skip",
  ) as AgentDelegationRecord[] | undefined;
  const toolAudits = useQuery(
    queryRef("toolAudits:listForStoryboard"),
    activeStoryboardId
      ? { storyboardId: activeStoryboardId, limit: 120 }
      : "skip",
  ) as ToolCallAuditRecord[] | undefined;
  const dailies = useQuery(
    queryRef("dailies:listAutonomousDailies"),
    activeStoryboardId
      ? { storyboardId: activeStoryboardId, limit: 40 }
      : "skip",
  ) as AutonomousDailiesRecord[] | undefined;
  const simulationRuns = useQuery(
    queryRef("dailies:listSimulationRuns"),
    activeStoryboardId
      ? { storyboardId: activeStoryboardId, limit: 40 }
      : "skip",
  ) as SimulationCriticRunRecord[] | undefined;
  const continuityBundle = useQuery(
    queryRef("continuityOS:listConstraintBundle"),
    activeStoryboardId
      ? { storyboardId: activeStoryboardId }
      : "skip",
  ) as ConstraintBundle | undefined;
  const branches = useQuery(
    queryRef("narrativeGit:listBranches"),
    activeStoryboardId
      ? { storyboardId: activeStoryboardId }
      : "skip",
  ) as NarrativeBranchRecord[] | undefined;
  const defaultBranchId = useMemo(() => {
    if (!branches || branches.length === 0) {
      return "main";
    }
    return branches.find((row) => row.isDefault)?.branchId ?? branches[0].branchId;
  }, [branches]);
  const branchCommits = useQuery(
    queryRef("narrativeGit:listBranchCommits"),
    activeStoryboardId
      ? { storyboardId: activeStoryboardId, branchId: defaultBranchId, limit: 40 }
      : "skip",
  ) as NarrativeCommitRecord[] | undefined;

  const upsertNode = useMutation(mutationRef("storyboards:upsertNode"));
  const deleteNode = useMutation(mutationRef("storyboards:deleteNode"));
  const upsertEdge = useMutation(mutationRef("storyboards:upsertEdge"));
  const recordEvent = useMutation(mutationRef("storyboards:recordStoryEvent"));
  const refreshHistory = useMutation(mutationRef("storyboards:refreshNodeHistoryContexts"));
  const startMediaGeneration = useMutation(mutationRef("mediaAssets:startMediaGeneration"));
  const completeMediaGeneration = useMutation(mutationRef("mediaAssets:completeMediaGeneration"));
  const failMediaGeneration = useMutation(mutationRef("mediaAssets:failMediaGeneration"));
  const sweepStaleMediaGenerations = useMutation(mutationRef("mediaAssets:sweepStaleMediaGenerations"));
  const bootstrapPrebuiltTeams = useMutation(mutationRef("agentTeams:bootstrapPrebuiltTeams"));
  const assignTeamToStoryboard = useMutation(mutationRef("agentTeams:assignTeamToStoryboard"));
  const createAgentTeam = useMutation(mutationRef("agentTeams:createTeam"));
  const generateTeamFromPrompt = useMutation(mutationRef("agentTeams:generateTeamFromPrompt"));
  const applyPromptDraftToRevision = useMutation(
    mutationRef("agentTeams:applyPromptDraftToRevision"),
  );
  const publishTeamRevision = useMutation(mutationRef("agentTeams:publishRevision"));
  const rollbackTeamRevision = useMutation(mutationRef("agentTeams:rollbackRevision"));
  const createTeamRevision = useMutation(mutationRef("agentTeams:createRevision"));
  const updateRevisionMember = useMutation(mutationRef("agentTeams:updateRevisionMember"));
  const generateAutonomousDailies = useMutation(mutationRef("dailies:generateAutonomousDailies"));
  const updateDailiesStatus = useMutation(mutationRef("dailies:updateDailiesStatus"));
  const runSimulationCritic = useMutation(mutationRef("dailies:runSimulationCritic"));
  const updateSimulationRunStatus = useMutation(
    mutationRef("dailies:updateSimulationRunStatus"),
  );
  const detectContradictions = useMutation(mutationRef("continuityOS:detectContradictions"));
  const resolveViolationMutation = useMutation(mutationRef("continuityOS:resolveViolation"));
  const publishIdentityPackMutation = useMutation(mutationRef("continuityOS:publishIdentityPack"));
  const createBranchMutation = useMutation(mutationRef("narrativeGit:createBranch"));
  const cherryPickCommitMutation = useMutation(mutationRef("narrativeGit:cherryPickCommit"));
  const computeSemanticDiffMutation = useMutation(mutationRef("narrativeGit:computeSemanticDiff"));
  const createApprovalTaskMutation = useMutation(mutationRef("approvals:createTask"));
  const resolveApprovalTaskMutation = useMutation(mutationRef("approvals:resolveTask"));
  const touchStoryboardOpened = useMutation(mutationRef("storyboards:touchStoryboardOpened"));
  const updateEditorStateMutation = useMutation(mutationRef("storyboards:updateEditorState"));

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }
    if (!isAuthenticated) return;
    if (!activeStoryboardId || bootstrappedTeamsRef.current) {
      return;
    }
    bootstrappedTeamsRef.current = true;
    void bootstrapPrebuiltTeams().catch((error) => {
      console.error("Failed to bootstrap prebuilt teams", error);
      bootstrappedTeamsRef.current = false;
    });
  }, [isAuthLoading, isAuthenticated, activeStoryboardId, bootstrapPrebuiltTeams]);

  useEffect(() => {
    if (!isAuthenticated || !activeStoryboardId) {
      return;
    }
    if (touchedStoryboardRef.current === activeStoryboardId) {
      return;
    }
    touchedStoryboardRef.current = activeStoryboardId;
    void touchStoryboardOpened({ storyboardId: activeStoryboardId }).catch(() => {
      touchedStoryboardRef.current = null;
    });
  }, [activeStoryboardId, isAuthenticated, touchStoryboardOpened]);

  // Clean up pending media generations that outlived their window — typically
  // left behind when a previous session was killed mid-render (Next.js route
  // timeout, browser reload, process crash). Runs once per storyboard open.
  useEffect(() => {
    if (!isAuthenticated || !activeStoryboardId) {
      return;
    }
    if (sweptMediaRef.current === activeStoryboardId) {
      return;
    }
    sweptMediaRef.current = activeStoryboardId;
    void sweepStaleMediaGenerations({ storyboardId: activeStoryboardId }).catch((error) => {
      console.warn("Failed to sweep stale media generations", error);
      sweptMediaRef.current = null;
    });
  }, [activeStoryboardId, isAuthenticated, sweepStaleMediaGenerations]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    const mappedNodes: StoryNode[] = snapshot.nodes.map((node) => {
      const media = mapNodeMedia(node.media);
      const activeImage = media.images.find((item) => item.id === media.activeImageId)?.url
        ?? media.images.at(-1)?.url;
      const activeVideo = media.videos.find((item) => item.id === media.activeVideoId)?.url
        ?? media.videos.at(-1)?.url;
      return {
        id: node.nodeId,
        type: "custom",
        position: node.position,
        data: {
          ...createDefaultStoryNodeData(node.label, node.segment, node.nodeType),
          entityRefs: node.entityRefs ?? { characterIds: [] },
          continuity: node.continuity ?? {
            identityLockVersion: 1,
            wardrobeVariantIds: [],
            consistencyStatus: "ok",
          },
          historyContext: node.historyContext ?? {
            eventIds: [],
            rollingSummary: "",
            tokenBudgetUsed: 0,
            lineageHash: "",
          },
          promptPack: node.promptPack ?? { continuityDirectives: [] },
          media,
          image: activeImage,
          video: activeVideo,
          imageHistory: media.images.map((item) => item.url),
        },
      };
    });
    const mappedEdges = snapshot.edges.map(toFlowEdge);
    setNodes(mappedNodes);
    setEdges(mappedEdges);
  }, [snapshot, setEdges, setNodes]);

  // Inspector is a floating panel shown only when a node is selected.

  // --- Undo/redo stack -----------------------------------------------------
  // We capture structural snapshots ({ nodes, edges }) before each mutation
  // that should be reversible (add node, delete node, connect, drag). Undo
  // pops a snapshot into a "future" stack and restores local state; a server
  // resync diff replays the difference as upsertNode/deleteNode/upsertEdge
  // calls so Convex stays in sync with the restored snapshot.
  type GraphSnapshot = { nodes: StoryNode[]; edges: StoryEdge[] };
  const UNDO_LIMIT = 50;
  const undoStackRef = useRef<GraphSnapshot[]>([]);
  const redoStackRef = useRef<GraphSnapshot[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
  const isRestoringRef = useRef(false);

  const captureHistory = useCallback(() => {
    if (isRestoringRef.current) return;
    undoStackRef.current.push({
      nodes: nodes.map((n) => ({ ...n, position: { ...n.position } })),
      edges: edges.map((e) => ({ ...e })),
    });
    if (undoStackRef.current.length > UNDO_LIMIT) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(0);
  }, [edges, nodes]);

  const resyncGraphToServer = useCallback(
    async (target: GraphSnapshot, previous: GraphSnapshot) => {
      if (!activeStoryboardId) return;
      const targetNodeIds = new Set(target.nodes.map((n) => n.id));
      const targetEdgeIds = new Set(target.edges.map((e) => e.id));
      // Delete nodes present before but not in target.
      const nodesToDelete = previous.nodes.filter(
        (n) => !targetNodeIds.has(n.id),
      );
      // Upsert all target nodes (covers re-add and position restoration).
      await Promise.all([
        ...nodesToDelete.map((node) =>
          deleteNode({
            storyboardId: activeStoryboardId,
            nodeId: node.id,
          }).catch((err) =>
            console.warn("undo/redo deleteNode failed", err),
          ),
        ),
        ...target.nodes.map((node) =>
          upsertNode({
            storyboardId: activeStoryboardId,
            nodeId: node.id,
            nodeType: node.data.nodeType,
            label: node.data.label,
            segment: node.data.segment,
            position: node.position,
            continuityStatus: node.data.continuity.consistencyStatus,
          }).catch((err) =>
            console.warn("undo/redo upsertNode failed", err),
          ),
        ),
      ]);
      // Upsert all target edges (idempotent on existing).
      await Promise.all(
        target.edges.map((edge) => {
          const storyEdge = edge as StoryEdge;
          return upsertEdge({
            storyboardId: activeStoryboardId,
            edgeId: edge.id,
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
            edgeType: storyEdge.data?.edgeType ?? "serial",
            branchId: storyEdge.data?.branchId,
            order: storyEdge.data?.order,
            isPrimary: storyEdge.data?.isPrimary ?? true,
          }).catch((err) =>
            console.warn("undo/redo upsertEdge failed", err),
          );
        }),
      );
      // Note: edge deletions for edges removed during delete-node cascade
      // happen server-side automatically when the node is deleted. Dangling
      // edges with no server counterpart will naturally absent on next snapshot.
      // Edge-only deletions (without node delete) are currently rare in the
      // reversible set, so we accept best-effort convergence here.
      void targetEdgeIds;
    },
    [activeStoryboardId, deleteNode, upsertEdge, upsertNode],
  );

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const previous: GraphSnapshot = {
      nodes: nodes.map((n) => ({ ...n, position: { ...n.position } })),
      edges: edges.map((e) => ({ ...e })),
    };
    const target = undoStackRef.current.pop()!;
    redoStackRef.current.push(previous);
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(redoStackRef.current.length);
    isRestoringRef.current = true;
    setNodes(target.nodes);
    setEdges(target.edges);
    setSelectedNode(null);
    setInspectorAnchor(null);
    // Release the restore guard on next microtask so captureHistory won't
    // double-record the restore itself.
    Promise.resolve().then(() => {
      isRestoringRef.current = false;
    });
    void resyncGraphToServer(target, previous);
  }, [edges, nodes, resyncGraphToServer, setEdges, setNodes]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const previous: GraphSnapshot = {
      nodes: nodes.map((n) => ({ ...n, position: { ...n.position } })),
      edges: edges.map((e) => ({ ...e })),
    };
    const target = redoStackRef.current.pop()!;
    undoStackRef.current.push(previous);
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(redoStackRef.current.length);
    isRestoringRef.current = true;
    setNodes(target.nodes);
    setEdges(target.edges);
    setSelectedNode(null);
    setInspectorAnchor(null);
    Promise.resolve().then(() => {
      isRestoringRef.current = false;
    });
    void resyncGraphToServer(target, previous);
  }, [edges, nodes, resyncGraphToServer, setEdges, setNodes]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod) return;
      const target = event.target as HTMLElement | null;
      // Ignore when user is typing in an input/textarea/contenteditable.
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (
        (event.key.toLowerCase() === "z" && event.shiftKey) ||
        event.key.toLowerCase() === "y"
      ) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const updateNodeData = useCallback(
    (id: string, partialData: Partial<StoryNode["data"]>) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.id !== id) {
            return node;
          }
          const next = { ...node, data: { ...node.data, ...partialData } };
          if (selectedNode?.id === id) {
            setSelectedNode(next);
          }
          return next;
        }),
      );
    },
    [selectedNode, setNodes],
  );

  const persistNode = useCallback(
    async (node: StoryNode) => {
      if (!activeStoryboardId) {
        return;
      }
      await upsertNode({
        storyboardId: activeStoryboardId,
        nodeId: node.id,
        nodeType: node.data.nodeType,
        label: node.data.label,
        segment: node.data.segment,
        position: node.position,
        continuityStatus: node.data.continuity.consistencyStatus,
      });
    },
    [activeStoryboardId, upsertNode],
  );

  const persistEdge = useCallback(
    async (edge: Edge) => {
      if (!activeStoryboardId) {
        return;
      }
      const storyEdge = edge as StoryEdge;
      await upsertEdge({
        storyboardId: activeStoryboardId,
        edgeId: edge.id,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        edgeType: storyEdge.data?.edgeType ?? "serial",
        branchId: storyEdge.data?.branchId,
        order: storyEdge.data?.order,
        isPrimary: storyEdge.data?.isPrimary ?? true,
      });
    },
    [activeStoryboardId, upsertEdge],
  );

  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) {
        return;
      }
      captureHistory();
      const edgeId = `e${params.source}-${params.target}-${generateId()}`;
      const nextEdge: StoryEdge = {
        id: edgeId,
        source: params.source,
        target: params.target,
        type: "smoothstep",
        animated: true,
        style: { stroke: "#94a3b8", strokeWidth: 2 },
        data: {
          edgeType: "serial",
          isPrimary: true,
        },
      };
      setEdges((current) => addEdge(nextEdge, current));
      void persistEdge(nextEdge);
      if (activeStoryboardId) {
        void recordEvent({
          storyboardId: activeStoryboardId,
          eventType: "branch_create",
          summary: `Connected ${params.source} to ${params.target}`,
          ancestorNodeIds: buildAncestry([...edges, nextEdge], params.target),
        });
        void refreshHistory({
          storyboardId: activeStoryboardId,
          nodeIds: [params.target],
        });
      }
    },
    [activeStoryboardId, captureHistory, edges, persistEdge, recordEvent, refreshHistory, setEdges],
  );

  const anchorNearNode = useCallback((node: StoryNode) => {
    if (!rfInstance) {
      return { x: 80, y: 120 };
    }
    const viewport = rfInstance.getViewport();
    const zoom = viewport.zoom || 1;
    return {
      x: node.position.x * zoom + viewport.x + 170 * zoom,
      y: node.position.y * zoom + viewport.y + 70 * zoom,
    };
  }, [rfInstance]);

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedNode(node as StoryNode);
    const rect = graphCanvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    setInspectorAnchor({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setInspectorAnchor(null);
  }, []);

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const storyNode = node as StoryNode;
      captureHistory();
      void persistNode(storyNode);
    },
    [captureHistory, persistNode],
  );

  const handleAddTypedNode = useCallback((nodeType: NodeType) => {
    captureHistory();
    const id = generateId();
    let position = { x: 100, y: 100 };
    if (selectedNode && rfInstance) {
      position = { x: selectedNode.position.x + 400, y: selectedNode.position.y };
    } else if (rfInstance) {
      const center = rfInstance.project({
        x: window.innerWidth / 2 - 200,
        y: window.innerHeight / 2,
      });
      if (center) {
        position = center;
      }
    }
    const label = nodeType === "shot" ? "New Shot" : nodeType === "branch" ? "Branch" : "New Scene";
    const placeholder =
      nodeType === "shot"
        ? "Describe the shot: framing, action, emotion..."
        : nodeType === "branch"
          ? "Describe the alternate storyline intent..."
          : "Describe the scene: location, beats, stakes...";
    const newNode: StoryNode = {
      id,
      type: "custom",
      position,
      data: createDefaultStoryNodeData(label, placeholder, nodeType),
    };
    setNodes((current) => [...current, newNode]);
    if (selectedNode) {
      const connectingEdge: StoryEdge = {
        id: `e${selectedNode.id}-${id}-${generateId()}`,
        source: selectedNode.id,
        target: id,
        type: "smoothstep",
        animated: true,
        style: { stroke: "#94a3b8", strokeWidth: 2 },
        data: {
          edgeType: "serial",
          isPrimary: true,
        },
      };
      setEdges((current) => [...current, connectingEdge]);
      void persistEdge(connectingEdge);
    }
    setSelectedNode(newNode);
    setInspectorAnchor(anchorNearNode(newNode));
    void persistNode(newNode);
    if (activeStoryboardId) {
      void recordEvent({
        storyboardId: activeStoryboardId,
        nodeId: newNode.id,
        eventType: "node_edit",
        summary: `Created node ${newNode.data.label}`,
        ancestorNodeIds: buildAncestry(edges, newNode.id),
      });
      void refreshHistory({
        storyboardId: activeStoryboardId,
        nodeIds: [newNode.id],
      });
    }
  }, [
    activeStoryboardId,
    captureHistory,
    edges,
    persistEdge,
    persistNode,
    recordEvent,
    refreshHistory,
    rfInstance,
    selectedNode,
    setEdges,
    setNodes,
    anchorNearNode,
  ]);

  const handleDeleteNode = useCallback(() => {
    if (!selectedNode) {
      return;
    }
    captureHistory();
    const deletingId = selectedNode.id;
    setNodes((current) => current.filter((node) => node.id !== deletingId));
    setEdges((current) => current.filter((edge) => edge.source !== deletingId && edge.target !== deletingId));
    setSelectedNode(null);
    setInspectorAnchor(null);
    if (activeStoryboardId) {
      void deleteNode({ storyboardId: activeStoryboardId, nodeId: deletingId });
      void recordEvent({
        storyboardId: activeStoryboardId,
        nodeId: deletingId,
        eventType: "node_edit",
        summary: `Deleted node ${selectedNode.data.label}`,
        ancestorNodeIds: [],
      });
    }
  }, [activeStoryboardId, captureHistory, deleteNode, recordEvent, selectedNode, setEdges, setNodes]);

  const handleFitView = useCallback(() => {
    if (rfInstance) {
      rfInstance.fitView({ padding: 0.2, duration: 800 });
    }
  }, [rfInstance]);
  const handleZoomIn = useCallback(() => {
    if (rfInstance) {
      rfInstance.zoomIn({ duration: 500 });
    }
  }, [rfInstance]);
  const handleZoomOut = useCallback(() => {
    if (rfInstance) {
      rfInstance.zoomOut({ duration: 500 });
    }
  }, [rfInstance]);

  const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedViewportRef = useRef<SavedViewport | null>(null);
  const handleViewportMoveEnd = useCallback(
    (_event: unknown, viewport: SavedViewport) => {
      if (!activeStoryboardId) {
        return;
      }
      const last = lastSavedViewportRef.current;
      if (
        last &&
        Math.abs(last.x - viewport.x) < 0.5 &&
        Math.abs(last.y - viewport.y) < 0.5 &&
        Math.abs(last.zoom - viewport.zoom) < 0.001
      ) {
        return;
      }
      if (viewportSaveTimerRef.current) {
        clearTimeout(viewportSaveTimerRef.current);
      }
      viewportSaveTimerRef.current = setTimeout(() => {
        lastSavedViewportRef.current = viewport;
        void updateEditorStateMutation({
          storyboardId: activeStoryboardId,
          viewport,
        }).catch((error) => {
          console.warn("Failed to persist viewport", error);
        });
      }, 400);
    },
    [activeStoryboardId, updateEditorStateMutation],
  );
  useEffect(() => {
    return () => {
      if (viewportSaveTimerRef.current) {
        clearTimeout(viewportSaveTimerRef.current);
      }
    };
  }, []);
  const defaultViewport = useMemo<SavedViewport | undefined>(() => {
    const vp = snapshot?.storyboard?.editorState?.viewport;
    if (!vp) return undefined;
    return { x: vp.x, y: vp.y, zoom: vp.zoom };
  }, [snapshot?.storyboard?.editorState?.viewport]);

  const handleEditNode = useCallback(
    async (nodeId: string, instruction: string) => {
      const node = nodes.find((row) => row.id === nodeId);
      if (!node) {
        return;
      }
      setIsProcessing(true);
      updateNodeData(nodeId, { isProcessing: true, processingTask: "text" });
      try {
        const result = await editNodeText(node.data.segment, instruction);
        updateNodeData(nodeId, {
          label: result.label,
          segment: result.segment,
          isProcessing: false,
          processingTask: undefined,
        });
        const updatedNode: StoryNode = {
          ...node,
          data: {
            ...node.data,
            label: result.label,
            segment: result.segment,
          },
        };
        await persistNode(updatedNode);
        if (activeStoryboardId) {
          await recordEvent({
            storyboardId: activeStoryboardId,
            nodeId,
            eventType: "prompt_update",
            summary: `Updated node copy for ${result.label}`,
            ancestorNodeIds: buildAncestry(edges, nodeId),
          });
          await refreshHistory({
            storyboardId: activeStoryboardId,
            nodeIds: [nodeId],
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to edit node";
        console.error(message);
        updateNodeData(nodeId, { isProcessing: false, processingTask: undefined });
      } finally {
        setIsProcessing(false);
      }
    },
    [activeStoryboardId, edges, nodes, persistNode, recordEvent, refreshHistory, updateNodeData],
  );

  const handleGenerateMedia = useCallback(
    async (nodeId: string, type: MediaType, prompt: string, config: StoryboardMediaConfig) => {
      const node = nodes.find((row) => row.id === nodeId);
      if (!node) {
        return;
      }
      const isPersisted = Boolean(activeStoryboardId) && (type === MediaType.IMAGE || type === MediaType.VIDEO);
      const kind = type === MediaType.IMAGE ? "image" : "video";
      const resolvedModelId = type === MediaType.IMAGE
        ? (config.imageModelId ?? "storyboard-default")
        : type === MediaType.VIDEO
          ? (config.videoModelId ?? "storyboard-default")
          : "storyboard-default";

      // Create the pending Convex row FIRST so a reload / crash / timeout mid-
      // generation still leaves a visible record. The row is the job handle we
      // pass to complete/fail below.
      let mediaAssetId: Awaited<ReturnType<typeof startMediaGeneration>> | null = null;
      if (isPersisted && activeStoryboardId) {
        try {
          mediaAssetId = await startMediaGeneration({
            storyboardId: activeStoryboardId,
            nodeId,
            kind,
            modelId: resolvedModelId,
            prompt,
            negativePrompt: config.negativePrompt,
          });
        } catch (error) {
          // If we can't even create the pending row, bail rather than fire a
          // generation we won't be able to track.
          const message = error instanceof Error ? error.message : "Failed to start media generation";
          console.error(message);
          alert(`Media generation failed: ${message}`);
          return;
        }
      }

      setIsProcessing(true);
      updateNodeData(nodeId, { isProcessing: true, processingTask: type.toLowerCase() });
      if (type === MediaType.IMAGE && config.inputImage) {
        updateNodeData(nodeId, { inputImage: config.inputImage });
      }

      const controller = new AbortController();
      try {
        const resultUrl = await generateMedia(type, prompt, config, controller.signal);

        if (type === MediaType.IMAGE) {
          const oldHistory = node.data.imageHistory ?? [];
          const baseHistory = oldHistory.length === 0 && node.data.image ? [node.data.image] : oldHistory;
          const imageHistory = [...baseHistory, resultUrl];
          updateNodeData(nodeId, {
            image: resultUrl,
            imageHistory,
            media: {
              ...node.data.media,
              images: [
                ...node.data.media.images,
                {
                  id: generateId(),
                  kind: "image",
                  url: resultUrl,
                  modelId: resolvedModelId,
                  prompt,
                  negativePrompt: config.negativePrompt,
                  status: "completed",
                  createdAt: Date.now(),
                },
              ],
            },
          });
        }
        if (type === MediaType.AUDIO) {
          updateNodeData(nodeId, { audio: resultUrl });
        }
        if (type === MediaType.VIDEO) {
          updateNodeData(nodeId, {
            video: resultUrl,
            media: {
              ...node.data.media,
              videos: [
                ...node.data.media.videos,
                {
                  id: generateId(),
                  kind: "video",
                  url: resultUrl,
                  modelId: resolvedModelId,
                  prompt,
                  negativePrompt: config.negativePrompt,
                  status: "completed",
                  createdAt: Date.now(),
                },
              ],
            },
          });
        }

        let identityScore: number | undefined;
        let consistencyScore: number | undefined;
        let wardrobeCompliance: "matching" | "deviation" | "unknown" | undefined;
        const characterId = node.data.entityRefs.characterIds[0];
        if (type === MediaType.IMAGE && characterId) {
          try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
            const response = await fetch(`${apiUrl}/api/consistency/evaluate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                character_id: characterId,
                candidate_image_url: resultUrl,
                wardrobe_variant: node.data.continuity.wardrobeVariantIds[0] ?? "",
              }),
            });
            if (response.ok) {
              const evaluation = (await response.json()) as {
                identity_score: number;
                wardrobe_compliance: "matching" | "deviation" | "unknown";
              };
              identityScore = evaluation.identity_score;
              consistencyScore = evaluation.identity_score;
              wardrobeCompliance = evaluation.wardrobe_compliance;
            }
          } catch (evaluationError) {
            console.warn("Consistency evaluation failed", evaluationError);
          }
        }

        if (mediaAssetId && activeStoryboardId) {
          await completeMediaGeneration({
            mediaAssetId,
            sourceUrl: resultUrl,
            modelId: resolvedModelId,
            identityScore,
            consistencyScore,
            wardrobeCompliance,
          });
          await recordEvent({
            storyboardId: activeStoryboardId,
            nodeId,
            eventType: "media_select",
            summary: `Generated ${type.toLowerCase()} for node ${node.data.label}`,
            ancestorNodeIds: buildAncestry(edges, nodeId),
          });
          await refreshHistory({
            storyboardId: activeStoryboardId,
            nodeIds: [nodeId],
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Media generation failed";
        console.error(message);
        // Flip the pending row to failed so the UI can surface it instead of
        // silently losing the generation. Best-effort: if the mutation itself
        // fails, we fall back to leaving the row pending for the sweeper.
        if (mediaAssetId) {
          try {
            await failMediaGeneration({ mediaAssetId, errorMessage: message });
          } catch (markFailError) {
            console.error("Failed to mark media generation as failed", markFailError);
          }
        }
        alert(`Media generation failed: ${message}`);
      } finally {
        updateNodeData(nodeId, { isProcessing: false, processingTask: undefined });
        setIsProcessing(false);
      }
    },
    [
      activeStoryboardId,
      completeMediaGeneration,
      edges,
      failMediaGeneration,
      nodes,
      recordEvent,
      refreshHistory,
      startMediaGeneration,
      updateNodeData,
    ],
  );

  const handleSelectTeam = useCallback(
    async ({ teamId, revisionId }: TeamSelectionPayload) => {
      if (!activeStoryboardId) {
        return;
      }
      await assignTeamToStoryboard({
        storyboardId: activeStoryboardId,
        activeTeamId: teamId,
        activeRevisionId: revisionId,
      });
    },
    [activeStoryboardId, assignTeamToStoryboard],
  );

  const handleCreateTeam = useCallback(
    async (input: { name: string; description: string; teamGoal: string }) => {
      const created = await createAgentTeam({
        name: input.name,
        description: input.description || "Custom producer team",
        teamGoal: input.teamGoal || "Deliver safe storyboard proposals with strict HITL.",
      }) as { teamId: string; revisionId: string };

      if (activeStoryboardId) {
        await assignTeamToStoryboard({
          storyboardId: activeStoryboardId,
          activeTeamId: created.teamId,
          activeRevisionId: created.revisionId,
        });
      }
    },
    [activeStoryboardId, assignTeamToStoryboard, createAgentTeam],
  );

  const handleGenerateTeamDraft = useCallback(
    async (inputPrompt: string) => {
      const draft = await generateTeamFromPrompt({ inputPrompt }) as TeamPromptDraft;
      return draft;
    },
    [generateTeamFromPrompt],
  );

  const handleApplyTeamDraft = useCallback(
    async (teamId: string, draftId: string, publish: boolean) => {
      const applied = await applyPromptDraftToRevision({
        teamId,
        draftId,
        publish,
      }) as { revisionId: string };
      if (activeStoryboardId && publish) {
        await assignTeamToStoryboard({
          storyboardId: activeStoryboardId,
          activeTeamId: teamId,
          activeRevisionId: applied.revisionId,
        });
      }
    },
    [activeStoryboardId, applyPromptDraftToRevision, assignTeamToStoryboard],
  );

  const handlePublishTeamRevision = useCallback(
    async (teamId: string, revisionId: string) => {
      await publishTeamRevision({ teamId, revisionId });
      if (activeStoryboardId) {
        await assignTeamToStoryboard({
          storyboardId: activeStoryboardId,
          activeTeamId: teamId,
          activeRevisionId: revisionId,
        });
      }
    },
    [activeStoryboardId, assignTeamToStoryboard, publishTeamRevision],
  );

  const handleUpdateTeamMember = useCallback(
    async (
      teamId: string,
      revisionId: string,
      member: {
        memberId: string;
        agentName: string;
        role: string;
        persona: string;
        nicheDescription: string;
        toolScope: string[];
        resourceScope: string[];
        weight: number;
        enabled: boolean;
      },
    ) => {
      await updateRevisionMember({
        teamId,
        revisionId,
        member,
      });
    },
    [updateRevisionMember],
  );

  const handleCreateTeamRevision = useCallback(
    async (input: {
      teamId: string;
      teamGoal: string;
      policy: TeamPolicy;
      members: TeamMemberConfig[];
      toolAllowlist: string[];
      resourceScopes: string[];
      publish: boolean;
    }) => {
      await createTeamRevision({
        teamId: input.teamId,
        teamGoal: input.teamGoal,
        policy: input.policy,
        members: input.members,
        toolAllowlist: input.toolAllowlist,
        resourceScopes: input.resourceScopes,
        publish: input.publish,
      });
    },
    [createTeamRevision],
  );

  const handleRollbackTeamRevision = useCallback(
    async (teamId: string, revisionId: string) => {
      await rollbackTeamRevision({ teamId, revisionId });
      if (activeStoryboardId) {
        await assignTeamToStoryboard({
          storyboardId: activeStoryboardId,
          activeTeamId: teamId,
          activeRevisionId: revisionId,
        });
      }
    },
    [activeStoryboardId, assignTeamToStoryboard, rollbackTeamRevision],
  );

  const handleGenerateDailies = useCallback(async () => {
    if (!activeStoryboardId) {
      return;
    }
    await generateAutonomousDailies({
      storyboardId: activeStoryboardId,
      branchId: "main",
    });
  }, [activeStoryboardId, generateAutonomousDailies]);

  const handleUpdateDailiesStatus = useCallback(
    async (
      reelId: string,
      status: "approved" | "rejected" | "applied",
      justification?: string,
    ) => {
      if (!activeStoryboardId) {
        return;
      }
      await updateDailiesStatus({
        storyboardId: activeStoryboardId,
        reelId,
        status,
        ...(justification ? { justification } : {}),
      });
    },
    [activeStoryboardId, updateDailiesStatus],
  );

  const handleRunSimulationCritic = useCallback(async () => {
    if (!activeStoryboardId) {
      return;
    }
    await runSimulationCritic({
      storyboardId: activeStoryboardId,
      branchId: "main",
    });
  }, [activeStoryboardId, runSimulationCritic]);

  const handleUpdateSimulationRunStatus = useCallback(
    async (
      simulationRunId: string,
      status: "applied" | "rejected" | "complete",
      justification?: string,
    ) => {
      if (!activeStoryboardId) {
        return;
      }
      await updateSimulationRunStatus({
        storyboardId: activeStoryboardId,
        simulationRunId,
        status,
        ...(justification ? { justification } : {}),
      });
    },
    [activeStoryboardId, updateSimulationRunStatus],
  );

  const handleDetectContradictions = useCallback(async () => {
    if (!activeStoryboardId) {
      return;
    }
    const rollingSummary = nodes
      .slice(-12)
      .map((node) => node.data.historyContext.rollingSummary || node.data.segment)
      .join(" | ");
    await detectContradictions({
      storyboardId: activeStoryboardId,
      branchId: "main",
      rollingSummary,
    });
  }, [activeStoryboardId, detectContradictions, nodes]);

  const handleResolveViolation = useCallback(
    async (violationId: string, status: "acknowledged" | "resolved") => {
      if (!activeStoryboardId) return;
      await resolveViolationMutation({
        storyboardId: activeStoryboardId,
        violationId,
        status,
      });
    },
    [activeStoryboardId, resolveViolationMutation],
  );

  const handlePublishIdentityPack = useCallback(
    async (packId: string, publish: boolean) => {
      if (!activeStoryboardId) return;
      await publishIdentityPackMutation({
        storyboardId: activeStoryboardId,
        packId,
        publish,
      });
    },
    [activeStoryboardId, publishIdentityPackMutation],
  );

  const handleCreateBranch = useCallback(async () => {
    if (!activeStoryboardId) {
      return;
    }
    const branchId = `branch_${Date.now()}`;
    await createBranchMutation({
      storyboardId: activeStoryboardId,
      branchId,
      name: `Branch ${new Date().toLocaleTimeString()}`,
      parentBranchId: defaultBranchId,
    });
  }, [activeStoryboardId, createBranchMutation, defaultBranchId]);

  const handleCherryPickLatest = useCallback(async () => {
    if (!activeStoryboardId || !branchCommits || branchCommits.length === 0) {
      return;
    }
    const sourceCommitId = branchCommits[0].commitId;
    const approvalTaskId = await createApprovalTaskMutation({
      storyboardId: activeStoryboardId,
      taskType: "merge_policy",
      title: `Cherry-pick ${sourceCommitId}`,
      rationale: "Producer initiated cherry-pick from Timeline Theater",
      diffSummary: "Cherry-pick latest commit",
      payloadJson: JSON.stringify({ sourceCommitId, targetBranchId: defaultBranchId }),
    });
    await resolveApprovalTaskMutation({
      taskId: approvalTaskId,
      approved: true,
      justification: "Approved from Timeline Theater",
    });
    await cherryPickCommitMutation({
      storyboardId: activeStoryboardId,
      sourceCommitId,
      targetBranchId: defaultBranchId,
      approvalToken: `approved:${String(approvalTaskId)}`,
    });
  }, [
    activeStoryboardId,
    branchCommits,
    cherryPickCommitMutation,
    createApprovalTaskMutation,
    defaultBranchId,
    resolveApprovalTaskMutation,
  ]);

  const handleComputeLatestDiff = useCallback(async () => {
    if (!activeStoryboardId || !branchCommits || branchCommits.length < 2) {
      return;
    }
    await computeSemanticDiffMutation({
      storyboardId: activeStoryboardId,
      fromCommitId: branchCommits[1].commitId,
      toCommitId: branchCommits[0].commitId,
    });
  }, [activeStoryboardId, branchCommits, computeSemanticDiffMutation]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      setMessages((current) => [...current, userMsg]);
      setIsProcessing(true);

      try {
        const isEdit =
          nodes.length > 0
          && selectedNode
          && (text.toLowerCase().includes("change")
            || text.toLowerCase().includes("make")
            || text.toLowerCase().includes("rewrite"));

        if (isEdit && selectedNode) {
          await handleEditNode(selectedNode.id, text);
          setMessages((current) => [
            ...current,
            {
              id: generateId(),
              role: "assistant",
              content: `Updated node "${selectedNode.data.label}".`,
              timestamp: Date.now(),
            },
          ]);
          return;
        }

        setMessages((current) => [
          ...current,
          {
            id: generateId(),
            role: "assistant",
            content: "Generating story structure...",
            timestamp: Date.now(),
          },
        ]);
        const graphData = await generateStoryGraph(text);
        const generatedNodes: StoryNode[] = graphData.nodes.map((node) => ({
          id: node.id,
          type: "custom",
          data: createDefaultStoryNodeData(
            node.data.label,
            node.data.segment,
            node.data.nodeType ?? "scene",
          ),
          position: node.position,
        }));
        const generatedEdges: StoryEdge[] = graphData.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: "smoothstep",
          animated: true,
          style: { stroke: "#94a3b8", strokeWidth: 2 },
          data: {
            edgeType: "serial",
            isPrimary: true,
          },
        }));

        setNodes(generatedNodes);
        setEdges(generatedEdges);
        setMessages((current) => [
          ...current,
          {
            id: generateId(),
            role: "assistant",
            content: `Created story with ${generatedNodes.length} nodes.`,
            timestamp: Date.now(),
          },
        ]);

        if (activeStoryboardId) {
          await Promise.all(generatedNodes.map((node) => persistNode(node)));
          await Promise.all(generatedEdges.map((edge) => persistEdge(edge)));
          await recordEvent({
            storyboardId: activeStoryboardId,
            eventType: "branch_create",
            summary: `Generated storyboard graph from prompt`,
            ancestorNodeIds: generatedNodes.map((node) => node.id),
          });
          await refreshHistory({
            storyboardId: activeStoryboardId,
            nodeIds: generatedNodes.map((node) => node.id),
          });
        }
        setTimeout(() => handleFitView(), 300);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong.";
        console.error(message);
        setMessages((current) => [
          ...current,
          {
            id: generateId(),
            role: "assistant",
            content: `Error: ${message}`,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setIsProcessing(false);
      }
    },
    [
      activeStoryboardId,
      handleEditNode,
      nodes.length,
      persistEdge,
      persistNode,
      recordEvent,
      refreshHistory,
      selectedNode,
      setEdges,
      setNodes,
      handleFitView,
    ],
  );

  const pendingApprovalsCount = snapshot?.approvals.length ?? 0;
  const continuityViolationCount = continuityBundle?.continuityViolations?.length ?? 0;
  const saveStatusText = isProcessing
    ? "Saving..."
    : formatSavedTime(typeof snapshot?.storyboard?.updatedAt === "number" ? snapshot.storyboard.updatedAt : undefined);

  const focusNode = (nodeId: string) => {
    if (!rfInstance) return;
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    rfInstance.setCenter(node.position.x + 160, node.position.y + 60, { zoom: 0.95, duration: 450 });
  };

  const closeInspector = useCallback(() => {
    setSelectedNode(null);
    setInspectorAnchor(null);
  }, []);

  const inspectorStyle = useMemo<React.CSSProperties | null>(() => {
    if (!selectedNode) {
      return null;
    }
    const rect = graphCanvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return null;
    }

    const margin = 16;
    const availableWidth = Math.max(220, rect.width - margin * 2);
    const availableHeight = Math.max(220, rect.height - margin * 2);
    const panelWidth = Math.min(420, availableWidth);
    const panelHeight = Math.min(760, availableHeight);
    const gap = 20;
    const viewport = rfInstance?.getViewport();

    if (!viewport) {
      const anchor = inspectorAnchor ?? anchorNearNode(selectedNode);
      return {
        left: Math.max(margin, Math.min(rect.width - panelWidth - margin, anchor.x + 18)),
        top: Math.max(margin, Math.min(rect.height - panelHeight - margin, anchor.y - 84)),
        width: panelWidth,
        maxHeight: panelHeight,
      };
    }

    const zoom = viewport.zoom || 1;
    const nodeWidth = (selectedNode.width ?? 320) * zoom;
    const nodeHeight = (selectedNode.height ?? 340) * zoom;
    const nodeLeft = selectedNode.position.x * zoom + viewport.x;
    const nodeTop = selectedNode.position.y * zoom + viewport.y;
    const nodeRight = nodeLeft + nodeWidth;
    const nodeBottom = nodeTop + nodeHeight;

    const rightCandidate = nodeRight + gap;
    const leftCandidate = nodeLeft - panelWidth - gap;

    let left: number;
    if (rightCandidate + panelWidth <= rect.width - margin) {
      left = rightCandidate;
    } else if (leftCandidate >= margin) {
      left = leftCandidate;
    } else {
      const anchor = inspectorAnchor ?? anchorNearNode(selectedNode);
      left = Math.max(margin, Math.min(rect.width - panelWidth - margin, anchor.x + 18));
    }

    let top = nodeTop - 8;
    if (top + panelHeight > rect.height - margin) {
      top = rect.height - panelHeight - margin;
    }
    if (top < margin) {
      top = margin;
    }

    const overlapsHorizontally = left < nodeRight + gap && left + panelWidth > nodeLeft - gap;
    const overlapsVertically = top < nodeBottom + gap && top + panelHeight > nodeTop - gap;
    if (overlapsHorizontally && overlapsVertically) {
      const belowTop = nodeBottom + gap;
      const aboveTop = nodeTop - panelHeight - gap;
      if (belowTop + panelHeight <= rect.height - margin) {
        top = belowTop;
      } else if (aboveTop >= margin) {
        top = aboveTop;
      }
    }

    return {
      left,
      top,
      width: panelWidth,
      maxHeight: panelHeight,
    };
  }, [anchorNearNode, inspectorAnchor, rfInstance, selectedNode]);

  if (isAuthLoading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] w-full items-center justify-center bg-slate-950 text-slate-200">
        Checking authentication...
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] w-full items-center justify-center bg-slate-950 px-6 text-center text-slate-200">
        <div>
          <h1 className="text-lg font-semibold">Sign in required</h1>
          <p className="mt-2 text-sm text-slate-400">
            Storyboard workspace is protected by Better Auth. Sign in first, then reload this page.
          </p>
          <div className="mt-4">
            <Button asChild>
              <Link href="/auth?redirect=%2Fstoryboard">Go to sign in</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (activeStoryboardId && snapshot === null) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] w-full items-center justify-center bg-slate-950 px-6 text-center text-slate-200">
        <div>
          <h1 className="text-lg font-semibold">Storyboard unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">
            This storyboard was not found, is trashed, or you don&apos;t have access.
          </p>
          <div className="mt-4">
            <Button asChild>
              <Link href="/storyboard">Back to library</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-background text-foreground font-sans storyboard-scroll">
      <div
        className={leftCollapsed
          ? "w-14 flex shrink-0 flex-col border-r border-border/60 bg-background/40"
          : "w-[340px] flex shrink-0 flex-col border-r border-border/60 bg-background/40"}
      >
        <div className="h-12 px-3 flex items-center justify-between border-b border-border/60">
          <div className="flex items-center gap-2">
            <Link
              href="/storyboard"
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Library
            </Link>
            <div className="text-sm font-semibold tracking-tight">
              {leftCollapsed ? "DW" : "Storyboard"}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setLeftCollapsed((v) => !v)}
            aria-label={leftCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {leftCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
        </div>

        {leftCollapsed ? null : (
          <Tabs value={leftTab} onValueChange={(v) => setLeftTab(v as typeof leftTab)} className="flex flex-1 min-h-0 flex-col">
            <div className="px-3 pt-3">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="outline">Outline</TabsTrigger>
                <TabsTrigger value="assistant">Assistant</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="outline" className="mt-3 flex-1 min-h-0">
              <OutlinePanel
                nodes={nodes}
                edges={edges}
                selectedNodeId={selectedNode?.id ?? null}
                onSelectNode={(nodeId) => {
                  const next = nodes.find((n) => n.id === nodeId) ?? null;
                  setSelectedNode(next);
                  if (next) {
                    setInspectorAnchor(anchorNearNode(next));
                  } else {
                    setInspectorAnchor(null);
                  }
                }}
                onFocusNode={focusNode}
                onAddNode={handleAddTypedNode}
              />
            </TabsContent>
            <TabsContent value="assistant" className="mt-3 flex-1 min-h-0">
              <ChatPanel
                messages={messages}
                onSendMessage={handleSendMessage}
                isGenerating={isProcessing}
                selectedNode={selectedNode}
                onClearSelection={closeInspector}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>

      <div className="relative flex-1 overflow-hidden" ref={graphCanvasRef}>
          <StoryGraph
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onNodeDragStop={onNodeDragStop}
            onInit={setRfInstance}
            defaultViewport={defaultViewport}
            onMoveEnd={handleViewportMoveEnd}
          />

          <CanvasToolbar
            onAddNode={handleAddTypedNode}
            onDeleteNode={handleDeleteNode}
            onFitView={handleFitView}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            hasSelection={Boolean(selectedNode)}
            onUndo={undo}
            onRedo={redo}
            canUndo={undoDepth > 0}
            canRedo={redoDepth > 0}
          />

          <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
            <div className="rounded-md border border-border/60 bg-background/80 px-2 py-1 text-[11px] text-muted-foreground">
              {saveStatusText}
            </div>
            <ProductionHubDrawer
              pendingApprovalsCount={pendingApprovalsCount}
              continuityViolationCount={continuityViolationCount}
              delegations={delegations ?? []}
              runtimeTeam={runtimeTeam ?? null}
              quotaSummary={quotaSummary ?? null}
              audits={toolAudits ?? []}
              latestSimulationRun={(simulationRuns?.[0] as SimulationCriticRunRecord | undefined) ?? null}
              approvals={fullApprovals ?? []}
              teams={teams ?? []}
              teamRevisions={activeTeamRevisions ?? []}
              dailies={dailies ?? []}
              simulationRuns={simulationRuns ?? []}
              branches={branches ?? []}
              commits={branchCommits ?? []}
              continuityBundle={continuityBundle ?? null}
              currentMode={storyboardMode}
              onSelectTeam={async (teamId, revisionId) => await handleSelectTeam({ teamId, revisionId })}
              onCreateTeam={handleCreateTeam}
              onCreateRevision={handleCreateTeamRevision}
              onGenerateDraft={handleGenerateTeamDraft}
              onApplyDraft={handleApplyTeamDraft}
              onPublishRevision={handlePublishTeamRevision}
              onRollbackRevision={handleRollbackTeamRevision}
              onUpdateMember={handleUpdateTeamMember}
              onGenerateDailies={handleGenerateDailies}
              onUpdateDailiesStatus={handleUpdateDailiesStatus}
              onUpdateSimulationRunStatus={handleUpdateSimulationRunStatus}
              onRunCritic={handleRunSimulationCritic}
              onCreateBranch={handleCreateBranch}
              onCherryPickLatest={handleCherryPickLatest}
              onComputeLatestDiff={handleComputeLatestDiff}
              onDetectContradictions={handleDetectContradictions}
              onResolveViolation={handleResolveViolation}
              onPublishIdentityPack={handlePublishIdentityPack}
            />
          </div>

          {selectedNode && inspectorStyle ? (
            <div className="absolute z-30 pointer-events-auto" style={inspectorStyle}>
              <div className="w-full overflow-hidden rounded-2xl border border-border/70 bg-background/95 shadow-[0_20px_70px_rgba(0,0,0,0.6)] backdrop-blur">
                <div className="max-h-[calc(100vh-10rem)] overflow-y-auto">
                  <PropertiesPanel
                    selectedNode={selectedNode}
                    nodes={nodes}
                    edges={edges}
                    onGenerateMedia={handleGenerateMedia}
                    onEditNode={handleEditNode}
                    isProcessing={isProcessing}
                    onClose={closeInspector}
                  />
                </div>
              </div>
            </div>
          ) : null}
      </div>

      <StoryboardCopilotBridge
        storyboardId={activeStoryboardId}
        nodes={nodes}
        edges={edges}
        approvals={snapshot?.approvals ?? EMPTY_APPROVALS}
        mode={storyboardMode}
        runtimeResolvedTeam={runtimeTeam ?? null}
        userIdentity={userIdentity}
      />
    </div>
  );
}
