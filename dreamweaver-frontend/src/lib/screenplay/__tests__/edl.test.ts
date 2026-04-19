import { describe, expect, it } from "bun:test";
import { toEdl } from "@/lib/screenplay/edl";
import type { ScreenplayInput } from "@/lib/screenplay/types";

const makeInput = (overrides?: Partial<ScreenplayInput>): ScreenplayInput => ({
  title: "Test Project",
  nodes: [
    {
      nodeId: "scene_1",
      nodeType: "scene",
      label: "The Gym",
      segment: "",
      position: { x: 0, y: 0 },
    },
    {
      nodeId: "shot_1",
      nodeType: "shot",
      label: "Kai Opens the Door",
      segment: "",
      position: { x: 100, y: 0 },
      shotMeta: { number: "1A", durationS: 2, size: "MS", angle: "eye_level", move: "push_in" },
    },
    {
      nodeId: "shot_2",
      nodeType: "shot",
      label: "Elena Reacts",
      segment: "",
      position: { x: 200, y: 0 },
      shotMeta: { number: "1B", durationS: 4, size: "CU", angle: "low" },
    },
    {
      nodeId: "shot_3",
      nodeType: "shot",
      label: "Reveal",
      segment: "",
      position: { x: 300, y: 0 },
      shotMeta: { durationS: 3 },
    },
  ],
  edges: [
    { edgeId: "e1", sourceNodeId: "scene_1", targetNodeId: "shot_1", edgeType: "serial", isPrimary: true },
    { edgeId: "e2", sourceNodeId: "shot_1", targetNodeId: "shot_2", edgeType: "serial", isPrimary: true },
    { edgeId: "e3", sourceNodeId: "shot_2", targetNodeId: "shot_3", edgeType: "serial", isPrimary: true },
  ],
  ...overrides,
});

describe("toEdl", () => {
  it("emits header with title and FCM line", () => {
    const doc = toEdl(makeInput());
    expect(doc.mimeType).toBe("text/plain");
    expect(doc.fileExtension).toBe("edl");
    expect(doc.content).toContain("TITLE: Test Project");
    expect(doc.content).toContain("FCM: NON-DROP FRAME");
  });

  it("accumulates record timecode across shots at 24fps", () => {
    const doc = toEdl(makeInput());
    // Shot 1: durationS=2 → ends at 01:00:02:00
    // Shot 2: durationS=4 → ends at 01:00:06:00
    // Shot 3: durationS=3 → ends at 01:00:09:00
    expect(doc.content).toContain("01:00:00:00 01:00:02:00");
    expect(doc.content).toContain("01:00:02:00 01:00:06:00");
    expect(doc.content).toContain("01:00:06:00 01:00:09:00");
  });

  it("derives reel name from shotMeta.number, padded to 8 chars", () => {
    const doc = toEdl(makeInput());
    // "1A" → "1A      " (6 trailing spaces) → appears as "1A      "
    expect(doc.content).toMatch(/001 {2}1A {6} {2}V {5}C/);
    expect(doc.content).toMatch(/002 {2}1B {6} {2}V {5}C/);
  });

  it("falls back to AX reel when shotMeta.number absent", () => {
    const doc = toEdl(makeInput());
    // Shot 3 has no number; auto becomes "1C" from sceneIndex+letters.
    expect(doc.content).toMatch(/003 {2}1C {6} {2}V {5}C/);
  });

  it("slugifies clip name under 32 chars and lowercase with underscores", () => {
    const doc = toEdl(makeInput());
    expect(doc.content).toContain("* FROM CLIP NAME: 1a_kai_opens_the_door");
    expect(doc.content).toContain("* FROM CLIP NAME: 1b_elena_reacts");
  });

  it("emits shot meta slug as a COMMENT line", () => {
    const doc = toEdl(makeInput());
    // formatShotMetaSlug: "MS, eye level, push_in, 2s"
    expect(doc.content).toMatch(/\* COMMENT: MS, eye level,.*push_in.*2s/);
  });

  it("surfaces cutTier + reviewRound as a first-edit comment", () => {
    const doc = toEdl(makeInput({ cutTier: "Director's Cut", reviewRound: 2 }));
    expect(doc.content).toContain("* COMMENT: Cut: Director's Cut (R2)");
  });

  it("produces a header-only document when there are no shots", () => {
    const doc = toEdl({
      title: "Empty",
      nodes: [],
      edges: [],
      cutTier: "Assembly",
    });
    expect(doc.content).toContain("TITLE: Empty");
    expect(doc.content).toContain("FCM: NON-DROP FRAME");
    expect(doc.content).toContain("* COMMENT: Cut: Assembly");
    expect(doc.content).not.toMatch(/^\d{3} /m); // no numbered edit lines
  });

  it("respects custom sequenceStart", () => {
    const doc = toEdl(makeInput({ sequenceStart: "10:00:00:00" }));
    expect(doc.content).toContain("10:00:00:00 10:00:02:00");
  });

  it("uses defaultShotDurationS when shotMeta.durationS absent", () => {
    const doc = toEdl({
      title: "Defaults",
      defaultShotDurationS: 5,
      nodes: [
        {
          nodeId: "shot_a",
          nodeType: "shot",
          label: "A",
          segment: "",
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    });
    // 5 seconds at 24fps → 120 frames → ends at 01:00:05:00
    expect(doc.content).toContain("01:00:00:00 01:00:05:00");
  });
});
