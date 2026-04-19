import { describe, expect, it } from "bun:test";
import {
  deriveVideoPrompt,
  resolveActiveImageUrl,
} from "@/app/api/storyboard/generate-shot-videos-stream/route";

// The route is SSE + fetch-heavy and not a good fit for direct
// integration testing, but the two pure helpers carry the business
// logic that decides whether a shot is rendered, skipped, or fails —
// worth covering in isolation.

describe("deriveVideoPrompt", () => {
  it("prefers videoPrompt when present", () => {
    const result = deriveVideoPrompt({
      promptPack: {
        videoPrompt: "Camera dollies in slowly",
        imagePrompt: "A static wide shot",
      },
      segment: "unused",
    });
    expect(result).toBe("Camera dollies in slowly");
  });

  it("falls back to imagePrompt when videoPrompt is empty", () => {
    const result = deriveVideoPrompt({
      promptPack: { videoPrompt: "   ", imagePrompt: "A static wide shot" },
      segment: "unused",
    });
    expect(result).toBe("A static wide shot");
  });

  it("falls back to segment when neither prompt is present", () => {
    const result = deriveVideoPrompt({
      promptPack: {},
      segment: "Shot segment text",
    });
    expect(result).toBe("Shot segment text");
  });

  it("returns null when no usable text exists", () => {
    expect(deriveVideoPrompt({ promptPack: {}, segment: "" })).toBeNull();
    expect(
      deriveVideoPrompt({ promptPack: {}, segment: "   " }),
    ).toBeNull();
  });

  it("trims whitespace from videoPrompt", () => {
    const result = deriveVideoPrompt({
      promptPack: { videoPrompt: "  pans left  " },
      segment: "",
    });
    expect(result).toBe("pans left");
  });
});

describe("resolveActiveImageUrl", () => {
  const variants = [
    { mediaAssetId: "m1", url: "https://x/a.png", modelId: "z", createdAt: 1 },
    { mediaAssetId: "m2", url: "https://x/b.png", modelId: "z", createdAt: 2 },
  ];

  it("returns the URL of the active image", () => {
    expect(
      resolveActiveImageUrl({
        media: { images: variants, activeImageId: "m2" },
      }),
    ).toBe("https://x/b.png");
  });

  it("returns null when activeImageId is not set", () => {
    expect(
      resolveActiveImageUrl({ media: { images: variants } }),
    ).toBeNull();
  });

  it("returns null when activeImageId doesn't match any variant", () => {
    expect(
      resolveActiveImageUrl({
        media: { images: variants, activeImageId: "m99" },
      }),
    ).toBeNull();
  });

  it("returns null when the images array is missing", () => {
    expect(
      resolveActiveImageUrl({ media: { activeImageId: "m1" } }),
    ).toBeNull();
  });

  it("returns null when media itself is missing", () => {
    expect(resolveActiveImageUrl({})).toBeNull();
  });
});
