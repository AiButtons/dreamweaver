import { describe, expect, it } from "bun:test";
import { toFountain } from "@/lib/screenplay/fountain";
import type {
  ScreenplayEdgeInput,
  ScreenplayInput,
  ScreenplayNodeInput,
} from "@/lib/screenplay/types";

const node = (overrides: Partial<ScreenplayNodeInput> & { nodeId: string; nodeType: ScreenplayNodeInput["nodeType"] }): ScreenplayNodeInput => ({
  label: overrides.label ?? "",
  segment: overrides.segment ?? "",
  position: overrides.position ?? { x: 0, y: 0 },
  shotMeta: overrides.shotMeta,
  entityRefs: overrides.entityRefs,
  ...overrides,
});

const edge = (overrides: Partial<ScreenplayEdgeInput> & { edgeId: string; sourceNodeId: string; targetNodeId: string }): ScreenplayEdgeInput => ({
  edgeType: "serial",
  isPrimary: true,
  ...overrides,
});

describe("toFountain", () => {
  it("handles an empty graph without crashing", () => {
    const doc = toFountain({ title: "Empty", nodes: [], edges: [] });
    expect(doc.fileExtension).toBe("fountain");
    expect(doc.mimeType).toBe("text/plain");
    expect(doc.content).toContain("Title: Empty");
  });

  it("emits a scene heading and shot boneyard comments in order", () => {
    const input: ScreenplayInput = {
      title: "Demo",
      nodes: [
        node({
          nodeId: "s1",
          nodeType: "scene",
          label: "Bedroom",
          segment: "A quiet room at dawn.",
          position: { x: 0, y: 0 },
        }),
        node({
          nodeId: "a",
          nodeType: "shot",
          segment: "A man sits on the edge of the bed.",
          position: { x: 1, y: 0 },
          shotMeta: {
            size: "MS",
            angle: "low",
            lensMm: 35,
            tStop: "T2.8",
            move: "push_in",
            aspect: "9:16",
            durationS: 4.5,
            blockingNotes: "Enter frame left",
            props: ["book", "lamp"],
            sfx: ["clock ticking"],
            vfx: ["subtle dust motes"],
          },
        }),
        node({
          nodeId: "b",
          nodeType: "shot",
          segment: "He stands and walks off.",
          position: { x: 2, y: 0 },
          shotMeta: { size: "WS", durationS: 3 },
        }),
      ],
      edges: [
        edge({ edgeId: "e1", sourceNodeId: "s1", targetNodeId: "a" }),
        edge({ edgeId: "e2", sourceNodeId: "a", targetNodeId: "b" }),
      ],
    };
    const doc = toFountain(input);
    const out = doc.content;
    expect(out).toContain("INT. BEDROOM - DAY");
    expect(out).toContain("A quiet room at dawn.");
    expect(out).toContain("/* Shot 1A — MS, low, 35mm T2.8, push_in, 9:16, 4.5s */");
    expect(out).toContain("/* Blocking: Enter frame left */");
    expect(out).toContain("/* Props: book, lamp */");
    expect(out).toContain("/* SFX: clock ticking */");
    expect(out).toContain("/* VFX: subtle dust motes */");
    expect(out).toContain("A man sits on the edge of the bed.");
    expect(out).toContain("/* Shot 1B — WS, 3s */");
    // Shot 1A must appear before Shot 1B.
    expect(out.indexOf("/* Shot 1A")).toBeLessThan(out.indexOf("/* Shot 1B"));
  });

  it("passes through an INT./EXT. label uppercased instead of wrapping it", () => {
    const input: ScreenplayInput = {
      title: "Pass Through",
      nodes: [
        node({ nodeId: "s", nodeType: "scene", label: "EXT. ROOFTOP - NIGHT" }),
        node({ nodeId: "a", nodeType: "shot", segment: "Wind howls." }),
      ],
      edges: [edge({ edgeId: "e", sourceNodeId: "s", targetNodeId: "a" })],
    };
    const out = toFountain(input).content;
    expect(out).toContain("EXT. ROOFTOP - NIGHT");
    expect(out).not.toContain("INT. EXT. ROOFTOP - NIGHT - DAY");
    expect(out).not.toContain("INT. EXT.");
  });

  it("skips the title page when author and draftDate are both absent", () => {
    const input: ScreenplayInput = {
      title: "No Meta",
      nodes: [node({ nodeId: "s", nodeType: "scene", label: "Bedroom" })],
      edges: [],
    };
    const out = toFountain(input).content;
    expect(out).not.toContain("====");
    expect(out).not.toContain("Author:");
    expect(out).not.toContain("Draft date:");
  });

  it("emits the title page when author is supplied", () => {
    const input: ScreenplayInput = {
      title: "With Author",
      author: "J. Q. Writer",
      nodes: [],
      edges: [],
    };
    const out = toFountain(input).content;
    expect(out).toContain("Title: With Author");
    expect(out).toContain("Author: J. Q. Writer");
    expect(out).toContain("====");
  });

  it("emits a Notes line on the title page when cutTier and reviewRound are set", () => {
    const input: ScreenplayInput = {
      title: "My Story",
      author: "Harshit",
      draftDate: "2026-04-18",
      cutTier: "Director's Cut",
      reviewRound: 2,
      nodes: [],
      edges: [],
    };
    const out = toFountain(input).content;
    expect(out).toContain("Title: My Story");
    expect(out).toContain("Notes: Director's Cut (R2)");
    expect(out).toContain("====");
  });

  it("emits the title page with just Notes when only cutTier is set", () => {
    const input: ScreenplayInput = {
      title: "Tier Only",
      cutTier: "Picture Lock",
      nodes: [],
      edges: [],
    };
    const out = toFountain(input).content;
    expect(out).toContain("Notes: Picture Lock");
    expect(out).toContain("====");
  });

  it("emits the title page with just Notes R# when only reviewRound is set", () => {
    const input: ScreenplayInput = {
      title: "Round Only",
      reviewRound: 3,
      nodes: [],
      edges: [],
    };
    const out = toFountain(input).content;
    expect(out).toContain("Notes: R3");
    expect(out).toContain("====");
  });

  it("escapes /* in user segment text so it does not open a boneyard", () => {
    const input: ScreenplayInput = {
      title: "Escape",
      nodes: [
        node({ nodeId: "s", nodeType: "scene", label: "Room" }),
        node({
          nodeId: "a",
          nodeType: "shot",
          segment: "She whispers /* a secret */ to no one.",
        }),
      ],
      edges: [edge({ edgeId: "e", sourceNodeId: "s", targetNodeId: "a" })],
    };
    const out = toFountain(input).content;
    expect(out).not.toContain("whispers /* a secret");
    expect(out).toContain("whispers / * a secret");
  });
});
