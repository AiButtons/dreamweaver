import type {
  CriticPromptEdge,
  CriticPromptInput,
  CriticPromptNode,
} from "./types";

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
  /** Number of nodes that survived truncation (for telemetry). */
  nodeCount: number;
  truncated: boolean;
}

/** Node types that contribute narrative/visual state to the critic. */
const CRITIC_RELEVANT_TYPES: ReadonlySet<string> = new Set([
  "scene",
  "shot",
]);

const DEFAULT_MAX_NODES = 80;

/** Stable tie-breaker on edges: primary first, then `order` asc, then source+target lexical. */
const compareEdges = (a: CriticPromptEdge, b: CriticPromptEdge): number => {
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
 * Walk the storyboard graph along its primary path and return nodes in
 * linear visitation order. This mirrors the traversal pattern used by
 * `src/lib/continuity-validators/walk.ts`; kept standalone here so this
 * lib has no internal cross-module coupling.
 */
const linearizeNodes = (
  nodes: CriticPromptNode[],
  edges: CriticPromptEdge[],
): CriticPromptNode[] => {
  if (nodes.length === 0) return [];

  const nodeById = new Map<string, CriticPromptNode>();
  for (const n of nodes) nodeById.set(n.nodeId, n);

  const outgoing = new Map<string, CriticPromptEdge[]>();
  const incomingCount = new Map<string, number>();
  for (const n of nodes) {
    outgoing.set(n.nodeId, []);
    incomingCount.set(n.nodeId, 0);
  }
  for (const e of edges) {
    if (!nodeById.has(e.sourceNodeId) || !nodeById.has(e.targetNodeId)) continue;
    outgoing.get(e.sourceNodeId)!.push(e);
    incomingCount.set(
      e.targetNodeId,
      (incomingCount.get(e.targetNodeId) ?? 0) + 1,
    );
  }
  for (const list of outgoing.values()) list.sort(compareEdges);

  const roots = nodes.filter((n) => (incomingCount.get(n.nodeId) ?? 0) === 0);
  const startNodes = roots.length > 0 ? roots : [nodes[0]];

  const visited = new Set<string>();
  const ordered: CriticPromptNode[] = [];

  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodeById.get(nodeId);
    if (!node) return;
    ordered.push(node);
    for (const edge of outgoing.get(nodeId) ?? []) {
      visit(edge.targetNodeId);
    }
  };

  for (const root of startNodes) visit(root.nodeId);

  // Orphans / unreachable components — include in declaration order so the
  // critic still sees them.
  for (const n of nodes) {
    if (!visited.has(n.nodeId)) visit(n.nodeId);
  }

  return ordered.filter((n) => CRITIC_RELEVANT_TYPES.has(n.nodeType));
};

const SYSTEM_PROMPT = `You are a professional script supervisor reviewing a storyboard for continuity.
Identify issues across five categories:

- CRITIC_NARRATIVE_TIMELINE — cause/effect ordering, deaths, impossible time jumps, character appearing after being removed from the story.
- CRITIC_WARDROBE — costume/hair/makeup changes without in-story motivation.
- CRITIC_CHARACTER_ARC — motivation reversals without setup; personality swaps.
- CRITIC_LOCATION — unexplained setting changes mid-scene, geographic impossibilities.
- CRITIC_CONTINUITY_BREAK — props appearing/disappearing, visible-prop mismatches, anything else that breaks audience suspension of disbelief.

For each violation, return STRICT JSON matching the provided schema. Reference nodes BY EXACT nodeId strings from the input; do not invent IDs. A violation may reference 1-4 nodes. If you cannot find any violations, return an empty "violations" array.

Severity: use "critical" for plot-breaking, "high" for audience-noticeable, "medium" for craft-level, "low" for pedantic.

Do NOT comment on:
- Shot composition, 180 degree line, eyeline match, or 30 degree rule (those are handled by a separate deterministic validator — do not duplicate).
- Prompts or generation quality.
- Writing style or grammar.

Respond with JSON only. No prose, no code fences, no commentary.`;

/** Gemini-native response schema. Pass as `config.responseSchema`. */
export const CRITIC_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    violations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          code: {
            type: "STRING",
            enum: [
              "CRITIC_NARRATIVE_TIMELINE",
              "CRITIC_WARDROBE",
              "CRITIC_CHARACTER_ARC",
              "CRITIC_LOCATION",
              "CRITIC_CONTINUITY_BREAK",
              "CRITIC_OTHER",
            ],
          },
          severity: {
            type: "STRING",
            enum: ["low", "medium", "high", "critical"],
          },
          message: { type: "STRING" },
          nodeIds: { type: "ARRAY", items: { type: "STRING" } },
          edgeIds: { type: "ARRAY", items: { type: "STRING" } },
          suggestedFix: { type: "STRING" },
        },
        required: ["code", "severity", "message", "nodeIds"],
      },
    },
  },
  required: ["violations"],
} as const;

const formatNodeLines = (node: CriticPromptNode, index: number): string => {
  const lines: string[] = [];
  lines.push(
    `[${index}] ${node.nodeId} (${node.nodeType}) "${node.label}"`,
  );
  const segment = (node.segment ?? "").trim();
  if (segment.length > 0) {
    lines.push(`    Segment: ${segment.slice(0, 400)}`);
  }
  const chars = node.characterIds ?? [];
  lines.push(`    Characters: ${chars.length > 0 ? chars.join(", ") : "none"}`);
  const wardrobe = node.wardrobeVariantIds ?? [];
  lines.push(`    Wardrobe: ${wardrobe.length > 0 ? wardrobe.join(", ") : "none"}`);
  if (node.shotMetaSlug && node.shotMetaSlug.trim().length > 0) {
    lines.push(`    Shot: ${node.shotMetaSlug.trim()}`);
  }
  const summary = (node.rollingSummary ?? "").trim();
  if (summary.length > 0) {
    lines.push(`    Summary: ${summary.slice(0, 300)}`);
  }
  return lines.join("\n");
};

/**
 * Build a Gemini-friendly prompt from the storyboard snapshot.
 * Linearizes along primary edges; truncates to `input.maxNodes` (default 80).
 */
export const buildCriticPrompt = (input: CriticPromptInput): BuiltPrompt => {
  const maxNodes =
    typeof input.maxNodes === "number" && input.maxNodes > 0
      ? input.maxNodes
      : DEFAULT_MAX_NODES;

  const linearized = linearizeNodes(input.nodes, input.edges);
  const truncated = linearized.length > maxNodes;
  const kept = truncated ? linearized.slice(0, maxNodes) : linearized;

  const header: string[] = [];
  header.push(`STORYBOARD: ${input.storyboardTitle}`);
  const cut = input.cutTierLabel?.trim() || "unset";
  const review =
    typeof input.reviewRound === "number" ? `R${input.reviewRound}` : "—";
  header.push(`Cut tier: ${cut}   Review round: ${review}`);
  header.push(
    `Node count: ${kept.length}${truncated ? " (truncated)" : ""}`,
  );

  const body: string[] = ["", "NODES (primary order):"];
  kept.forEach((node, idx) => {
    body.push(formatNodeLines(node, idx + 1));
  });
  body.push("");
  body.push("(edges omitted — linear order implied above)");

  const userPrompt = [...header, ...body].join("\n");

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    nodeCount: kept.length,
    truncated,
  };
};
