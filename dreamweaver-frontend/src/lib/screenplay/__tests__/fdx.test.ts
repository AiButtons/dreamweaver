import { describe, expect, it } from "bun:test";
import { toFdx } from "@/lib/screenplay/fdx";
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

describe("toFdx", () => {
  it("emits the expected root element and Content/TitlePage blocks", () => {
    const input: ScreenplayInput = {
      title: "FDX Demo",
      author: "Writer",
      nodes: [
        node({ nodeId: "s", nodeType: "scene", label: "Bedroom", segment: "Dawn." }),
        node({ nodeId: "a", nodeType: "shot", segment: "He rises." }),
      ],
      edges: [edge({ edgeId: "e", sourceNodeId: "s", targetNodeId: "a" })],
    };
    const out = toFdx(input).content;
    expect(out).toContain('<?xml version="1.0"');
    expect(out).toContain('<FinalDraft DocumentType="Script"');
    expect(out).toContain("<Content>");
    expect(out).toContain("</Content>");
    expect(out).toContain("<TitlePage>");
    expect(out).toContain('<Paragraph Type="Title">');
    expect(out).toContain("<Text>FDX Demo</Text>");
    expect(out).toContain('<Paragraph Type="Author">');
    expect(out).toContain("<Text>Writer</Text>");
  });

  it("escapes XML entities in <Text> bodies", () => {
    const input: ScreenplayInput = {
      title: "X & Y",
      nodes: [
        node({ nodeId: "s", nodeType: "scene", label: "Room" }),
        node({
          nodeId: "a",
          nodeType: "shot",
          segment: 'She says "hello" & waves <at> him.',
        }),
      ],
      edges: [edge({ edgeId: "e", sourceNodeId: "s", targetNodeId: "a" })],
    };
    const out = toFdx(input).content;
    expect(out).toContain("&amp;");
    expect(out).toContain("&lt;at&gt;");
    expect(out).toContain("&quot;hello&quot;");
    expect(out).not.toContain('"hello"');
    // Title must also be escaped.
    expect(out).toContain("<Text>X &amp; Y</Text>");
  });

  it("orders scene heading, general (shot meta), action, transition paragraphs", () => {
    const input: ScreenplayInput = {
      title: "Order",
      nodes: [
        node({ nodeId: "s1", nodeType: "scene", label: "Bedroom" }),
        node({
          nodeId: "a",
          nodeType: "shot",
          segment: "He opens the door.",
          shotMeta: { size: "MS" },
        }),
        node({ nodeId: "br", nodeType: "merge", label: "MERGE" }),
        node({ nodeId: "s2", nodeType: "scene", label: "Street" }),
        node({ nodeId: "b", nodeType: "shot", segment: "He walks away." }),
      ],
      edges: [
        edge({ edgeId: "e1", sourceNodeId: "s1", targetNodeId: "a" }),
        edge({ edgeId: "e2", sourceNodeId: "a", targetNodeId: "br" }),
        edge({ edgeId: "e3", sourceNodeId: "br", targetNodeId: "s2" }),
        edge({ edgeId: "e4", sourceNodeId: "s2", targetNodeId: "b" }),
      ],
    };
    const out = toFdx(input).content;
    const headingIdx = out.indexOf("INT. BEDROOM");
    const generalIdx = out.indexOf('Type="General"');
    const actionIdx = out.indexOf("He opens the door");
    const transitionIdx = out.indexOf('Type="Transition"');
    const nextHeadingIdx = out.indexOf("INT. STREET");
    // All indices must be found.
    expect(headingIdx).toBeGreaterThanOrEqual(0);
    expect(generalIdx).toBeGreaterThanOrEqual(0);
    expect(actionIdx).toBeGreaterThanOrEqual(0);
    expect(transitionIdx).toBeGreaterThanOrEqual(0);
    expect(nextHeadingIdx).toBeGreaterThanOrEqual(0);
    // Scene heading < General < Action < Transition < next Scene heading.
    expect(headingIdx).toBeLessThan(generalIdx);
    expect(generalIdx).toBeLessThan(actionIdx);
    expect(actionIdx).toBeLessThan(transitionIdx);
    expect(transitionIdx).toBeLessThan(nextHeadingIdx);
    expect(out).toContain("<Text>CUT TO:</Text>");
  });

  it("emits a General paragraph on the title page with cutTier and reviewRound", () => {
    const input: ScreenplayInput = {
      title: "FDX Tier",
      author: "Writer",
      cutTier: "Director's Cut",
      reviewRound: 2,
      nodes: [],
      edges: [],
    };
    const out = toFdx(input).content;
    expect(out).toContain("<TitlePage>");
    // Title page emits a General paragraph containing the tier + round, with
    // the apostrophe XML-escaped.
    expect(out).toContain('<Paragraph Type="General">');
    expect(out).toContain("<Text>Director&apos;s Cut (R2)</Text>");
    // The tier+round line must live inside the TitlePage block, not Content.
    const titleStart = out.indexOf("<TitlePage>");
    const titleEnd = out.indexOf("</TitlePage>");
    expect(titleStart).toBeGreaterThan(-1);
    expect(titleEnd).toBeGreaterThan(titleStart);
    const titleBlock = out.slice(titleStart, titleEnd);
    expect(titleBlock).toContain("Director&apos;s Cut (R2)");
  });

  it("emits the title page when only cutTier is provided", () => {
    const input: ScreenplayInput = {
      title: "",
      cutTier: "Picture Lock",
      nodes: [],
      edges: [],
    };
    const out = toFdx(input).content;
    expect(out).toContain("<TitlePage>");
    expect(out).toContain("<Text>Picture Lock</Text>");
  });

  it("emits valid root + content when title and author are both absent", () => {
    const input: ScreenplayInput = {
      title: "",
      nodes: [node({ nodeId: "a", nodeType: "shot", segment: "Alone." })],
      edges: [],
    };
    const out = toFdx(input).content;
    expect(out).toContain("<FinalDraft");
    expect(out).toContain("<Content>");
    expect(out).toContain("</FinalDraft>");
    expect(out).not.toContain("<TitlePage>");
  });
});
