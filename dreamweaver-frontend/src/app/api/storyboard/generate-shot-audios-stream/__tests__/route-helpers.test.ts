import { describe, expect, it } from "bun:test";
import { deriveShotNarrationText } from "@/app/api/storyboard/generate-shot-audios-stream/route";

describe("deriveShotNarrationText", () => {
  it("prefers explicit promptPack.audioDesc", () => {
    const text = deriveShotNarrationText({
      promptPack: { audioDesc: "Narrator murmurs about the harbor." },
      segment: "Long visual description goes here.",
    });
    expect(text).toBe("Narrator murmurs about the harbor.");
  });

  it("falls back to first two sentences of segment", () => {
    const text = deriveShotNarrationText({
      promptPack: {},
      segment:
        "Maya kneels by the crate. She pries the lid open. The vial inside glows faintly blue. She reaches in, slow and careful.",
    });
    expect(text).toBe(
      "Maya kneels by the crate. She pries the lid open.",
    );
  });

  it("falls back to full segment when there's no sentence punctuation", () => {
    const text = deriveShotNarrationText({
      promptPack: {},
      segment: "a wide shot of the warehouse interior lit by a single bulb",
    });
    expect(text).toBe(
      "a wide shot of the warehouse interior lit by a single bulb",
    );
  });

  it("falls back to imagePrompt when segment is empty", () => {
    const text = deriveShotNarrationText({
      promptPack: { imagePrompt: "Dramatic wide shot, cinematic lighting." },
      segment: "",
    });
    expect(text).toBe("Dramatic wide shot, cinematic lighting.");
  });

  it("returns null when nothing usable is present", () => {
    expect(deriveShotNarrationText({ promptPack: {}, segment: "" })).toBeNull();
    expect(
      deriveShotNarrationText({ promptPack: {}, segment: "   " }),
    ).toBeNull();
  });

  it("caps output at 500 chars so narration stays tight", () => {
    const long = "Alice walks. ".repeat(80); // ~1040 chars, 80 sentences
    const text = deriveShotNarrationText({ promptPack: {}, segment: long });
    expect(text).not.toBeNull();
    expect((text ?? "").length).toBeLessThanOrEqual(500);
  });

  it("strips leading/trailing whitespace from explicit audioDesc", () => {
    const text = deriveShotNarrationText({
      promptPack: { audioDesc: "   hushed footsteps on gravel   " },
      segment: "",
    });
    expect(text).toBe("hushed footsteps on gravel");
  });
});
