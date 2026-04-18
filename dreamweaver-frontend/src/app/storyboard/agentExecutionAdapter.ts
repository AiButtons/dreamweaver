import type { PlanOperation, RuntimeResolvedTeam, StoryEdge, StoryNode } from "./types";

type GraphPatchOperation = {
  op:
    | "create_node"
    | "update_node"
    | "delete_node"
    | "create_edge"
    | "update_edge"
    | "delete_edge";
  nodeId?: string;
  edgeId?: string;
  nodeType?: "scene" | "shot" | "branch" | "merge" | "character_ref" | "background_ref";
  label?: string;
  segment?: string;
  position?: { x: number; y: number };
  sourceNodeId?: string;
  targetNodeId?: string;
  edgeType?: "serial" | "parallel" | "branch" | "merge";
  branchId?: string;
  order?: number;
  isPrimary?: boolean;
};

type GraphPatchInput = {
  patchId: string;
  title: string;
  rationale: string;
  diffSummary: string;
  operations: unknown[];
};

type MediaPromptInput = {
  nodeId: string;
  mediaType: "image" | "video";
  prompt: string;
  negativePrompt?: string;
  contextSummary: string;
};

type ExecutionPlanInput = {
  planId: string;
  storyboardId: string;
  branchId: string;
  title: string;
  rationale: string;
  operations: unknown[];
  source?: "agent" | "dailies" | "simulation_critic" | "repair";
  sourceId?: string;
  taskType?:
    | "execution_plan"
    | "batch_ops"
    | "dailies_batch"
    | "simulation_critic_batch"
    | "repair_plan";
  dryRun?: {
    valid: boolean;
    riskLevel: "low" | "medium" | "high" | "critical";
    summary: string;
    issues: unknown[];
    estimatedTotalCost: number;
    estimatedDurationSec: number;
    planHash: string;
  };
};

type MutationExecutor = (args: Record<string, unknown>) => Promise<unknown>;

type AdapterDependencies = {
  storyboardId: string;
  nodes: StoryNode[];
  edges: StoryEdge[];
  createApprovalTask: MutationExecutor;
  resolveApprovalTask: MutationExecutor;
  markApprovalExecutionStarted?: MutationExecutor;
  markApprovalExecutionFinished?: MutationExecutor;
  applyGraphPatch: MutationExecutor;
  recordStoryEvent: MutationExecutor;
  refreshNodeHistoryContexts: MutationExecutor;
  createMediaAsset: MutationExecutor;
  // Optional compensation mutation for partial-batch media rollback. If not
  // provided, the adapter falls back to graph-only rollback (legacy behavior).
  revertBatchMediaAssets?: MutationExecutor;
  compileNodePromptPack: MutationExecutor;
  simulateExecutionPlan: MutationExecutor;
  commitPlanOps: MutationExecutor;
  rollbackToCommit: MutationExecutor;
  generateAutonomousDailies: MutationExecutor;
  updateDailiesStatus: MutationExecutor;
  runSimulationCritic: MutationExecutor;
  updateSimulationRunStatus: MutationExecutor;
  startAgentRun: MutationExecutor;
  finishAgentRun: MutationExecutor;
  runtimeResolvedTeam?: RuntimeResolvedTeam | null;
  checkAndReserveRunBudget?: MutationExecutor;
  releaseRunBudget?: MutationExecutor;
};

type PolicyEvidence = {
  teamId?: string;
  revisionId?: string;
  quotaProfileId?: string;
  rules: string[];
  quotaSnapshot?: Record<string, unknown>;
};

type GraphApprovalExecutionResult = {
  taskId: string;
  runId: string;
  appliedOperationCount: number;
  touchedNodeIds: string[];
  warnings: string[];
  policyEvidence?: PolicyEvidence;
};

type MediaApprovalExecutionResult = {
  taskId: string;
  runId: string;
  nodeId: string;
  mediaType: "image" | "video";
  mediaUrl: string;
  consistency: {
    identityScore?: number;
    consistencyScore?: number;
    wardrobeCompliance?: "matching" | "deviation" | "unknown";
  };
  policyEvidence?: PolicyEvidence;
};

type ExecutionPlanApprovalResult = {
  taskId: string;
  runId: string;
  planId: string;
  branchId: string;
  commitId?: string;
  operationCount: number;
  graphOperationCount: number;
  mediaOperationCount: number;
  mediaSuccessCount: number;
  mediaFailureCount: number;
  rollback?: {
    performed: boolean;
    rolledBackTo?: string;
  };
  dryRun: {
    valid: boolean;
    riskLevel: "low" | "medium" | "high" | "critical";
    summary: string;
    issues: unknown[];
    estimatedTotalCost: number;
    estimatedDurationSec: number;
    planHash: string;
  };
  policyEvidence?: PolicyEvidence;
};

type NarrativeGitOperation = {
  op:
    | "create_node"
    | "update_node"
    | "delete_node"
    | "create_edge"
    | "update_edge"
    | "delete_edge"
    | "generate_image"
    | "generate_video";
  opId?: string;
  title?: string;
  rationale?: string;
  nodeId?: string;
  edgeId?: string;
  nodeType?: "scene" | "shot" | "branch" | "merge" | "character_ref" | "background_ref";
  label?: string;
  segment?: string;
  position?: { x: number; y: number };
  sourceNodeId?: string;
  targetNodeId?: string;
  edgeType?: "serial" | "parallel" | "branch" | "merge";
  branchId?: string;
  order?: number;
  isPrimary?: boolean;
};

const MAX_PATCH_OPERATIONS_PER_APPROVAL = 1;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

const toolTokenForGraphOperation = (op: GraphPatchOperation["op"]): string => {
  if (
    op === "create_node"
    || op === "update_node"
    || op === "delete_node"
    || op === "create_edge"
    || op === "update_edge"
    || op === "delete_edge"
  ) {
    return "graph.patch";
  }
  return "graph.patch";
};

const toolTokenForPlanOperation = (op: PlanOperation["op"]): string => {
  switch (op) {
    case "generate_image":
      return "media.image.generate";
    case "generate_video":
      return "media.video.generate";
    default:
      return "graph.patch";
  }
};

const isToolAllowed = (allowlist: string[], token: string) =>
  allowlist.length === 0
  || allowlist.includes("*")
  || allowlist.includes(token)
  || (
    token.startsWith("media.")
    && allowlist.includes("media.prompt")
  );

const buildPolicyEvidence = (
  deps: AdapterDependencies,
  rules: string[],
  quotaSnapshot?: Record<string, unknown>,
): PolicyEvidence | undefined => {
  const runtimeTeam = deps.runtimeResolvedTeam;
  if (!runtimeTeam) {
    return undefined;
  }
  return {
    teamId: runtimeTeam.teamId,
    revisionId: runtimeTeam.revisionId,
    quotaProfileId: runtimeTeam.runtimePolicy.quotaProfileId,
    rules,
    quotaSnapshot,
  };
};

const enforceGraphPolicy = (
  deps: AdapterDependencies,
  operations: GraphPatchOperation[],
) => {
  const runtimeTeam = deps.runtimeResolvedTeam;
  if (!runtimeTeam) {
    return { rules: ["runtime_team_not_set"] };
  }
  const rules: string[] = [];
  if (operations.length > runtimeTeam.runtimePolicy.maxBatchSize) {
    throw new Error("Graph patch exceeds team maxBatchSize policy.");
  }
  if (operations.length > runtimeTeam.runtimePolicy.maxRunOps) {
    throw new Error("Graph patch exceeds team maxRunOps policy.");
  }
  const denied = operations
    .map((operation) => toolTokenForGraphOperation(operation.op))
    .filter((token) => !isToolAllowed(runtimeTeam.toolAllowlist, token));
  if (denied.length > 0) {
    throw new Error(`Operation denied by team tool scope: ${[...new Set(denied)].join(", ")}`);
  }
  rules.push("maxBatchSize", "maxRunOps", "toolAllowlist");
  return { rules };
};

const enforceMediaPolicy = (
  deps: AdapterDependencies,
  mediaType: "image" | "video",
) => {
  const runtimeTeam = deps.runtimeResolvedTeam;
  if (!runtimeTeam) {
    return { rules: ["runtime_team_not_set"] };
  }
  const token = mediaType === "image" ? "media.image.generate" : "media.video.generate";
  if (!isToolAllowed(runtimeTeam.toolAllowlist, token)) {
    throw new Error(`Media execution denied by tool allowlist: ${token}`);
  }
  return { rules: ["toolAllowlist"] };
};

const enforceExecutionPlanPolicy = (
  deps: AdapterDependencies,
  operations: PlanOperation[],
) => {
  const runtimeTeam = deps.runtimeResolvedTeam;
  if (!runtimeTeam) {
    return { rules: ["runtime_team_not_set"] };
  }
  if (operations.length > runtimeTeam.runtimePolicy.maxRunOps) {
    throw new Error("Execution plan exceeds team maxRunOps policy.");
  }
  if (operations.length > runtimeTeam.runtimePolicy.maxBatchSize) {
    throw new Error("Execution plan exceeds team maxBatchSize policy.");
  }
  const denied = operations
    .map((operation) => toolTokenForPlanOperation(operation.op))
    .filter((token) => !isToolAllowed(runtimeTeam.toolAllowlist, token));
  if (denied.length > 0) {
    throw new Error(`Execution plan denied by tool allowlist: ${[...new Set(denied)].join(", ")}`);
  }
  return { rules: ["maxBatchSize", "maxRunOps", "toolAllowlist"] };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const hashString = (raw: string) => {
  let hash = 5381;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 33) ^ raw.charCodeAt(index);
  }
  return `h_${(hash >>> 0).toString(16)}`;
};

const toDedupeKey = (scope: string, payload: Record<string, unknown>) =>
  `${scope}:${hashString(JSON.stringify(payload))}`;

const toRunId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run_${Date.now()}`;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const fetchJsonWithRetry = async <T>(
  url: string,
  payload: Record<string, unknown>,
  retryCount = MAX_RETRIES,
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const response = await withTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        REQUEST_TIMEOUT_MS,
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Request failed (${response.status}): ${text}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < retryCount) {
        await sleep(300 * (attempt + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unknown network failure");
};

type MediaProxyEnvelope<T> = {
  status: number;
  ok: boolean;
  data: T;
};

const callMediaProxy = async <T>(
  endpoint: "/api/image/generate" | "/api/image/compose" | "/api/video/generate" | "/api/consistency/evaluate",
  payload: Record<string, unknown>,
): Promise<T> => {
  const envelope = await fetchJsonWithRetry<MediaProxyEnvelope<T>>(
    "/api/storyboard/media-proxy",
    {
      endpoint,
      payload,
      provider: "media_backend",
      scope: "storyboard_media",
      handleId: process.env.NEXT_PUBLIC_MEDIA_SECRET_HANDLE_ID || undefined,
    },
  );
  if (!envelope.ok) {
    throw new Error(`Media proxy request failed (${envelope.status}).`);
  }
  return envelope.data;
};

const collectImageReferences = (
  nodeId: string,
  nodes: StoryNode[],
  edges: StoryEdge[],
): string[] => {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) {
    return [];
  }

  const refs = new Set<string>();
  if (node.data.inputImage) {
    refs.add(node.data.inputImage);
  }
  if (node.data.image) {
    refs.add(node.data.image);
  }
  for (const image of node.data.media.images) {
    refs.add(image.url);
  }

  const parentNodes = edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => nodes.find((item) => item.id === edge.source))
    .filter((row): row is StoryNode => Boolean(row));

  const childNodes = edges
    .filter((edge) => edge.source === nodeId)
    .map((edge) => nodes.find((item) => item.id === edge.target))
    .filter((row): row is StoryNode => Boolean(row));

  for (const linked of [...parentNodes, ...childNodes]) {
    if (linked.data.image) {
      refs.add(linked.data.image);
    }
  }

  return [...refs].slice(0, 4);
};

const extractNodeIdsFromOperations = (operations: GraphPatchOperation[]): string[] => {
  const ids = new Set<string>();
  for (const operation of operations) {
    if (operation.nodeId) {
      ids.add(operation.nodeId);
    }
    if (operation.sourceNodeId) {
      ids.add(operation.sourceNodeId);
    }
    if (operation.targetNodeId) {
      ids.add(operation.targetNodeId);
    }
  }
  return [...ids];
};

const sanitizeOperations = (
  candidateOperations: unknown[],
): { operations: GraphPatchOperation[]; warnings: string[] } => {
  const warnings: string[] = [];
  const parsed = candidateOperations
    .filter(isObject)
    .map((operation) => ({
      op: asString(operation.op) as GraphPatchOperation["op"],
      nodeId: asOptionalString(operation.nodeId),
      edgeId: asOptionalString(operation.edgeId),
      nodeType: asOptionalString(operation.nodeType) as GraphPatchOperation["nodeType"],
      label: asOptionalString(operation.label),
      segment: asOptionalString(operation.segment),
      position: isObject(operation.position)
        ? {
            x: Number(operation.position.x ?? 0),
            y: Number(operation.position.y ?? 0),
          }
        : undefined,
      sourceNodeId: asOptionalString(operation.sourceNodeId),
      targetNodeId: asOptionalString(operation.targetNodeId),
      edgeType: asOptionalString(operation.edgeType) as GraphPatchOperation["edgeType"],
      branchId: asOptionalString(operation.branchId),
      order: typeof operation.order === "number" ? operation.order : undefined,
      isPrimary: typeof operation.isPrimary === "boolean" ? operation.isPrimary : undefined,
    }))
    .filter((operation) =>
      [
        "create_node",
        "update_node",
        "delete_node",
        "create_edge",
        "update_edge",
        "delete_edge",
      ].includes(operation.op),
    )
    .filter((operation) => {
      if (operation.op === "create_node") {
        return Boolean(
          operation.nodeId
            && operation.nodeType
            && operation.label
            && operation.segment
            && operation.position,
        );
      }
      if (operation.op === "update_node" || operation.op === "delete_node") {
        return Boolean(operation.nodeId);
      }
      if (operation.op === "create_edge") {
        return Boolean(
          operation.edgeId
            && operation.sourceNodeId
            && operation.targetNodeId
            && operation.edgeType,
        );
      }
      if (operation.op === "update_edge" || operation.op === "delete_edge") {
        return Boolean(operation.edgeId);
      }
      return false;
    });

  if (parsed.length === 0) {
    throw new Error("Patch contains no valid operations");
  }

  if (parsed.length > MAX_PATCH_OPERATIONS_PER_APPROVAL) {
    warnings.push(
      `Only ${MAX_PATCH_OPERATIONS_PER_APPROVAL} operation per approval is allowed. Truncated from ${parsed.length}.`,
    );
  }

  return {
    operations: parsed.slice(0, MAX_PATCH_OPERATIONS_PER_APPROVAL),
    warnings,
  };
};

const sanitizeExecutionPlanOperations = (
  candidateOperations: unknown[],
): PlanOperation[] => {
  const allowedOps = new Set<PlanOperation["op"]>([
    "create_node",
    "update_node",
    "delete_node",
    "create_edge",
    "update_edge",
    "delete_edge",
    "generate_image",
    "generate_video",
  ]);
  const operations: PlanOperation[] = [];
  for (let index = 0; index < candidateOperations.length; index += 1) {
    const raw = candidateOperations[index];
    if (!isObject(raw)) {
      continue;
    }
    const op = asString(raw.op) as PlanOperation["op"];
    if (!allowedOps.has(op)) {
      continue;
    }
    const opId = asOptionalString(raw.opId) ?? `op_${index + 1}`;
    const title = asOptionalString(raw.title) ?? op;
    const rationale = asOptionalString(raw.rationale) ?? "Generated by storyboard agent";
    const nodeId = asOptionalString(raw.nodeId);
    const edgeId = asOptionalString(raw.edgeId);
    const payloadSeed = isObject(raw.payload) ? raw.payload : {};
    const payload: Record<string, unknown> = {
      ...payloadSeed,
    };
    for (const key of [
      "nodeType",
      "label",
      "segment",
      "position",
      "sourceNodeId",
      "targetNodeId",
      "edgeType",
      "branchId",
      "order",
      "isPrimary",
      "prompt",
      "negativePrompt",
      "contextSummary",
      "modelId",
      "aspectRatio",
      "duration",
      "cameraMovement",
      "audioEnabled",
      "slowMotion",
      "inputImages",
    ] as const) {
      if (raw[key] !== undefined && payload[key] === undefined) {
        payload[key] = raw[key];
      }
    }
    const requiresHitl = typeof raw.requiresHitl === "boolean" ? raw.requiresHitl : true;
    const estimatedCost = typeof raw.estimatedCost === "number" ? raw.estimatedCost : undefined;

    operations.push({
      opId,
      op,
      title,
      rationale,
      nodeId,
      edgeId,
      payload: Object.keys(payload).length > 0 ? payload : undefined,
      requiresHitl,
      estimatedCost,
    });
  }
  if (operations.length === 0) {
    throw new Error("Execution plan has no valid operations");
  }
  return operations;
};

const extractTouchedNodeIdsFromExecutionPlan = (operations: PlanOperation[]): string[] => {
  const touched = new Set<string>();
  for (const operation of operations) {
    if (operation.nodeId) {
      touched.add(operation.nodeId);
    }
    const payload = operation.payload;
    if (isObject(payload)) {
      const sourceNodeId = asOptionalString(payload.sourceNodeId);
      const targetNodeId = asOptionalString(payload.targetNodeId);
      if (sourceNodeId) {
        touched.add(sourceNodeId);
      }
      if (targetNodeId) {
        touched.add(targetNodeId);
      }
    }
  }
  return [...touched];
};

const eventTypeFromOperation = (
  operation: GraphPatchOperation,
): "node_edit" | "branch_create" | "branch_merge" => {
  if (
    (operation.op === "create_edge"
      || operation.op === "update_edge"
      || operation.op === "delete_edge")
    && operation.edgeType === "merge"
  ) {
    return "branch_merge";
  }
  if (
    operation.op === "create_edge"
    || operation.op === "update_edge"
    || operation.op === "delete_edge"
  ) {
    return "branch_create";
  }
  return "node_edit";
};

const withRunTracking = async <T>(
  deps: AdapterDependencies,
  intent: string,
  actions: Record<string, unknown>,
  execute: (runId: string, quotaSnapshot?: Record<string, unknown>) => Promise<T>,
  quotaRequest?: {
    requestedMutationOps: number;
    requestedMediaBudget: number;
    requestedRunOps?: number;
  },
) => {
  const runId = toRunId();
  let quotaSnapshot: Record<string, unknown> | undefined;

  if (
    quotaRequest
    && deps.runtimeResolvedTeam?.runtimePolicy.quotaEnforced
    && deps.checkAndReserveRunBudget
  ) {
    const quotaResult = await deps.checkAndReserveRunBudget({
      quotaProfileId: deps.runtimeResolvedTeam.runtimePolicy.quotaProfileId,
      runId,
      storyboardId: deps.storyboardId,
      requestedMutationOps: quotaRequest.requestedMutationOps,
      requestedMediaBudget: quotaRequest.requestedMediaBudget,
      requestedRunOps: quotaRequest.requestedRunOps,
    });
    quotaSnapshot = isObject(quotaResult)
      ? (quotaResult as Record<string, unknown>)
      : undefined;
  }

  await deps.startAgentRun({
    storyboardId: deps.storyboardId,
    runId,
    agentName: "storyboard_agent",
    graphId: "storyboard_agent",
    intent,
    status: "executing",
    actionsJson: JSON.stringify(actions),
  });

  try {
    const result = await execute(runId, quotaSnapshot);
    await deps.finishAgentRun({
      runId,
      status: "complete",
      actionsJson: JSON.stringify({ ...actions, result }),
    });
    if (deps.releaseRunBudget && deps.runtimeResolvedTeam?.runtimePolicy.quotaEnforced) {
      await deps.releaseRunBudget({
        quotaProfileId: deps.runtimeResolvedTeam.runtimePolicy.quotaProfileId,
        runId,
        keepUsage: true,
      });
    }
    return { runId, result };
  } catch (error) {
    if (deps.releaseRunBudget && deps.runtimeResolvedTeam?.runtimePolicy.quotaEnforced) {
      await deps.releaseRunBudget({
        quotaProfileId: deps.runtimeResolvedTeam.runtimePolicy.quotaProfileId,
        runId,
        keepUsage: true,
      });
    }
    await deps.finishAgentRun({
      runId,
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
      actionsJson: JSON.stringify(actions),
    });
    throw error;
  }
};

export const executeApprovedGraphPatch = async (
  deps: AdapterDependencies,
  input: GraphPatchInput,
  editedOperations?: unknown[],
): Promise<GraphApprovalExecutionResult> => {
  if (!deps.storyboardId) {
    throw new Error("Storyboard context is missing");
  }
  const candidate = editedOperations ?? input.operations;
  const { operations, warnings } = sanitizeOperations(candidate);
  const policyValidation = enforceGraphPolicy(deps, operations);

  const tracked = await withRunTracking(
    deps,
    "approve_graph_patch",
    {
      patchId: input.patchId,
      operationCount: operations.length,
    },
    async (runId, quotaSnapshot) => {
      const taskId = (await deps.createApprovalTask({
        storyboardId: deps.storyboardId,
        taskType: "graph_patch",
        dedupeKey: toDedupeKey("graph_patch", {
          storyboardId: deps.storyboardId,
          patchId: input.patchId,
          operations,
        }),
        title: input.title,
        rationale: input.rationale,
        diffSummary: input.diffSummary,
        payloadJson: JSON.stringify({
          patchId: input.patchId,
          operations,
        }),
      })) as string;

      await deps.resolveApprovalTask({
        taskId,
        approved: true,
        editedPayloadJson: JSON.stringify({
          patchId: input.patchId,
          operations,
        }),
      });

      const applyResult = (await deps.applyGraphPatch({
        storyboardId: deps.storyboardId,
        approvalTaskId: taskId,
        operations,
      })) as { touchedNodeIds?: string[] };

      const touchedNodeIds =
        applyResult?.touchedNodeIds && applyResult.touchedNodeIds.length > 0
          ? applyResult.touchedNodeIds
          : extractNodeIdsFromOperations(operations);

      const primaryOperation = operations[0];
      const eventType = primaryOperation
        ? eventTypeFromOperation(primaryOperation)
        : "node_edit";
      await deps.recordStoryEvent({
        storyboardId: deps.storyboardId,
        nodeId: touchedNodeIds[0],
        eventType,
        summary: `Applied approved patch: ${input.title}`,
        details: input.diffSummary,
        ancestorNodeIds: touchedNodeIds,
      });

      if (touchedNodeIds.length > 0) {
        await deps.refreshNodeHistoryContexts({
          storyboardId: deps.storyboardId,
          nodeIds: touchedNodeIds,
        });
      }

      return {
        taskId,
        runId,
        appliedOperationCount: operations.length,
        touchedNodeIds,
        warnings,
        policyEvidence: buildPolicyEvidence(
          deps,
          policyValidation.rules,
          quotaSnapshot,
        ),
      };
    },
    {
      requestedMutationOps: operations.length,
      requestedMediaBudget: 0,
      requestedRunOps: operations.length,
    },
  );

  return tracked.result;
};

export const executeRejectedGraphPatch = async (
  deps: AdapterDependencies,
  input: GraphPatchInput,
): Promise<{ taskId: string }> => {
  const taskId = (await deps.createApprovalTask({
    storyboardId: deps.storyboardId,
    taskType: "graph_patch",
    title: input.title,
    rationale: input.rationale,
    diffSummary: input.diffSummary,
    payloadJson: JSON.stringify({
      patchId: input.patchId,
      operations: input.operations,
    }),
  })) as string;

  await deps.resolveApprovalTask({
    taskId,
    approved: false,
    justification: "Rejected by producer",
  });

  return { taskId };
};

const extractMediaUrl = (
  mediaType: "image" | "video",
  response: Record<string, unknown>,
): string => {
  if (mediaType === "video") {
    const url = asString(response.url);
    if (!url) {
      throw new Error("Video response does not contain URL");
    }
    return url;
  }

  const direct = asString(response.url);
  if (direct) {
    return direct;
  }
  const images = Array.isArray(response.images) ? response.images : [];
  const first = images[0];
  if (isObject(first) && typeof first.url === "string") {
    return first.url;
  }
  throw new Error("Image response does not contain URL");
};

const evaluateConsistency = async (
  characterId: string,
  candidateImageUrl: string,
  wardrobeVariant: string | undefined,
) => {
  type ConsistencyResponse = {
    identity_score: number;
    consistency_score: number;
    wardrobe_compliance: "matching" | "deviation" | "unknown";
  };
  try {
    const response = await callMediaProxy<ConsistencyResponse>(
      "/api/consistency/evaluate",
      {
        character_id: characterId,
        candidate_image_url: candidateImageUrl,
        wardrobe_variant: wardrobeVariant,
      },
    );
    return {
      identityScore: response.identity_score,
      consistencyScore: response.consistency_score,
      wardrobeCompliance: response.wardrobe_compliance,
    };
  } catch {
    return {};
  }
};

export const executeApprovedMediaPrompt = async (
  deps: AdapterDependencies,
  input: MediaPromptInput,
  editedPrompt?: { prompt: string; negativePrompt?: string },
): Promise<MediaApprovalExecutionResult> => {
  if (!deps.storyboardId) {
    throw new Error("Storyboard context is missing");
  }

  const prompt = (editedPrompt?.prompt ?? input.prompt).trim();
  if (!prompt) {
    throw new Error("Prompt cannot be empty");
  }
  const negativePrompt = editedPrompt?.negativePrompt ?? input.negativePrompt;
  const node = deps.nodes.find((item) => item.id === input.nodeId);
  if (!node) {
    throw new Error(`Node not found: ${input.nodeId}`);
  }
  const policyValidation = enforceMediaPolicy(deps, input.mediaType);

  const tracked = await withRunTracking(
    deps,
    "approve_media_prompt",
    {
      nodeId: input.nodeId,
      mediaType: input.mediaType,
    },
    async (runId, quotaSnapshot) => {
      const compiledPromptPack = (await deps.compileNodePromptPack({
        storyboardId: deps.storyboardId,
        nodeId: input.nodeId,
        mediaType: input.mediaType,
        basePrompt: prompt,
        negativePrompt,
      })) as {
        prompt?: string;
        negativePrompt?: string;
      };

      const finalPrompt = (compiledPromptPack.prompt ?? prompt).trim();
      const finalNegativePrompt = (
        compiledPromptPack.negativePrompt
        ?? negativePrompt
        ?? ""
      ).trim();

      const taskId = (await deps.createApprovalTask({
        storyboardId: deps.storyboardId,
        taskType: "media_prompt",
        dedupeKey: toDedupeKey("media_prompt", {
          storyboardId: deps.storyboardId,
          nodeId: input.nodeId,
          mediaType: input.mediaType,
          prompt: finalPrompt,
          negativePrompt: finalNegativePrompt,
        }),
        title: `Generate ${input.mediaType} for node`,
        rationale: "Producer approved media prompt",
        diffSummary: input.contextSummary,
        payloadJson: JSON.stringify({
          nodeId: input.nodeId,
          mediaType: input.mediaType,
          prompt: finalPrompt,
          negativePrompt: finalNegativePrompt,
        }),
      })) as string;

      await deps.resolveApprovalTask({
        taskId,
        approved: true,
        editedPayloadJson: JSON.stringify({ prompt: finalPrompt, negativePrompt: finalNegativePrompt }),
      });

      let mediaResponse: Record<string, unknown>;
      if (input.mediaType === "image") {
        const references = collectImageReferences(input.nodeId, deps.nodes, deps.edges);
        if (references.length > 0) {
          mediaResponse = await callMediaProxy<Record<string, unknown>>(
            "/api/image/compose",
            {
              prompt: finalPrompt,
              input_images: references,
              aspect_ratio: "16:9",
              model_id: "gpt-image-1",
            },
          );
        } else {
          mediaResponse = await callMediaProxy<Record<string, unknown>>(
            "/api/image/generate",
            {
              prompt: finalPrompt,
              model_id: "gpt-image-1",
              aspect_ratio: "16:9",
              batch_size: 1,
              quality: "standard",
            },
          );
        }
      } else {
        mediaResponse = await callMediaProxy<Record<string, unknown>>(
          "/api/video/generate",
          {
            prompt: finalPrompt,
            negative_prompt: finalNegativePrompt,
            model_id: "ltx-2",
            aspect_ratio: "16:9",
            duration: "5",
            camera_movement: "static",
            audio_enabled: true,
            slow_motion: false,
            batch_size: 1,
          },
        );
      }

      const mediaUrl = extractMediaUrl(input.mediaType, mediaResponse);

      const consistency =
        input.mediaType === "image" && node.data.entityRefs.characterIds.length > 0
          ? await evaluateConsistency(
              node.data.entityRefs.characterIds[0],
              mediaUrl,
              node.data.continuity.wardrobeVariantIds[0],
            )
          : {};

      await deps.createMediaAsset({
        storyboardId: deps.storyboardId,
        nodeId: input.nodeId,
        kind: input.mediaType,
        sourceUrl: mediaUrl,
        modelId: input.mediaType === "image" ? "gpt-image-1" : "ltx-2",
        prompt: finalPrompt,
        negativePrompt: finalNegativePrompt || undefined,
        status: "completed",
        identityScore: consistency.identityScore,
        consistencyScore: consistency.consistencyScore,
        wardrobeCompliance: consistency.wardrobeCompliance,
      });

      await deps.recordStoryEvent({
        storyboardId: deps.storyboardId,
        nodeId: input.nodeId,
        eventType: "media_select",
        summary: `Generated ${input.mediaType} for node ${input.nodeId}`,
        details: `Prompt approved and executed. URL: ${mediaUrl}`,
        ancestorNodeIds: [input.nodeId],
      });

      await deps.refreshNodeHistoryContexts({
        storyboardId: deps.storyboardId,
        nodeIds: [input.nodeId],
      });

      return {
        taskId,
        runId,
        nodeId: input.nodeId,
        mediaType: input.mediaType,
        mediaUrl,
        consistency: {
          identityScore: consistency.identityScore,
          consistencyScore: consistency.consistencyScore,
          wardrobeCompliance: consistency.wardrobeCompliance,
        },
        policyEvidence: buildPolicyEvidence(
          deps,
          policyValidation.rules,
          quotaSnapshot,
        ),
      };
    },
    {
      requestedMutationOps: 1,
      requestedMediaBudget: 1,
      requestedRunOps: 1,
    },
  );

  return tracked.result;
};

const isGraphExecutionOperation = (op: PlanOperation["op"]) =>
  op === "create_node"
  || op === "update_node"
  || op === "delete_node"
  || op === "create_edge"
  || op === "update_edge"
  || op === "delete_edge";

const isMediaExecutionOperation = (op: PlanOperation["op"]) =>
  op === "generate_image" || op === "generate_video";

const toNarrativeGitOperation = (operation: PlanOperation): NarrativeGitOperation => {
  const payload = isObject(operation.payload) ? operation.payload : {};
  return {
    op: operation.op,
    opId: operation.opId,
    title: operation.title,
    rationale: operation.rationale,
    nodeId: operation.nodeId,
    edgeId: operation.edgeId,
    nodeType: (
      payload.nodeType === "scene"
      || payload.nodeType === "shot"
      || payload.nodeType === "branch"
      || payload.nodeType === "merge"
      || payload.nodeType === "character_ref"
      || payload.nodeType === "background_ref"
    )
      ? payload.nodeType
      : undefined,
    label: asOptionalString(payload.label),
    segment: asOptionalString(payload.segment),
    position: isObject(payload.position)
      ? {
          x: Number(payload.position.x ?? 0),
          y: Number(payload.position.y ?? 0),
        }
      : undefined,
    sourceNodeId: asOptionalString(payload.sourceNodeId),
    targetNodeId: asOptionalString(payload.targetNodeId),
    edgeType: (
      payload.edgeType === "serial"
      || payload.edgeType === "parallel"
      || payload.edgeType === "branch"
      || payload.edgeType === "merge"
    )
      ? payload.edgeType
      : undefined,
    branchId: asOptionalString(payload.branchId),
    order: typeof payload.order === "number" ? payload.order : undefined,
    isPrimary: typeof payload.isPrimary === "boolean" ? payload.isPrimary : undefined,
  };
};

type MediaPlanExecutionResult = {
  operationId: string;
  nodeId: string;
  mediaType: "image" | "video";
  mediaUrl: string;
  // ID of the inserted mediaAssets row — used for compensation if a later op
  // in the batch fails and earlier successes need to be rolled back. Typed as
  // `string` for the adapter layer; Convex returns `Id<"mediaAssets">` which
  // serializes to a string.
  mediaAssetId: string;
  success: boolean;
};

const parseBoolean = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const parseMediaPayload = (
  operation: PlanOperation,
): {
  nodeId: string;
  mediaType: "image" | "video";
  prompt: string;
  negativePrompt: string;
  contextSummary: string;
  modelId: string;
  aspectRatio: string;
  duration: string;
  cameraMovement: string;
  audioEnabled: boolean;
  slowMotion: boolean;
  inputImages: string[];
} => {
  const payload = isObject(operation.payload) ? operation.payload : {};
  const mediaType: "image" | "video" = operation.op === "generate_video" ? "video" : "image";
  const nodeId = asOptionalString(operation.nodeId) ?? asOptionalString(payload.nodeId) ?? "";
  if (!nodeId) {
    throw new Error(`Media operation ${operation.opId ?? operation.op} is missing nodeId`);
  }
  const prompt = (
    asOptionalString(payload.prompt)
    ?? asOptionalString(payload.basePrompt)
    ?? operation.title
    ?? ""
  ).trim();
  if (!prompt) {
    throw new Error(`Media operation ${operation.opId ?? operation.op} is missing prompt`);
  }
  const negativePrompt = (asOptionalString(payload.negativePrompt) ?? "").trim();
  const contextSummary = (
    asOptionalString(payload.contextSummary)
    ?? asOptionalString(payload.rollingSummary)
    ?? ""
  ).trim();
  const modelId = mediaType === "image"
    ? asOptionalString(payload.modelId) ?? "gpt-image-1"
    : asOptionalString(payload.modelId) ?? "ltx-2";
  const aspectRatio = asOptionalString(payload.aspectRatio) ?? "16:9";
  const duration = String(payload.duration ?? "5");
  const cameraMovement = asOptionalString(payload.cameraMovement) ?? "static";
  const audioEnabled = parseBoolean(payload.audioEnabled, true);
  const slowMotion = parseBoolean(payload.slowMotion, false);
  const inputImages = Array.isArray(payload.inputImages)
    ? payload.inputImages.filter((value): value is string => typeof value === "string")
    : [];
  return {
    nodeId,
    mediaType,
    prompt,
    negativePrompt,
    contextSummary,
    modelId,
    aspectRatio,
    duration,
    cameraMovement,
    audioEnabled,
    slowMotion,
    inputImages,
  };
};

const executeMediaPlanOperation = async (
  deps: AdapterDependencies,
  operation: PlanOperation,
): Promise<MediaPlanExecutionResult> => {
  const parsed = parseMediaPayload(operation);
  const node = deps.nodes.find((item) => item.id === parsed.nodeId);
  if (!node) {
    throw new Error(`Node not found for media op: ${parsed.nodeId}`);
  }

  const compiledPromptPack = (await deps.compileNodePromptPack({
    storyboardId: deps.storyboardId,
    nodeId: parsed.nodeId,
    mediaType: parsed.mediaType,
    basePrompt: parsed.prompt,
    negativePrompt: parsed.negativePrompt,
  })) as { prompt?: string; negativePrompt?: string };

  const finalPrompt = (compiledPromptPack.prompt ?? parsed.prompt).trim();
  const finalNegativePrompt = (compiledPromptPack.negativePrompt ?? parsed.negativePrompt).trim();

  let mediaResponse: Record<string, unknown>;
  if (parsed.mediaType === "image") {
    const references = parsed.inputImages.length > 0
      ? parsed.inputImages
      : collectImageReferences(parsed.nodeId, deps.nodes, deps.edges);
    if (references.length > 0) {
      mediaResponse = await callMediaProxy<Record<string, unknown>>(
        "/api/image/compose",
        {
          prompt: finalPrompt,
          input_images: references,
          aspect_ratio: parsed.aspectRatio,
          model_id: parsed.modelId,
        },
      );
    } else {
      mediaResponse = await callMediaProxy<Record<string, unknown>>(
        "/api/image/generate",
        {
          prompt: finalPrompt,
          model_id: parsed.modelId,
          aspect_ratio: parsed.aspectRatio,
          batch_size: 1,
          quality: "standard",
        },
      );
    }
  } else {
    mediaResponse = await callMediaProxy<Record<string, unknown>>(
      "/api/video/generate",
      {
        prompt: finalPrompt,
        negative_prompt: finalNegativePrompt,
        model_id: parsed.modelId,
        aspect_ratio: parsed.aspectRatio,
        duration: parsed.duration,
        camera_movement: parsed.cameraMovement,
        audio_enabled: parsed.audioEnabled,
        slow_motion: parsed.slowMotion,
        batch_size: 1,
      },
    );
  }

  const mediaUrl = extractMediaUrl(parsed.mediaType, mediaResponse);
  const consistency =
    parsed.mediaType === "image" && node.data.entityRefs.characterIds.length > 0
      ? await evaluateConsistency(
          node.data.entityRefs.characterIds[0],
          mediaUrl,
          node.data.continuity.wardrobeVariantIds[0],
        )
      : {};

  const mediaAssetId = (await deps.createMediaAsset({
    storyboardId: deps.storyboardId,
    nodeId: parsed.nodeId,
    kind: parsed.mediaType,
    sourceUrl: mediaUrl,
    modelId: parsed.modelId,
    prompt: finalPrompt,
    negativePrompt: finalNegativePrompt || undefined,
    status: "completed",
    identityScore: consistency.identityScore,
    consistencyScore: consistency.consistencyScore,
    wardrobeCompliance: consistency.wardrobeCompliance,
  })) as string;

  await deps.recordStoryEvent({
    storyboardId: deps.storyboardId,
    nodeId: parsed.nodeId,
    eventType: "media_select",
    summary: `Batch generated ${parsed.mediaType} for node ${parsed.nodeId}`,
    details: `Operation ${operation.opId ?? operation.op}`,
    ancestorNodeIds: [parsed.nodeId],
  });

  return {
    operationId: operation.opId ?? operation.op,
    nodeId: parsed.nodeId,
    mediaType: parsed.mediaType,
    mediaUrl,
    mediaAssetId,
    success: true,
  };
};

export const executeApprovedExecutionPlan = async (
  deps: AdapterDependencies,
  input: ExecutionPlanInput,
  editedOperations?: unknown[],
): Promise<ExecutionPlanApprovalResult> => {
  if (!deps.storyboardId) {
    throw new Error("Storyboard context is missing");
  }
  const branchId = input.branchId || "main";
  const candidate = editedOperations ?? input.operations;
  const operations = sanitizeExecutionPlanOperations(candidate);
  const graphOperations = operations.filter((operation) => isGraphExecutionOperation(operation.op));
  const mediaOperations = operations.filter((operation) => isMediaExecutionOperation(operation.op));
  const graphOpsForMutation = graphOperations.map(toNarrativeGitOperation);
  const policyValidation = enforceExecutionPlanPolicy(deps, operations);

  const taskType =
    input.taskType
    ?? (input.source === "dailies"
      ? "dailies_batch"
      : input.source === "simulation_critic"
        ? "simulation_critic_batch"
        : graphOperations.length > 0 && mediaOperations.length > 0
          ? "batch_ops"
          : "execution_plan");
  const trackingIntent = input.source === "dailies"
    ? "approve_dailies_batch"
    : input.source === "simulation_critic"
      ? "approve_simulation_critic_batch"
      : "approve_execution_plan";

  const tracked = await withRunTracking(
    deps,
    trackingIntent,
    {
      planId: input.planId,
      branchId,
      operationCount: operations.length,
    },
    async (runId, quotaSnapshot) => {
      const dryRun = graphOpsForMutation.length > 0
        ? (await deps.simulateExecutionPlan({
          storyboardId: deps.storyboardId,
          branchId,
          operations: graphOpsForMutation,
        })) as {
          valid: boolean;
          riskLevel: "low" | "medium" | "high" | "critical";
          summary: string;
          issues: unknown[];
          estimatedTotalCost: number;
          estimatedDurationSec: number;
          planHash: string;
        }
        : {
          valid: true,
          riskLevel: input.dryRun?.riskLevel ?? "low",
          summary: input.dryRun?.summary ?? "No graph operations to dry-run.",
          issues: input.dryRun?.issues ?? [],
          estimatedTotalCost: input.dryRun?.estimatedTotalCost ?? Number((mediaOperations.length * 0.2).toFixed(2)),
          estimatedDurationSec:
            input.dryRun?.estimatedDurationSec ?? Number((Math.max(mediaOperations.length, 1) * 1.8).toFixed(2)),
          planHash: input.dryRun?.planHash ?? hashString(JSON.stringify({
            storyboardId: deps.storyboardId,
            branchId,
            operations: operations.map((operation) => ({ opId: operation.opId, op: operation.op })),
          })),
        };

      if (!dryRun.valid) {
        throw new Error(`Dry-run failed: ${dryRun.summary}`);
      }

      const taskId = (await deps.createApprovalTask({
        storyboardId: deps.storyboardId,
        taskType,
        dedupeKey: toDedupeKey("execution_plan", {
          storyboardId: deps.storyboardId,
          planId: input.planId,
          branchId,
          operations: operations.map((operation) => ({
            opId: operation.opId,
            op: operation.op,
            nodeId: operation.nodeId,
            edgeId: operation.edgeId,
          })),
          planHash: dryRun.planHash,
        }),
        title: input.title,
        rationale: input.rationale,
        diffSummary: dryRun.summary,
        payloadJson: JSON.stringify({
          planId: input.planId,
          source: input.source,
          sourceId: input.sourceId,
          branchId,
          operations: graphOpsForMutation,
          mediaOperations: mediaOperations.map((operation) => ({
            opId: operation.opId,
            op: operation.op,
            nodeId: operation.nodeId,
            title: operation.title,
          })),
          dryRun,
        }),
      })) as string;

      await deps.resolveApprovalTask({
        taskId,
        approved: true,
        editedPayloadJson: JSON.stringify({
          planId: input.planId,
          source: input.source,
          sourceId: input.sourceId,
          branchId,
          operations: graphOpsForMutation,
          mediaOperations: mediaOperations.map((operation) => ({
            opId: operation.opId,
            op: operation.op,
            nodeId: operation.nodeId,
            title: operation.title,
          })),
          dryRun,
        }),
      });

      if (deps.markApprovalExecutionStarted) {
        await deps.markApprovalExecutionStarted({ taskId });
      }

      let commit:
        | {
          commitId: string;
          branchId: string;
          operationCount: number;
          previousHeadCommitId?: string;
        }
        | undefined;
      if (graphOpsForMutation.length > 0) {
        commit = (await deps.commitPlanOps({
          storyboardId: deps.storyboardId,
          branchId,
          title: input.title,
          rationale: input.rationale,
          operations: graphOpsForMutation,
          approvalToken: `approved:${taskId}`,
          runId,
        })) as {
          commitId: string;
          branchId: string;
          operationCount: number;
          previousHeadCommitId?: string;
        };
      }

      const mediaResults: MediaPlanExecutionResult[] = [];
      let rollbackResult: {
        performed: boolean;
        rolledBackTo?: string;
        mediaReverted?: number;
        mediaSkipped?: number;
      } = { performed: false };
      try {
        for (const operation of mediaOperations) {
          const result = await executeMediaPlanOperation(deps, operation);
          mediaResults.push(result);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown media error";

        // Roll back the graph commit if one was made.
        if (commit?.previousHeadCommitId) {
          await deps.rollbackToCommit({
            storyboardId: deps.storyboardId,
            branchId,
            commitId: commit.previousHeadCommitId,
            approvalToken: `approved:${taskId}`,
          });
          rollbackResult = {
            ...rollbackResult,
            performed: true,
            rolledBackTo: commit.previousHeadCommitId,
          };
        }

        // Compensate earlier media successes: mark their mediaAssets rows
        // "rolled_back" and strip them from the affected nodes' active media
        // arrays. Compensation is best-effort — if it fails we still surface
        // the original batch error, but include the compensation error under
        // `compensationError` so the reviewer sees both.
        let compensationError: string | undefined;
        if (deps.revertBatchMediaAssets && mediaResults.length > 0) {
          const assetIds = mediaResults
            .map((row) => row.mediaAssetId)
            .filter((id): id is string => typeof id === "string" && id.length > 0);
          if (assetIds.length > 0) {
            try {
              const revertResult = (await deps.revertBatchMediaAssets({
                storyboardId: deps.storyboardId,
                mediaAssetIds: assetIds,
                reason: `Batch partial failure: ${errorMessage}`,
              })) as { reverted: number; skipped: number };
              rollbackResult = {
                ...rollbackResult,
                performed: true,
                mediaReverted: revertResult.reverted,
                mediaSkipped: revertResult.skipped,
              };
            } catch (compErr) {
              compensationError =
                compErr instanceof Error ? compErr.message : "Media compensation failed";
            }
          }
        }

        if (deps.markApprovalExecutionFinished) {
          await deps.markApprovalExecutionFinished({
            taskId,
            failed: true,
            resultJson: JSON.stringify({
              planId: input.planId,
              branchId: commit?.branchId ?? branchId,
              commitId: commit?.commitId,
              graphOperationCount: graphOperations.length,
              mediaOperationCount: mediaOperations.length,
              mediaSuccessCount: mediaResults.length,
              mediaFailureCount: mediaOperations.length - mediaResults.length,
              rollback: rollbackResult,
              error: errorMessage,
              ...(compensationError ? { compensationError } : {}),
            }),
          });
        }

        const suffixParts: string[] = [];
        if (rollbackResult.rolledBackTo) suffixParts.push("graph commit rolled back");
        if ((rollbackResult.mediaReverted ?? 0) > 0) {
          suffixParts.push(`${rollbackResult.mediaReverted} media asset(s) reverted`);
        }
        if (compensationError) {
          suffixParts.push(`compensation error: ${compensationError}`);
        }
        throw new Error(
          `Batch execution failed on media operation: ${errorMessage}${
            suffixParts.length > 0 ? ` (${suffixParts.join("; ")})` : ""
          }`,
        );
      }

      const touchedNodeIds = extractTouchedNodeIdsFromExecutionPlan(operations);
      if (commit) {
        await deps.recordStoryEvent({
          storyboardId: deps.storyboardId,
          branchId,
          nodeId: touchedNodeIds[0],
          eventType: "branch_create",
          summary: `Applied execution plan: ${input.title}`,
          details: `Commit ${commit.commitId}`,
          ancestorNodeIds: touchedNodeIds,
        });
      }
      if (input.source === "dailies" && input.sourceId) {
        await deps.updateDailiesStatus({
          storyboardId: deps.storyboardId,
          reelId: input.sourceId,
          status: "applied",
        });
      }
      if (input.source === "simulation_critic" && input.sourceId) {
        await deps.updateSimulationRunStatus({
          storyboardId: deps.storyboardId,
          simulationRunId: input.sourceId,
          status: "applied",
        });
      }

      if (touchedNodeIds.length > 0) {
        await deps.refreshNodeHistoryContexts({
          storyboardId: deps.storyboardId,
          nodeIds: touchedNodeIds,
        });
      }

      const finalResult = {
        taskId,
        runId,
        planId: input.planId,
        branchId: commit?.branchId ?? branchId,
        commitId: commit?.commitId,
        operationCount: operations.length,
        graphOperationCount: graphOperations.length,
        mediaOperationCount: mediaOperations.length,
        mediaSuccessCount: mediaResults.length,
        mediaFailureCount: mediaOperations.length - mediaResults.length,
        rollback: {
          performed: false,
        },
        dryRun,
        policyEvidence: buildPolicyEvidence(
          deps,
          policyValidation.rules,
          quotaSnapshot,
        ),
      };

      if (deps.markApprovalExecutionFinished) {
        await deps.markApprovalExecutionFinished({
          taskId,
          resultJson: JSON.stringify({
            planId: finalResult.planId,
            branchId: finalResult.branchId,
            commitId: finalResult.commitId,
            operationCount: finalResult.operationCount,
            graphOperationCount: finalResult.graphOperationCount,
            mediaOperationCount: finalResult.mediaOperationCount,
            mediaSuccessCount: finalResult.mediaSuccessCount,
            mediaFailureCount: finalResult.mediaFailureCount,
            rollback: finalResult.rollback,
          }),
        });
      }

      return finalResult;
    },
    {
      requestedMutationOps: graphOperations.length,
      requestedMediaBudget: mediaOperations.length,
      requestedRunOps: operations.length,
    },
  );

  return tracked.result;
};

export const executeRejectedExecutionPlan = async (
  deps: AdapterDependencies,
  input: ExecutionPlanInput,
): Promise<{ taskId: string }> => {
  const taskType =
    input.taskType
    ?? (input.source === "dailies"
      ? "dailies_batch"
      : input.source === "simulation_critic"
        ? "simulation_critic_batch"
        : "execution_plan");
  const taskId = (await deps.createApprovalTask({
    storyboardId: deps.storyboardId,
    taskType,
    title: input.title,
    rationale: input.rationale,
    diffSummary: "Execution plan rejected by producer",
    payloadJson: JSON.stringify(input),
  })) as string;

  await deps.resolveApprovalTask({
    taskId,
    approved: false,
    justification: "Rejected by producer",
  });

  if (input.source === "dailies" && input.sourceId) {
    await deps.updateDailiesStatus({
      storyboardId: deps.storyboardId,
      reelId: input.sourceId,
      status: "rejected",
    });
  }
  if (input.source === "simulation_critic" && input.sourceId) {
    await deps.updateSimulationRunStatus({
      storyboardId: deps.storyboardId,
      simulationRunId: input.sourceId,
      status: "rejected",
    });
  }
  return { taskId };
};

export const executeRejectedMediaPrompt = async (
  deps: AdapterDependencies,
  input: MediaPromptInput,
): Promise<{ taskId: string }> => {
  const taskId = (await deps.createApprovalTask({
    storyboardId: deps.storyboardId,
    taskType: "media_prompt",
    title: `Generate ${input.mediaType} for node`,
    rationale: "Producer rejected media prompt",
    diffSummary: input.contextSummary,
    payloadJson: JSON.stringify(input),
  })) as string;

  await deps.resolveApprovalTask({
    taskId,
    approved: false,
    justification: "Rejected by producer",
  });

  return { taskId };
};

export type {
  GraphPatchInput,
  MediaPromptInput,
  ExecutionPlanInput,
  GraphPatchOperation,
  AdapterDependencies,
  ExecutionPlanApprovalResult,
};
