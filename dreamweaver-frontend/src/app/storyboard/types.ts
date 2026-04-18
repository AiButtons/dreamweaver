import { Node, Edge } from 'reactflow';

export type NodeType = "scene" | "shot" | "branch" | "merge" | "character_ref" | "background_ref";

export interface MediaVariant {
  id: string;
  kind: "image" | "video";
  url: string;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  status: "pending" | "completed" | "failed";
  createdAt: number;
  consistencyScore?: number;
  identityScore?: number;
  wardrobeCompliance?: "matching" | "deviation" | "unknown";
}

export interface CharacterIdentityProfile {
  facialMarkers: string[];
  ageBand: string;
  bodySilhouette: string;
  skinHairSignature: string;
  voiceTags: string[];
}

export interface WardrobeVariant {
  variantId: string;
  name: string;
  description: string;
  palette: string[];
  props: string[];
  hairMakeupDelta: string;
}

export interface StoryNodeData {
  label: string;
  segment: string;
  nodeType: NodeType;
  entityRefs: {
    characterIds: string[];
    backgroundId?: string;
    sceneId?: string;
    shotId?: string;
  };
  continuity: {
    identityLockVersion: number;
    wardrobeVariantIds: string[];
    consistencyStatus: "ok" | "warning" | "blocked";
  };
  historyContext: {
    eventIds: string[];
    rollingSummary: string;
    tokenBudgetUsed: number;
    lineageHash: string;
  };
  promptPack: {
    imagePrompt?: string;
    videoPrompt?: string;
    negativePrompt?: string;
    continuityDirectives: string[];
  };
  media: {
    images: MediaVariant[];
    videos: MediaVariant[];
    activeImageId?: string;
    activeVideoId?: string;
  };

  // Legacy fields kept for UI compatibility while migrating to media[] variants.
  image?: string;
  imageHistory?: string[];
  inputImage?: string;
  audio?: string;
  video?: string;
  isProcessing?: boolean;
  processingTask?: string; // 'text' | 'image' | 'audio' | 'video'
}

export interface StoryEdgeData {
  edgeType: "serial" | "parallel" | "branch" | "merge";
  branchId?: string;
  order?: number;
  isPrimary?: boolean;
}

export type PlanOperationType =
  | "create_node"
  | "update_node"
  | "delete_node"
  | "create_edge"
  | "update_edge"
  | "delete_edge"
  | "generate_image"
  | "generate_video";

export interface PlanOperation {
  opId: string;
  op: PlanOperationType;
  title: string;
  rationale: string;
  nodeId?: string;
  edgeId?: string;
  payload?: Record<string, unknown>;
  requiresHitl: boolean;
  estimatedCost?: number;
}

export interface DryRunIssue {
  code: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  nodeIds?: string[];
  edgeIds?: string[];
  suggestedFix?: string;
}

export interface DryRunReport {
  valid: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
  summary: string;
  issues: DryRunIssue[];
  estimatedTotalCost: number;
  estimatedDurationSec: number;
  planHash: string;
}

export interface SemanticDiff {
  fromCommitId: string;
  toCommitId: string;
  intentChanges: string[];
  continuityChanges: string[];
  visualChanges: string[];
  pacingChanges: string[];
  riskNotes: string[];
}

export interface ExecutionPlan {
  planId: string;
  storyboardId: string;
  branchId: string;
  title: string;
  rationale: string;
  operations: PlanOperation[];
  dryRun: DryRunReport;
  semanticDiff: SemanticDiff;
  approvalToken?: string;
  source?: "agent" | "dailies" | "simulation_critic" | "repair";
  sourceId?: string;
}

export interface RollbackHandle {
  branchId: string;
  commitId: string;
  reason: string;
}

export interface AutonomousDailiesClip {
  nodeId: string;
  mediaAssetId: string;
  kind: "image" | "video";
  sourceUrl: string;
}

export interface AutonomousDailiesReel {
  reelId: string;
  title: string;
  summary: string;
  branchId: string;
  highlights: string[];
  continuityRiskLevel: "low" | "medium" | "high" | "critical";
  continuityRisks: DryRunIssue[];
  clips: AutonomousDailiesClip[];
  executionPlan: ExecutionPlan;
}

export interface SimulationCriticRun {
  simulationRunId: string;
  summary: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  issues: DryRunIssue[];
  repairOperations: PlanOperation[];
  confidence: number;
  impactScore: number;
  executionPlan: ExecutionPlan;
}

export type TeamVisibility = "private" | "workspace" | "public_read";
export type TeamStatus = "active" | "archived";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type StoryboardStatus = "active" | "trashed";
export type StoryboardSort = "updated_desc" | "updated_asc" | "title_asc" | "created_desc";

export interface StoryboardLibraryItem {
  _id: string;
  title: string;
  description?: string;
  status?: StoryboardStatus;
  isPinned?: boolean;
  templateId?: string;
  coverImageUrl?: string;
  nodeCount?: number;
  edgeCount?: number;
  imageCount?: number;
  videoCount?: number;
  updatedAt: number;
  createdAt: number;
  lastOpenedAt?: number;
  trashedAt?: number;
  purgeAt?: number;
}

export interface StoryboardTemplate {
  templateId: string;
  name: string;
  description: string;
  visualTheme: string;
  mode: "graph_studio" | "agent_draft";
}

export type StoryboardLifecycleAction =
  | "open"
  | "rename"
  | "duplicate"
  | "pin"
  | "unpin"
  | "trash"
  | "restore"
  | "delete_permanent";

export interface TeamMemberConfig {
  memberId: string;
  agentName: string;
  role: string;
  persona: string;
  nicheDescription: string;
  toolScope: string[];
  resourceScope: string[];
  weight: number;
  enabled: boolean;
}

export interface TeamPolicy {
  requiresHitl: boolean;
  riskThresholds: {
    warnAt: RiskLevel;
    blockAt: RiskLevel;
  };
  maxBatchSize: number;
  quotaProfileId: string;
  maxRunOps: number;
  maxConcurrentRuns: number;
  quotaEnforced: boolean;
}

export interface TeamDefinition {
  _id: string;
  teamId: string;
  name: string;
  description: string;
  ownerUserId: string;
  visibility: TeamVisibility;
  status: TeamStatus;
  isPrebuilt: boolean;
  currentPublishedRevisionId?: string;
  createdAt: number;
  updatedAt: number;
  revisionCount?: number;
  publishedRevisionId?: string;
  publishedVersion?: number;
}

export interface TeamRevision {
  revisionId: string;
  version: number;
  teamGoal: string;
  published: boolean;
  createdAt: number;
  policy: TeamPolicy;
  members: TeamMemberConfig[];
  toolAllowlist: string[];
  resourceScopes: string[];
}

export interface TeamAssignment {
  storyboardId: string;
  activeTeamId: string;
  activeRevisionId: string;
  fallbackTeamId?: string;
  updatedAt: number;
}

export interface RuntimeResolvedTeam {
  teamId: string;
  teamName: string;
  revisionId: string;
  version: number;
  teamGoal: string;
  members: TeamMemberConfig[];
  toolAllowlist: string[];
  resourceScopes: string[];
  runtimePolicy: TeamPolicy & {
    dailyMediaBudget: number;
    dailyMutationOps: number;
  };
}

export interface TeamPromptDraft {
  draftId: string;
  generatedSpec: {
    teamGoal: string;
    policy: TeamPolicy;
    members: TeamMemberConfig[];
    toolAllowlist: string[];
    resourceScopes: string[];
  };
}

export interface QuotaUsageSummary {
  quotaProfile: {
    quotaProfileId: string;
    name: string;
    dailyMediaBudget: number;
    dailyMutationOps: number;
    maxRunOps: number;
    maxConcurrentRuns: number;
  };
  usage: {
    dayKey: string;
    mediaBudgetUsed: number;
    mutationOpsUsed: number;
    activeRuns: number;
  };
  remaining: {
    mediaBudget: number;
    mutationOps: number;
    concurrentRuns: number;
  };
}

export interface ApprovalTaskRecord {
  _id: string;
  taskType: string;
  status: string;
  title: string;
  rationale: string;
  diffSummary?: string;
  payloadJson: string;
  executionResultJson?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentDelegationRecord {
  _id: string;
  runId: string;
  delegationId: string;
  agentName: string;
  task: string;
  status: "queued" | "running" | "complete" | "failed";
  inputJson: string;
  outputJson?: string;
  latencyMs?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ToolCallAuditRecord {
  _id: string;
  runId?: string;
  teamId?: string;
  revisionId?: string;
  member: string;
  tool: string;
  scope: string[];
  result: "success" | "failure" | "blocked";
  detailsJson?: string;
  createdAt: number;
}

export interface AutonomousDailiesRecord {
  _id: string;
  reelId: string;
  branchId: string;
  title: string;
  summary: string;
  highlights: string[];
  continuityRiskLevel: "low" | "medium" | "high" | "critical";
  continuityRisksJson: string;
  proposedOperationsJson: string;
  status: "drafted" | "approved" | "rejected" | "applied";
  createdAt: number;
  updatedAt: number;
}

export interface SimulationCriticRunRecord {
  _id: string;
  simulationRunId: string;
  branchId: string;
  sourcePlanId?: string;
  status: "complete" | "failed" | "waiting_for_human" | "applied" | "rejected";
  summary: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  issuesJson: string;
  repairOperationsJson: string;
  confidence: number;
  impactScore: number;
  createdAt: number;
  updatedAt: number;
}

export interface ConstraintBundle {
  identityPacks: Array<Record<string, unknown>>;
  globalConstraints: Array<Record<string, unknown>>;
  continuityViolations: Array<Record<string, unknown>>;
}

export interface NarrativeBranchRecord {
  _id: string;
  branchId: string;
  name: string;
  parentBranchId?: string;
  parentCommitId?: string;
  headCommitId?: string;
  isDefault: boolean;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

export interface NarrativeCommitRecord {
  _id: string;
  commitId: string;
  branchId: string;
  summary: string;
  rationale?: string;
  operationCount: number;
  parentCommitId?: string;
  createdAt: number;
}

export type StoryNode = Node<StoryNodeData>;
export type StoryEdge = Edge<StoryEdgeData>;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export enum MediaType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO'
}

export interface GraphResponse {
  nodes: {
    id: string;
    data: {
      label: string;
      segment: string;
      nodeType?: NodeType;
    };
    position: { x: number; y: number };
  }[];
  edges: {
    id: string;
    source: string;
    target: string;
  }[];
}

export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export interface AudioConfig {
  voice: VoiceName;
  tone?: string;
}

export interface ImageConfig {
  style?: string;
  aspectRatio?: string;
}

export interface VideoConfig {
  aspectRatio: '16:9' | '9:16';
  style?: string;
}

export interface StoryboardMediaConfig {
  voice?: VoiceName;
  style?: string;
  aspectRatio?: string;
  inputImage?: string;
  negativePrompt?: string;
  startImage?: string;
  endImage?: string;
  audioEnabled?: boolean;
  slowMotion?: boolean;
  duration?: number;
  // Per-node model overrides. Frontend providers will fall back to defaults
  // (e.g. zennah-image-gen / ltx-2.3) when these are unset.
  imageModelId?: string;
  videoModelId?: string;
  // LTX-2.3 specific video overrides.
  enhancePrompt?: boolean;
  cameraMovement?: string;
  numInferenceSteps?: number;
  cfgGuidanceScale?: number;
  seed?: number;
}
