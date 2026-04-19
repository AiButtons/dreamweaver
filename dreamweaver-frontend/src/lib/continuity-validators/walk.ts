import type { ValidatorEdge, ValidatorInput, ValidatorNode } from "./types";

/** Stable tie-breaker on edges: primary first, then `order` asc, then source+target lexical. */
const compareEdges = (a: ValidatorEdge, b: ValidatorEdge): number => {
  const aPrimary = a.isPrimary ? 1 : 0;
  const bPrimary = b.isPrimary ? 1 : 0;
  if (aPrimary !== bPrimary) return bPrimary - aPrimary;
  const aOrder = typeof a.order === "number" ? a.order : Number.POSITIVE_INFINITY;
  const bOrder = typeof b.order === "number" ? b.order : Number.POSITIVE_INFINITY;
  if (aOrder !== bOrder) return aOrder - bOrder;
  const aKey = `${a.sourceNodeId}->${a.targetNodeId}`;
  const bKey = `${b.sourceNodeId}->${b.targetNodeId}`;
  return aKey.localeCompare(bKey);
};

/**
 * Walk the storyboard graph along its primary path and return shots in
 * linear visitation order. Non-shot nodes (scenes, branch/merge markers,
 * character/background refs) are skipped but do not stop the walk.
 * Primary edges win over non-primary; ties broken by `order` asc, then edgeId.
 * Cycles are safely detected and terminate the walk.
 */
export const walkShotsInPrimaryOrder = (
  input: ValidatorInput,
): ValidatorNode[] => {
  const { nodes, edges } = input;
  if (nodes.length === 0) return [];

  const nodeById = new Map<string, ValidatorNode>();
  for (const n of nodes) {
    nodeById.set(n.nodeId, n);
  }

  // adjacency: sourceId -> sorted edges
  const outgoing = new Map<string, ValidatorEdge[]>();
  const incomingCount = new Map<string, number>();
  for (const n of nodes) {
    outgoing.set(n.nodeId, []);
    incomingCount.set(n.nodeId, 0);
  }
  for (const e of edges) {
    if (!nodeById.has(e.sourceNodeId) || !nodeById.has(e.targetNodeId)) continue;
    outgoing.get(e.sourceNodeId)!.push(e);
    incomingCount.set(e.targetNodeId, (incomingCount.get(e.targetNodeId) ?? 0) + 1);
  }
  for (const list of outgoing.values()) {
    list.sort(compareEdges);
  }

  // Pick roots: nodes with no incoming edge. If none (pure cycle), start from
  // the first node in declaration order.
  const roots = nodes.filter((n) => (incomingCount.get(n.nodeId) ?? 0) === 0);
  const startNodes = roots.length > 0 ? roots : [nodes[0]];

  const visited = new Set<string>();
  const ordered: ValidatorNode[] = [];

  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodeById.get(nodeId);
    if (!node) return;
    ordered.push(node);
    const outs = outgoing.get(nodeId) ?? [];
    for (const edge of outs) {
      visit(edge.targetNodeId);
    }
  };

  for (const root of startNodes) {
    visit(root.nodeId);
  }

  // Any unreachable nodes (e.g. isolated components) — visit them in
  // declaration order so orphans still contribute to validator coverage.
  for (const n of nodes) {
    if (!visited.has(n.nodeId)) {
      visit(n.nodeId);
    }
  }

  return ordered.filter((n) => n.nodeType === "shot");
};

/** Returns true iff both shots are `shot` type and share at least one character id. */
export const shotsShareCharacter = (
  a: ValidatorNode,
  b: ValidatorNode,
): boolean => {
  if (a.nodeType !== "shot" || b.nodeType !== "shot") return false;
  const aChars = a.entityRefs?.characterIds ?? [];
  const bChars = b.entityRefs?.characterIds ?? [];
  if (aChars.length === 0 || bChars.length === 0) return false;
  const aSet = new Set(aChars);
  for (const c of bChars) {
    if (aSet.has(c)) return true;
  }
  return false;
};
