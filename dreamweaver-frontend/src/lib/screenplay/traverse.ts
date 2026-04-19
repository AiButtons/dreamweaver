import type { ShotMeta } from "@/app/storyboard/types";
import type {
  ScreenplayEdgeInput,
  ScreenplayInput,
  ScreenplayNodeInput,
} from "./types";

export interface TraversedScene {
  sceneNode: ScreenplayNodeInput | null;
  sceneIndex: number;
  shots: ScreenplayNodeInput[];
  transitionOut?: string;
}

const STRUCTURAL_NODE_TYPES = new Set(["character_ref", "background_ref"]);

const compareEdgesForOrdering = (
  a: ScreenplayEdgeInput,
  b: ScreenplayEdgeInput,
): number => {
  const aPrimary = a.isPrimary ? 1 : 0;
  const bPrimary = b.isPrimary ? 1 : 0;
  if (aPrimary !== bPrimary) return bPrimary - aPrimary;
  const aOrder = typeof a.order === "number" ? a.order : Number.POSITIVE_INFINITY;
  const bOrder = typeof b.order === "number" ? b.order : Number.POSITIVE_INFINITY;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return a.edgeId.localeCompare(b.edgeId);
};

const compareNodesForRootOrder = (
  a: ScreenplayNodeInput,
  b: ScreenplayNodeInput,
): number => {
  if (a.position.x !== b.position.x) return a.position.x - b.position.x;
  if (a.position.y !== b.position.y) return a.position.y - b.position.y;
  return a.nodeId.localeCompare(b.nodeId);
};

const branchToTransition = (node: ScreenplayNodeInput): string => {
  const label = (node.label ?? "").trim();
  if (node.nodeType === "merge") {
    return "CUT TO:";
  }
  if (!label) return "CUT TO:";
  const upper = label.toUpperCase();
  if (upper.endsWith("TO:")) return upper;
  return `${upper} TO:`;
};

/**
 * Deterministic primary-path DFS walk over the storyboard graph.
 * Shots/scenes are emitted in visitation order; branch/merge nodes are
 * consumed only to synthesize transition strings for the scene preceding them.
 */
export const traverseStoryboard = (input: ScreenplayInput): TraversedScene[] => {
  const nodesById = new Map<string, ScreenplayNodeInput>();
  for (const node of input.nodes) {
    nodesById.set(node.nodeId, node);
  }

  const outgoing = new Map<string, ScreenplayEdgeInput[]>();
  const incoming = new Map<string, ScreenplayEdgeInput[]>();
  for (const edge of input.edges) {
    if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) {
      continue;
    }
    const outs = outgoing.get(edge.sourceNodeId) ?? [];
    outs.push(edge);
    outgoing.set(edge.sourceNodeId, outs);
    const ins = incoming.get(edge.targetNodeId) ?? [];
    ins.push(edge);
    incoming.set(edge.targetNodeId, ins);
  }

  for (const [nodeId, edges] of outgoing) {
    edges.sort(compareEdgesForOrdering);
    outgoing.set(nodeId, edges);
  }

  // Roots: any node with no incoming edges. Sort deterministically.
  const roots = input.nodes
    .filter((n) => !(incoming.get(n.nodeId)?.length ?? 0))
    .sort(compareNodesForRootOrder);

  // Fallback: if every node has incoming (cyclic), start from the topologically
  // earliest node by position to stay deterministic.
  const startingNodes = roots.length > 0 ? roots : [...input.nodes].sort(compareNodesForRootOrder).slice(0, 1);

  const visited = new Set<string>();
  const linearWalk: ScreenplayNodeInput[] = [];

  const dfs = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) return;
    linearWalk.push(node);
    const outs = outgoing.get(nodeId) ?? [];
    for (const edge of outs) {
      dfs(edge.targetNodeId);
    }
  };

  for (const root of startingNodes) {
    dfs(root.nodeId);
  }
  // Any nodes not reachable from roots still get appended deterministically.
  for (const node of [...input.nodes].sort(compareNodesForRootOrder)) {
    if (!visited.has(node.nodeId)) {
      dfs(node.nodeId);
    }
  }

  const scenes: TraversedScene[] = [];
  let sceneCounter = 0;

  const openScene = (sceneNode: ScreenplayNodeInput | null): TraversedScene => {
    sceneCounter += 1;
    const scene: TraversedScene = {
      sceneNode,
      sceneIndex: sceneCounter,
      shots: [],
    };
    scenes.push(scene);
    return scene;
  };

  const currentScene = (): TraversedScene | null =>
    scenes.length > 0 ? scenes[scenes.length - 1] : null;

  for (const node of linearWalk) {
    if (STRUCTURAL_NODE_TYPES.has(node.nodeType)) {
      continue;
    }
    if (node.nodeType === "scene") {
      openScene(node);
      continue;
    }
    if (node.nodeType === "branch" || node.nodeType === "merge") {
      const existing = currentScene();
      if (existing) {
        existing.transitionOut = branchToTransition(node);
      }
      continue;
    }
    if (node.nodeType === "shot") {
      const scene = currentScene() ?? openScene(null);
      scene.shots.push(node);
      continue;
    }
  }

  return scenes;
};

const SCENE_PREFIX_REGEX = /^(INT\.|EXT\.|INT |EXT |INT\/EXT\.|I\/E\.)/i;

export const deriveSceneHeading = (
  sceneNode: ScreenplayNodeInput | null,
  fallbackIndex: number,
): string => {
  if (!sceneNode) {
    return `INT. SCENE ${fallbackIndex} - DAY`;
  }
  const label = (sceneNode.label ?? "").trim();
  if (!label) {
    return `INT. SCENE ${fallbackIndex} - DAY`;
  }
  if (SCENE_PREFIX_REGEX.test(label)) {
    return label.toUpperCase();
  }
  return `INT. ${label.toUpperCase()} - DAY`;
};

const indexToLetters = (index: number): string => {
  // 0 -> A, 1 -> B, ... 25 -> Z, 26 -> AA, 27 -> AB, ...
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
};

export const deriveShotNumber = (
  shot: ScreenplayNodeInput,
  sceneIndex: number,
  shotIndexInScene: number,
): string => {
  const existing = shot.shotMeta?.number?.trim();
  if (existing) return existing;
  return `${sceneIndex}${indexToLetters(shotIndexInScene)}`;
};

export const formatShotMetaSlug = (meta: ShotMeta | undefined): string | null => {
  if (!meta) return null;
  const parts: string[] = [];
  if (meta.size) parts.push(meta.size);
  if (meta.angle) parts.push(meta.angle.replace(/_/g, " "));
  const lens: string[] = [];
  if (typeof meta.lensMm === "number") lens.push(`${meta.lensMm}mm`);
  if (meta.tStop) lens.push(meta.tStop);
  if (lens.length) parts.push(lens.join(" "));
  if (meta.move && meta.move !== "static") parts.push(meta.move);
  if (meta.aspect) parts.push(meta.aspect);
  if (typeof meta.durationS === "number") parts.push(`${meta.durationS}s`);
  if (meta.screenDirection && meta.screenDirection !== "neutral") {
    parts.push(meta.screenDirection.replace(/_/g, " "));
  }
  if (parts.length === 0) return null;
  return parts.join(", ");
};
