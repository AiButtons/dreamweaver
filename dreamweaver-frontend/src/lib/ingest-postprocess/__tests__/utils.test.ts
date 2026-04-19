import { describe, expect, it } from "bun:test";
import {
  cheapDnaFromCharacter,
  portraitKey,
  sseFrame,
  stripNulls,
} from "@/lib/ingest-postprocess/utils";

describe("stripNulls", () => {
  it("returns primitives unchanged", () => {
    expect(stripNulls("hello")).toBe("hello");
    expect(stripNulls(42)).toBe(42);
    expect(stripNulls(true)).toBe(true);
  });

  it("collapses top-level null to undefined", () => {
    expect(stripNulls(null)).toBeUndefined();
  });

  it("drops null-valued keys from objects", () => {
    const input: Record<string, unknown> = { a: 1, b: null, c: "x" };
    expect(stripNulls(input)).toEqual({ a: 1, c: "x" });
  });

  it("recurses into nested objects", () => {
    const input: Record<string, unknown> = {
      outer: { inner: null, keep: 2 },
      top: null,
    };
    expect(stripNulls(input)).toEqual({ outer: { keep: 2 } });
  });

  it("maps over arrays", () => {
    const input: unknown[] = [1, null, 3];
    expect(stripNulls(input)).toEqual([1, undefined, 3]);
  });

  it("preserves empty objects", () => {
    expect(stripNulls({ a: {} })).toEqual({ a: {} });
  });
});

describe("cheapDnaFromCharacter", () => {
  it("serializes features into JSON with source identifier", () => {
    const dna = cheapDnaFromCharacter({
      identifier: "ALICE",
      staticFeatures: "long blonde hair",
      dynamicFeatures: "red coat",
      isVisible: true,
      identityPackName: "Alice",
    });
    const parsed = JSON.parse(dna);
    expect(parsed.sourceIdentifier).toBe("ALICE");
    expect(parsed.staticFeatures).toBe("long blonde hair");
    expect(parsed.dynamicFeatures).toBe("red coat");
    expect(parsed.textSummary).toContain("long blonde hair");
    expect(parsed.textSummary).toContain("red coat");
  });

  it("caps textSummary at 500 chars", () => {
    const longText = "x".repeat(2000);
    const dna = cheapDnaFromCharacter({
      identifier: "A",
      staticFeatures: longText,
      dynamicFeatures: "",
      isVisible: true,
      identityPackName: "A",
    });
    const parsed = JSON.parse(dna);
    expect(parsed.textSummary.length).toBeLessThanOrEqual(500);
  });

  it("handles empty features gracefully", () => {
    const dna = cheapDnaFromCharacter({
      identifier: "GHOST",
      staticFeatures: "",
      dynamicFeatures: "",
      isVisible: false,
      identityPackName: "Ghost",
    });
    const parsed = JSON.parse(dna);
    expect(parsed.sourceIdentifier).toBe("GHOST");
    expect(parsed.textSummary).toBe("");
  });
});

describe("portraitKey", () => {
  it("encodes character id + view deterministically", () => {
    expect(portraitKey("KAI", "front")).toBe("KAI::front");
    expect(portraitKey("ALICE", "side")).toBe("ALICE::side");
  });
});

describe("sseFrame", () => {
  it("formats an SSE frame with event + JSON payload", () => {
    expect(sseFrame("stage", { pct: 10 })).toBe(
      `event: stage\ndata: {"pct":10}\n\n`,
    );
  });

  it("handles arrays + nested objects", () => {
    expect(sseFrame("done", { counts: [1, 2] })).toBe(
      `event: done\ndata: {"counts":[1,2]}\n\n`,
    );
  });
});
