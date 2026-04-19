import { describe, expect, it } from "bun:test";
import {
  collectShotReferenceUrls,
  selectPortraitForShot,
  type AvailablePortrait,
} from "@/lib/shot-batch/selector";
import type { ShotMeta } from "@/app/storyboard/types";

const mk = (view: AvailablePortrait["view"], url = `https://x.test/${view}.png`): AvailablePortrait => ({
  view,
  sourceUrl: url,
});

describe("selectPortraitForShot", () => {
  it("returns null when no portraits available", () => {
    expect(selectPortraitForShot(undefined, [])).toBeNull();
  });

  it("filters out portraits with empty sourceUrl", () => {
    expect(selectPortraitForShot(undefined, [{ view: "front", sourceUrl: "" }])).toBeNull();
  });

  it("prefers front when no direction hint", () => {
    const portraits = [mk("side"), mk("front"), mk("back")];
    const picked = selectPortraitForShot(undefined, portraits);
    expect(picked?.view).toBe("front");
  });

  it("prefers side when screenDirection=right_to_left", () => {
    const shotMeta: ShotMeta = { screenDirection: "right_to_left" };
    const portraits = [mk("front"), mk("side"), mk("back")];
    const picked = selectPortraitForShot(shotMeta, portraits);
    expect(picked?.view).toBe("side");
  });

  it("still prefers front when screenDirection=left_to_right", () => {
    const shotMeta: ShotMeta = { screenDirection: "left_to_right" };
    const portraits = [mk("front"), mk("side"), mk("back")];
    const picked = selectPortraitForShot(shotMeta, portraits);
    expect(picked?.view).toBe("front");
  });

  it("falls back to three_quarter then side then back when front missing", () => {
    const shotMeta: ShotMeta = { screenDirection: "neutral" };
    expect(
      selectPortraitForShot(shotMeta, [mk("side"), mk("back"), mk("three_quarter")])?.view,
    ).toBe("three_quarter");
    expect(selectPortraitForShot(shotMeta, [mk("side"), mk("back")])?.view).toBe("side");
    expect(selectPortraitForShot(shotMeta, [mk("back")])?.view).toBe("back");
  });

  it("returns first viable portrait when nothing matches the order", () => {
    const picked = selectPortraitForShot(undefined, [mk("custom")]);
    expect(picked?.view).toBe("custom");
  });
});

describe("collectShotReferenceUrls", () => {
  const alicePortraits = [mk("front", "https://x.test/alice_front.png"), mk("side", "https://x.test/alice_side.png")];
  const bobPortraits = [mk("front", "https://x.test/bob_front.png")];
  const charlieNoPortraits: AvailablePortrait[] = [];

  const byChar = new Map<string, AvailablePortrait[]>([
    ["ALICE", alicePortraits],
    ["BOB", bobPortraits],
    ["CHARLIE", charlieNoPortraits],
  ]);

  it("collects one URL per character in input order", () => {
    const urls = collectShotReferenceUrls(undefined, ["ALICE", "BOB"], byChar);
    expect(urls).toEqual(["https://x.test/alice_front.png", "https://x.test/bob_front.png"]);
  });

  it("skips characters with no portraits", () => {
    const urls = collectShotReferenceUrls(undefined, ["CHARLIE", "ALICE"], byChar);
    expect(urls).toEqual(["https://x.test/alice_front.png"]);
  });

  it("caps at maxRefs", () => {
    const many = new Map<string, AvailablePortrait[]>([
      ["A", [mk("front", "a")]],
      ["B", [mk("front", "b")]],
      ["C", [mk("front", "c")]],
      ["D", [mk("front", "d")]],
    ]);
    const urls = collectShotReferenceUrls(undefined, ["A", "B", "C", "D"], many, 2);
    expect(urls).toEqual(["a", "b"]);
  });

  it("respects direction-aware selection", () => {
    const shotMeta: ShotMeta = { screenDirection: "right_to_left" };
    const urls = collectShotReferenceUrls(shotMeta, ["ALICE"], byChar);
    expect(urls).toEqual(["https://x.test/alice_side.png"]);
  });

  it("returns empty list when no characters match", () => {
    const urls = collectShotReferenceUrls(undefined, ["UNKNOWN"], byChar);
    expect(urls).toEqual([]);
  });
});
