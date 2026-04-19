import { describe, expect, it } from "bun:test";
import {
  buildReelManifest,
  parseShotNumber,
  resolveActiveMediaUrl,
} from "@/app/api/storyboard/reel-manifest/route";

describe("parseShotNumber", () => {
  it("parses plain integer shot numbers", () => {
    expect(parseShotNumber("5")).toEqual([0, 5]);
    expect(parseShotNumber("1")).toEqual([0, 1]);
  });

  it("parses decimal shot numbers (1.1, 2.5)", () => {
    expect(parseShotNumber("2.5")).toEqual([0, 2.5]);
  });

  it("parses Ep<N>-<M> episode+shot shape", () => {
    expect(parseShotNumber("Ep2-5")).toEqual([2, 5]);
    expect(parseShotNumber("Ep10-3")).toEqual([10, 3]);
    expect(parseShotNumber("ep1-2.5")).toEqual([1, 2.5]);
  });

  it("returns [Infinity, Infinity] for unknown shapes", () => {
    const res = parseShotNumber("weird-string");
    expect(res[0]).toBe(Number.POSITIVE_INFINITY);
    expect(res[1]).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns [Infinity, Infinity] for undefined", () => {
    const res = parseShotNumber(undefined);
    expect(res[0]).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("resolveActiveMediaUrl", () => {
  const variants = [
    { mediaAssetId: "v1", url: "https://x/a.mp4", modelId: "ltx", createdAt: 1 },
    { mediaAssetId: "v2", url: "https://x/b.mp4", modelId: "ltx", createdAt: 2 },
  ];

  it("resolves the active id to its URL", () => {
    expect(resolveActiveMediaUrl(variants, "v2")).toBe("https://x/b.mp4");
  });

  it("returns null for unset id", () => {
    expect(resolveActiveMediaUrl(variants, undefined)).toBeNull();
  });

  it("returns null when no variants array", () => {
    expect(resolveActiveMediaUrl(undefined, "v1")).toBeNull();
  });

  it("returns null when id doesn't match", () => {
    expect(resolveActiveMediaUrl(variants, "v99")).toBeNull();
  });
});

describe("buildReelManifest", () => {
  const mkShot = (
    nodeId: string,
    number: string | undefined,
    extras: {
      durationS?: number;
      activeImageId?: string;
      activeVideoId?: string;
      activeAudioId?: string;
    } = {},
  ) => ({
    nodeId,
    nodeType: "shot" as const,
    label: `Label ${nodeId}`,
    segment: `Segment ${nodeId}`,
    shotMeta: number ? { number, durationS: extras.durationS } : undefined,
    promptPack: { imagePrompt: `Prompt for ${nodeId}` },
    media: {
      images: extras.activeImageId
        ? [
            {
              mediaAssetId: extras.activeImageId,
              url: `https://x/${extras.activeImageId}.png`,
              modelId: "z",
              createdAt: 1,
            },
          ]
        : [],
      videos: extras.activeVideoId
        ? [
            {
              mediaAssetId: extras.activeVideoId,
              url: `https://x/${extras.activeVideoId}.mp4`,
              modelId: "l",
              createdAt: 1,
            },
          ]
        : [],
      audios: extras.activeAudioId
        ? [
            {
              mediaAssetId: extras.activeAudioId,
              url: `https://x/${extras.activeAudioId}.mp3`,
              modelId: "tts-1",
              createdAt: 1,
            },
          ]
        : [],
      activeImageId: extras.activeImageId,
      activeVideoId: extras.activeVideoId,
      activeAudioId: extras.activeAudioId,
    },
  });

  it("orders shots by parsed shot number, not snapshot order", () => {
    const shots = [
      mkShot("a", "3"),
      mkShot("b", "1"),
      mkShot("c", "2"),
    ];
    const manifest = buildReelManifest("sb", "Title", shots);
    expect(manifest.shots.map((s) => s.nodeId)).toEqual(["b", "c", "a"]);
  });

  it("interleaves episodes correctly (Ep1 before Ep2)", () => {
    const shots = [
      mkShot("a", "Ep2-1"),
      mkShot("b", "Ep1-3"),
      mkShot("c", "Ep1-1"),
      mkShot("d", "Ep2-2"),
    ];
    const manifest = buildReelManifest("sb", "Title", shots);
    expect(manifest.shots.map((s) => s.nodeId)).toEqual([
      "c",
      "b",
      "a",
      "d",
    ]);
  });

  it("falls back to snapshot order when numbers are missing", () => {
    const shots = [
      mkShot("a", undefined),
      mkShot("b", undefined),
      mkShot("c", undefined),
    ];
    const manifest = buildReelManifest("sb", "Title", shots);
    expect(manifest.shots.map((s) => s.nodeId)).toEqual(["a", "b", "c"]);
  });

  it("clamps duration to [1, 30] seconds", () => {
    const shots = [
      mkShot("long", "1", { durationS: 999 }),
      mkShot("tiny", "2", { durationS: 0 }),
      mkShot("ok", "3", { durationS: 8 }),
    ];
    const manifest = buildReelManifest("sb", "Title", shots);
    expect(manifest.shots[0].durationS).toBe(30);
    expect(manifest.shots[1].durationS).toBe(1);
    expect(manifest.shots[2].durationS).toBe(8);
  });

  it("defaults missing duration to 5 seconds", () => {
    const shots = [mkShot("a", "1")];
    const manifest = buildReelManifest("sb", "Title", shots);
    expect(manifest.shots[0].durationS).toBe(5);
  });

  it("resolves active video / image / audio URLs correctly", () => {
    const shots = [
      mkShot("a", "1", {
        activeVideoId: "v1",
        activeImageId: "i1",
        activeAudioId: "a1",
      }),
      mkShot("b", "2", { activeImageId: "i2" }), // no video/audio
      mkShot("c", "3"), // no media at all
    ];
    const manifest = buildReelManifest("sb", "Title", shots);
    expect(manifest.shots[0].videoUrl).toBe("https://x/v1.mp4");
    expect(manifest.shots[0].imageUrl).toBe("https://x/i1.png");
    expect(manifest.shots[0].audioUrl).toBe("https://x/a1.mp3");
    expect(manifest.shots[1].videoUrl).toBeNull();
    expect(manifest.shots[1].imageUrl).toBe("https://x/i2.png");
    expect(manifest.shots[1].audioUrl).toBeNull();
    expect(manifest.shots[2].videoUrl).toBeNull();
    expect(manifest.shots[2].imageUrl).toBeNull();
  });

  it("sums total duration", () => {
    const shots = [
      mkShot("a", "1", { durationS: 4 }),
      mkShot("b", "2", { durationS: 6 }),
      mkShot("c", "3", { durationS: 10 }),
    ];
    const manifest = buildReelManifest("sb", "Title", shots);
    expect(manifest.totalDurationS).toBe(20);
  });

  it("assigns 0-based indices after sort", () => {
    const shots = [mkShot("a", "9"), mkShot("b", "1")];
    const manifest = buildReelManifest("sb", "Title", shots);
    expect(manifest.shots.map((s) => s.index)).toEqual([0, 1]);
  });
});
