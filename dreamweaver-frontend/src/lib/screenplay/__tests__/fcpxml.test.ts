import { describe, expect, it } from "bun:test";
import { toFcpXml } from "@/lib/screenplay/fcpxml";
import type { ScreenplayInput } from "@/lib/screenplay/types";

const baseInput = (overrides?: Partial<ScreenplayInput>): ScreenplayInput => ({
  title: "Test",
  nodes: [
    {
      nodeId: "shot_1",
      nodeType: "shot",
      label: "One",
      segment: "",
      position: { x: 0, y: 0 },
      shotMeta: { number: "1A", durationS: 2 },
    },
    {
      nodeId: "shot_2",
      nodeType: "shot",
      label: "Two",
      segment: "",
      position: { x: 100, y: 0 },
      shotMeta: { number: "1B", durationS: 4 },
    },
  ],
  edges: [
    { edgeId: "e1", sourceNodeId: "shot_1", targetNodeId: "shot_2", edgeType: "serial", isPrimary: true },
  ],
  ...overrides,
});

describe("toFcpXml", () => {
  it("produces valid xmeml 5 envelope", () => {
    const doc = toFcpXml(baseInput());
    expect(doc.mimeType).toBe("application/xml");
    expect(doc.fileExtension).toBe("xml");
    expect(doc.content.startsWith('<?xml version="1.0"')).toBe(true);
    expect(doc.content).toContain('<xmeml version="5">');
    expect(doc.content).toContain("</xmeml>");
    expect(doc.content).toContain("<sequence>");
    expect(doc.content).toContain("</sequence>");
  });

  it("renders both clipitems in a single track", () => {
    const doc = toFcpXml(baseInput());
    expect(doc.content).toContain('<clipitem id="clipitem-1">');
    expect(doc.content).toContain('<clipitem id="clipitem-2">');
    expect(doc.content.match(/<track>/g)?.length).toBe(1);
    expect(doc.content.match(/<\/track>/g)?.length).toBe(1);
  });

  it("accumulates start/end frames at 24fps", () => {
    const doc = toFcpXml(baseInput());
    // Shot 1: 2s × 24 = 48 frames → start 0, end 48
    // Shot 2: 4s × 24 = 96 frames → start 48, end 144
    expect(doc.content).toContain("<start>0</start>");
    expect(doc.content).toContain("<end>48</end>");
    expect(doc.content).toContain("<start>48</start>");
    expect(doc.content).toContain("<end>144</end>");
  });

  it("escapes XML entities in title and clip names", () => {
    const doc = toFcpXml(baseInput({ title: "Rock & Roll", nodes: [
      {
        nodeId: "shot_1",
        nodeType: "shot",
        label: `A "tricky" <one>`,
        segment: "",
        position: { x: 0, y: 0 },
        shotMeta: { durationS: 1 },
      },
    ], edges: [] }));
    expect(doc.content).toContain("Rock &amp; Roll");
    // quotes in label survive through to clip name (slug strips them); no raw "<one>"
    expect(doc.content).not.toContain("<one>");
  });

  it("sets ntsc flag correctly by frame rate", () => {
    const input24 = baseInput({ frameRate: 24 });
    const input2997 = baseInput({ frameRate: 29.97 });
    const input23976 = baseInput({ frameRate: 23.976 });
    expect(toFcpXml(input24).content).toContain("<ntsc>FALSE</ntsc>");
    expect(toFcpXml(input2997).content).toContain("<ntsc>TRUE</ntsc>");
    expect(toFcpXml(input23976).content).toContain("<ntsc>TRUE</ntsc>");
  });

  it("emits empty track when no shots exist", () => {
    const doc = toFcpXml({ title: "Empty", nodes: [], edges: [] });
    expect(doc.content).toContain('<xmeml version="5">');
    expect(doc.content).toContain("<track>");
    expect(doc.content).toContain("</track>");
    expect(doc.content).not.toContain("<clipitem");
    expect(doc.content).toContain("<duration>0</duration>");
  });

  it("renders sequence timecode with sequenceStart frames", () => {
    const doc = toFcpXml(baseInput({ sequenceStart: "01:00:00:00" }));
    expect(doc.content).toContain("<string>01:00:00:00</string>");
    // 01:00:00:00 at 24fps → 86400 frames
    expect(doc.content).toContain("<frame>86400</frame>");
  });
});
