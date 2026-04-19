import type { ShotMeta, NodeType } from "@/app/storyboard/types";

export type ScreenplayFormat = "fountain" | "fdx" | "edl" | "fcpxml";

export interface ScreenplayNodeInput {
  nodeId: string;
  nodeType: NodeType;
  label: string;
  segment: string;
  position: { x: number; y: number };
  shotMeta?: ShotMeta;
  entityRefs?: {
    characterIds: string[];
    backgroundId?: string;
    sceneId?: string;
    shotId?: string;
  };
}

export interface ScreenplayEdgeInput {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: "serial" | "parallel" | "branch" | "merge";
  isPrimary?: boolean;
  order?: number;
  branchId?: string;
}

export interface ScreenplayInput {
  title: string;
  author?: string;
  draftDate?: string;
  cutTier?: string;      // pre-formatted label, e.g. "Director's Cut"
  reviewRound?: number;  // 1-based; emitter formats as "R2"
  nodes: ScreenplayNodeInput[];
  edges: ScreenplayEdgeInput[];
  /** Frames per second for EDL + FCP7 XML. Default 24. */
  frameRate?: number;
  /** Sequence start timecode "HH:MM:SS:FF". Default "01:00:00:00" (industry 1-hour preroll). */
  sequenceStart?: string;
  /** Default per-shot duration in seconds when shotMeta.durationS is absent. Default 3. */
  defaultShotDurationS?: number;
}

export interface ScreenplayDocument {
  content: string;
  mimeType: string;
  fileExtension: string;
}
