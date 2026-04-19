import { describe, expect, it } from "bun:test";
import {
  buildCriticPrompt,
  CRITIC_RESPONSE_SCHEMA,
} from "@/lib/continuity-critic/prompt";
import type {
  CriticPromptEdge,
  CriticPromptInput,
  CriticPromptNode,
} from "@/lib/continuity-critic/types";

const node = (
  id: string,
  overrides: Partial<CriticPromptNode> = {},
): CriticPromptNode => ({
  nodeId: id,
  nodeType: "shot",
  label: `Shot ${id}`,
  segment: `Segment for ${id}`,
  ...overrides,
});

const linearEdges = (ids: string[]): CriticPromptEdge[] =>
  ids.slice(0, -1).map((src, i) => ({
    sourceNodeId: src,
    targetNodeId: ids[i + 1],
    isPrimary: true,
    order: i,
  }));

describe("buildCriticPrompt", () => {
  it("builds a prompt from a 3-node linear graph", () => {
    const input: CriticPromptInput = {
      storyboardTitle: "Test Story",
      cutTierLabel: "Rough Cut",
      reviewRound: 2,
      nodes: [
        node("a", {
          characterIds: ["hero"],
          wardrobeVariantIds: ["w1"],
          shotMetaSlug: "CU eye_level 35mm",
          rollingSummary: "Hero enters.",
        }),
        node("b", { characterIds: ["hero", "villain"] }),
        node("c", {}),
      ],
      edges: linearEdges(["a", "b", "c"]),
    };
    const built = buildCriticPrompt(input);
    expect(built.nodeCount).toBe(3);
    expect(built.truncated).toBe(false);
    expect(built.systemPrompt).toContain("script supervisor");
    expect(built.systemPrompt).toContain("CRITIC_WARDROBE");
    expect(built.userPrompt).toContain("STORYBOARD: Test Story");
    expect(built.userPrompt).toContain("Cut tier: Rough Cut");
    expect(built.userPrompt).toContain("Review round: R2");
    expect(built.userPrompt).toContain("Node count: 3");
    expect(built.userPrompt).toContain('[1] a (shot) "Shot a"');
    expect(built.userPrompt).toContain("Characters: hero");
    expect(built.userPrompt).toContain("Wardrobe: w1");
    expect(built.userPrompt).toContain("Shot: CU eye_level 35mm");
    expect(built.userPrompt).toContain("Summary: Hero enters.");
    // Nodes appear in traversal order a -> b -> c.
    const idxA = built.userPrompt.indexOf("[1] a");
    const idxB = built.userPrompt.indexOf("[2] b");
    const idxC = built.userPrompt.indexOf("[3] c");
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
  });

  it("truncates at maxNodes and sets the truncated flag", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `n${i}`);
    const input: CriticPromptInput = {
      storyboardTitle: "Long Story",
      nodes: ids.map((id) => node(id)),
      edges: linearEdges(ids),
      maxNodes: 3,
    };
    const built = buildCriticPrompt(input);
    expect(built.nodeCount).toBe(3);
    expect(built.truncated).toBe(true);
    expect(built.userPrompt).toContain("Node count: 3 (truncated)");
    expect(built.userPrompt).toContain("[3] n2");
    expect(built.userPrompt).not.toContain("[4] n3");
  });

  it("handles missing optional fields gracefully", () => {
    const input: CriticPromptInput = {
      storyboardTitle: "Minimal",
      nodes: [node("a", { segment: "" })],
      edges: [],
    };
    const built = buildCriticPrompt(input);
    expect(built.nodeCount).toBe(1);
    expect(built.truncated).toBe(false);
    expect(built.userPrompt).toContain("Cut tier: unset");
    expect(built.userPrompt).toContain("Review round: —");
    expect(built.userPrompt).toContain("Characters: none");
    expect(built.userPrompt).toContain("Wardrobe: none");
    expect(built.userPrompt).not.toContain("Shot:");
    expect(built.userPrompt).not.toContain("Summary:");
    expect(built.userPrompt).not.toContain("Segment:"); // segment was empty
  });

  it("skips non-scene/shot node types", () => {
    const input: CriticPromptInput = {
      storyboardTitle: "Mixed",
      nodes: [
        node("s1", { nodeType: "scene" }),
        node("sh1", { nodeType: "shot" }),
        node("b1", { nodeType: "branch" }),
        node("cr1", { nodeType: "character_ref" }),
      ],
      edges: linearEdges(["s1", "sh1", "b1", "cr1"]),
    };
    const built = buildCriticPrompt(input);
    expect(built.nodeCount).toBe(2);
    expect(built.userPrompt).toContain("s1");
    expect(built.userPrompt).toContain("sh1");
    expect(built.userPrompt).not.toContain("[3] b1");
    expect(built.userPrompt).not.toContain("cr1 (character_ref)");
  });

  it("exposes a Gemini-native response schema constant", () => {
    expect(CRITIC_RESPONSE_SCHEMA.type).toBe("OBJECT");
    expect(CRITIC_RESPONSE_SCHEMA.required).toContain("violations");
    const violationsProp =
      CRITIC_RESPONSE_SCHEMA.properties.violations.items.properties;
    expect(violationsProp.code.enum).toContain("CRITIC_WARDROBE");
    expect(violationsProp.severity.enum).toContain("critical");
  });
});
