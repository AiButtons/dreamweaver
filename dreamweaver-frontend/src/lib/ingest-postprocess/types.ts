/**
 * Shared types between the blocking and streaming ingestion routes.
 * Mirrors the Python `IngestionResult` shape at the wire boundary.
 */

export type PortraitView = "front" | "side" | "back" | "three_quarter" | "custom";

export interface PythonIngestedCharacter {
  identifier: string;
  staticFeatures: string;
  dynamicFeatures: string;
  isVisible: boolean;
  identityPackName: string;
}

export interface PythonIngestedPortrait {
  characterIdentifier: string;
  view: PortraitView;
  sourceUrl: string; // empty from Python — Next.js fills
  prompt: string;
  /** When set, fulfill this prompt with the same character's already-generated
   *  portrait of `conditionOnView` as an I2I reference. */
  conditionOnView?: PortraitView | null;
}

export interface PythonIngestedShotNode {
  nodeId: string;
  nodeType: "scene" | "shot";
  label: string;
  segment: string;
  position: { x: number; y: number };
  shotMeta: Record<string, unknown> | null;
  promptPack: Record<string, unknown> | null;
  characterIdentifiers: string[];
}

export interface PythonIngestedEdge {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: "serial" | "parallel" | "branch" | "merge";
  isPrimary: boolean;
  order: number | null;
}

export interface PythonIngestionResult {
  storyboardId: string;
  screenplayLength: number;
  characters: PythonIngestedCharacter[];
  portraits: PythonIngestedPortrait[];
  nodes: PythonIngestedShotNode[];
  edges: PythonIngestedEdge[];
  pipelineDurationMs: number;
  llmCallCount: number;
  preprocessed: boolean;
}

/** Aggregate outcome of the post-processing pipeline. */
export interface PostProcessOutcome {
  storyboardId: string;
  characterCount: number;
  identityPacksWritten: number;
  identityPackFailures: string[];
  portraitCount: number;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
}

/**
 * Event emitter contract for the streaming path. Blocking routes pass
 * undefined and these are no-ops. Event types mirror the SSE vocabulary
 * consumed by `useIngestStream` so the client can treat both paths
 * identically.
 */
export type PostProcessEventType =
  | "stage"
  | "portraits_progress"
  | "writing_identities"
  | "writing_portraits"
  | "writing_graph";

export interface PostProcessEmit {
  (event: PostProcessEventType, payload: Record<string, unknown>): void;
}
