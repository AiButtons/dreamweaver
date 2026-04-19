export interface CherryPickSummary {
  totalOps: number;
  /** Count per op type, e.g. { create_node: 2, update_node: 1, generate_image: 3 } */
  opCounts: Record<string, number>;
  /** Unique node IDs touched by any operation. Order of first appearance. */
  touchedNodeIds: string[];
  /** Unique edge IDs touched by any operation. Order of first appearance. */
  touchedEdgeIds: string[];
  /** Present when operationsJson is malformed or not an array. */
  invalid?: string;
}

const emptyInvalid = (reason: string): CherryPickSummary => ({
  totalOps: 0,
  opCounts: {},
  touchedNodeIds: [],
  touchedEdgeIds: [],
  invalid: reason,
});

/**
 * Summarize the contents of a commit's operationsJson for preview display.
 * Tolerant of malformed input - returns invalid-marker rather than throwing.
 * Accepts bare JSON string.
 */
export const summarizeCherryPick = (operationsJson: string): CherryPickSummary => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(operationsJson);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Failed to parse operations payload";
    return emptyInvalid(reason);
  }

  if (!Array.isArray(parsed)) {
    return emptyInvalid("Operations payload is not an array");
  }

  const opCounts: Record<string, number> = {};
  const touchedNodeIds: string[] = [];
  const touchedEdgeIds: string[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();

  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") {
      opCounts.unknown = (opCounts.unknown ?? 0) + 1;
      continue;
    }
    const op = entry as Record<string, unknown>;
    const opName = typeof op.op === "string" && op.op.length > 0 ? op.op : "unknown";
    opCounts[opName] = (opCounts[opName] ?? 0) + 1;

    if (typeof op.nodeId === "string" && op.nodeId.length > 0 && !seenNodes.has(op.nodeId)) {
      seenNodes.add(op.nodeId);
      touchedNodeIds.push(op.nodeId);
    }
    if (typeof op.edgeId === "string" && op.edgeId.length > 0 && !seenEdges.has(op.edgeId)) {
      seenEdges.add(op.edgeId);
      touchedEdgeIds.push(op.edgeId);
    }
  }

  return {
    totalOps: parsed.length,
    opCounts,
    touchedNodeIds,
    touchedEdgeIds,
  };
};
