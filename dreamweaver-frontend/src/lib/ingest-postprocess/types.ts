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

/** Per-character facing direction in a shot's first frame. Emitted by the
 *  ViMax storyboard_artist and consumed by the M3 #5 smart shot-batch
 *  selector. Kept in sync with `CharacterFacing` in
 *  `@/lib/shot-batch/selector`. */
export type CharacterFacing =
  | "toward_camera"
  | "away_from_camera"
  | "screen_left"
  | "screen_right"
  | "three_quarter_left"
  | "three_quarter_right";

export interface PythonIngestedShotNode {
  nodeId: string;
  nodeType: "scene" | "shot";
  label: string;
  segment: string;
  position: { x: number; y: number };
  shotMeta: Record<string, unknown> | null;
  promptPack: Record<string, unknown> | null;
  characterIdentifiers: string[];
  /** Optional map from characterId → facing. Omitted / null when the LLM
   *  couldn't classify facings; the shot-batch selector falls back to
   *  shot size + angle + screenDirection heuristics. */
  characterFacings?: Record<string, CharacterFacing> | null;
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
