import { describe, expect, it } from "bun:test";
import { deriveShotPrompt } from "@/app/api/storyboard/generate-shots-stream/route";

// deriveShotPrompt centralizes the image-generation prompt assembly so
// every shot in the batch gets a consistent shape, including the M5
// multi-character-composition suffix when blockingNotes is set.

type ShotFixture = Parameters<typeof deriveShotPrompt>[0];

const mkShot = (overrides: Partial<ShotFixture> = {}): ShotFixture =>
  ({
    nodeId: "n1",
    nodeType: "shot",
    label: "Shot 1",
    segment: "",
    ...overrides,
  }) as ShotFixture;

describe("deriveShotPrompt", () => {
  it("prefers imagePrompt over segment", () => {
    const prompt = deriveShotPrompt(
      mkShot({
        segment: "Segment fallback text",
        promptPack: { imagePrompt: "Prompt pack override" },
      }),
    );
    expect(prompt).toBe("Prompt pack override");
  });

  it("falls back to segment when imagePrompt is blank", () => {
    const prompt = deriveShotPrompt(
      mkShot({ segment: "Segment text", promptPack: { imagePrompt: "   " } }),
    );
    expect(prompt).toBe("Segment text");
  });

  it("returns null when nothing usable is present", () => {
    expect(deriveShotPrompt(mkShot({ segment: "" }))).toBeNull();
    expect(deriveShotPrompt(mkShot({ segment: "   " }))).toBeNull();
  });

  it("appends blockingNotes as a COMPOSITION suffix", () => {
    const prompt = deriveShotPrompt(
      mkShot({
        segment: "Wide shot of the warehouse",
        shotMeta: {
          blockingNotes:
            "Maya center-frame kneeling, Daniel entering from left, both facing camera",
        },
      }),
    );
    expect(prompt).toBe(
      "Wide shot of the warehouse\n\nCOMPOSITION: Maya center-frame kneeling, Daniel entering from left, both facing camera",
    );
  });

  it("does not append a COMPOSITION suffix when blockingNotes is blank", () => {
    const prompt = deriveShotPrompt(
      mkShot({
        segment: "Medium shot",
        shotMeta: { blockingNotes: "   " },
      }),
    );
    expect(prompt).toBe("Medium shot");
    expect(prompt?.includes("COMPOSITION")).toBe(false);
  });

  it("trims whitespace on blockingNotes", () => {
    const prompt = deriveShotPrompt(
      mkShot({
        segment: "x",
        shotMeta: { blockingNotes: "  Eyeline match  " },
      }),
    );
    expect(prompt).toBe("x\n\nCOMPOSITION: Eyeline match");
  });

  it("keeps the imagePrompt as the core when both present", () => {
    const prompt = deriveShotPrompt(
      mkShot({
        segment: "Segment fallback",
        promptPack: { imagePrompt: "Pack prompt" },
        shotMeta: { blockingNotes: "Block A then B" },
      }),
    );
    expect(prompt).toBe("Pack prompt\n\nCOMPOSITION: Block A then B");
  });
});
