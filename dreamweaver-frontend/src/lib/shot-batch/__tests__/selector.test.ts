import { describe, expect, it } from "bun:test";
import {
  collectShotReferenceUrls,
  rankPortraitsForShot,
  selectPortraitForShot,
  selectPortraitForShotWithContext,
  type AvailablePortrait,
  type CharacterFacing,
} from "@/lib/shot-batch/selector";
import type { ShotMeta } from "@/app/storyboard/types";

const mk = (view: AvailablePortrait["view"], url = `https://x.test/${view}.png`): AvailablePortrait => ({
  view,
  sourceUrl: url,
});

// ---------------------------------------------------------------------------
// M2 regression — keep the simple API working.
// ---------------------------------------------------------------------------
describe("selectPortraitForShot (M2 backward compat)", () => {
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

// ---------------------------------------------------------------------------
// M3 — shot-size awareness.
// ---------------------------------------------------------------------------
describe("selectPortraitForShotWithContext: shot size", () => {
  const allViews = [mk("front"), mk("three_quarter"), mk("side"), mk("back")];

  it("extreme close-up prefers front heavily", () => {
    const picked = selectPortraitForShotWithContext(
      { shotMeta: { size: "ECU" } },
      allViews,
    );
    expect(picked?.view).toBe("front");
  });

  it("close-up prefers front over three_quarter", () => {
    const picked = selectPortraitForShotWithContext(
      { shotMeta: { size: "CU" } },
      allViews,
    );
    expect(picked?.view).toBe("front");
  });

  it("wide shot prefers three_quarter over front", () => {
    const picked = selectPortraitForShotWithContext(
      { shotMeta: { size: "WS" } },
      allViews,
    );
    expect(picked?.view).toBe("three_quarter");
  });

  it("extreme wide + side-only available still returns side", () => {
    const picked = selectPortraitForShotWithContext(
      { shotMeta: { size: "EWS" } },
      [mk("side"), mk("back")],
    );
    expect(picked?.view).toBe("side");
  });

  it("close-up penalizes back view against front", () => {
    const ranked = rankPortraitsForShot(
      { shotMeta: { size: "CU" } },
      [mk("back"), mk("front")],
    );
    expect(ranked[0].portrait.view).toBe("front");
    expect(ranked[1].portrait.view).toBe("back");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});

// ---------------------------------------------------------------------------
// M3 — shot-angle awareness.
// ---------------------------------------------------------------------------
describe("selectPortraitForShotWithContext: shot angle", () => {
  it("bird's eye prefers three_quarter or back over front", () => {
    const picked = selectPortraitForShotWithContext(
      { shotMeta: { angle: "birds_eye" } },
      [mk("front"), mk("three_quarter")],
    );
    expect(picked?.view).toBe("three_quarter");
  });

  it("worm's eye prefers front", () => {
    const picked = selectPortraitForShotWithContext(
      { shotMeta: { angle: "worms_eye" } },
      [mk("front"), mk("three_quarter"), mk("side")],
    );
    expect(picked?.view).toBe("front");
  });

  it("dutch angle stays neutral (front wins via baseline)", () => {
    const picked = selectPortraitForShotWithContext(
      { shotMeta: { angle: "dutch" } },
      [mk("front"), mk("three_quarter"), mk("side")],
    );
    expect(picked?.view).toBe("front");
  });
});

// ---------------------------------------------------------------------------
// M3 — character facing (strongest signal).
// ---------------------------------------------------------------------------
describe("selectPortraitForShotWithContext: character facing", () => {
  const allViews = [mk("front"), mk("three_quarter"), mk("side"), mk("back")];

  it.each<[CharacterFacing, "front" | "side" | "back" | "three_quarter"]>([
    ["toward_camera", "front"],
    ["away_from_camera", "back"],
    ["screen_left", "side"],
    ["screen_right", "side"],
    ["three_quarter_left", "three_quarter"],
    ["three_quarter_right", "three_quarter"],
  ])("facing=%s picks %s", (facing, expected) => {
    const picked = selectPortraitForShotWithContext(
      { characterFacing: facing },
      allViews,
    );
    expect(picked?.view).toBe(expected);
  });

  it("facing overrides shot size preference", () => {
    // Close-up would normally prefer front, but facing=away_from_camera wins.
    const picked = selectPortraitForShotWithContext(
      { shotMeta: { size: "CU" }, characterFacing: "away_from_camera" },
      allViews,
    );
    expect(picked?.view).toBe("back");
  });

  it("facing overrides screen direction", () => {
    // screenDirection would normally push side; facing forces front.
    const picked = selectPortraitForShotWithContext(
      {
        shotMeta: { screenDirection: "right_to_left" },
        characterFacing: "toward_camera",
      },
      allViews,
    );
    expect(picked?.view).toBe("front");
  });
});

// ---------------------------------------------------------------------------
// M3 — multi-character back-off.
// ---------------------------------------------------------------------------
describe("selectPortraitForShotWithContext: multi-character", () => {
  it("3+ characters in wide shot nudges toward three_quarter", () => {
    const picked = selectPortraitForShotWithContext(
      { shotMeta: { size: "WS" }, characterCount: 4 },
      [mk("front"), mk("three_quarter"), mk("side")],
    );
    expect(picked?.view).toBe("three_quarter");
  });

  it("2 characters still picks the size-appropriate view", () => {
    const picked = selectPortraitForShotWithContext(
      { shotMeta: { size: "CU" }, characterCount: 2 },
      [mk("front"), mk("three_quarter")],
    );
    expect(picked?.view).toBe("front");
  });
});

// ---------------------------------------------------------------------------
// collectShotReferenceUrls — both legacy + new options signatures.
// ---------------------------------------------------------------------------
describe("collectShotReferenceUrls", () => {
  const alicePortraits = [mk("front", "alice_front"), mk("side", "alice_side")];
  const bobPortraits = [mk("front", "bob_front"), mk("back", "bob_back")];
  const charlieNoPortraits: AvailablePortrait[] = [];

  const byChar = new Map<string, AvailablePortrait[]>([
    ["ALICE", alicePortraits],
    ["BOB", bobPortraits],
    ["CHARLIE", charlieNoPortraits],
  ]);

  it("legacy positional signature still returns one URL per character", () => {
    const urls = collectShotReferenceUrls(undefined, ["ALICE", "BOB"], byChar);
    expect(urls).toEqual(["alice_front", "bob_front"]);
  });

  it("legacy signature caps at maxRefs numeric argument", () => {
    const many = new Map<string, AvailablePortrait[]>([
      ["A", [mk("front", "a")]],
      ["B", [mk("front", "b")]],
      ["C", [mk("front", "c")]],
      ["D", [mk("front", "d")]],
    ]);
    const urls = collectShotReferenceUrls(undefined, ["A", "B", "C", "D"], many, 2);
    expect(urls).toEqual(["a", "b"]);
  });

  it("options signature supports per-character facing map", () => {
    const facing = new Map<string, CharacterFacing>([
      ["ALICE", "away_from_camera"],
      ["BOB", "toward_camera"],
    ]);
    const urls = collectShotReferenceUrls(undefined, ["ALICE", "BOB"], byChar, {
      facingByCharacter: facing,
    });
    // Alice has no back view → falls through to best available (front) because
    // away→front has a -6 penalty vs front baseline; side is next. Actually
    // with just front + side, the scoring gives: away_from_camera + front = -6,
    // away_from_camera + side = 0 (only FALLBACK baseline 3). So side wins.
    // Bob has toward_camera + front available → front wins (+12).
    expect(urls[0]).toBe("alice_side");
    expect(urls[1]).toBe("bob_front");
  });

  it("options signature respects maxRefs", () => {
    const urls = collectShotReferenceUrls(undefined, ["ALICE", "BOB"], byChar, {
      maxRefs: 1,
    });
    expect(urls).toHaveLength(1);
  });

  it("skips characters with no portraits", () => {
    const urls = collectShotReferenceUrls(undefined, ["CHARLIE", "ALICE"], byChar);
    expect(urls).toEqual(["alice_front"]);
  });

  it("returns empty list when no characters match", () => {
    const urls = collectShotReferenceUrls(undefined, ["UNKNOWN"], byChar);
    expect(urls).toEqual([]);
  });

  it("passes characterCount through so multi-char heuristic fires", () => {
    const threeChars = new Map<string, AvailablePortrait[]>([
      ["A", [mk("front", "a-f"), mk("three_quarter", "a-tq")]],
      ["B", [mk("front", "b-f"), mk("three_quarter", "b-tq")]],
      ["C", [mk("front", "c-f"), mk("three_quarter", "c-tq")]],
    ]);
    // Shot size = WS + 3 characters → prefer three_quarter for each.
    const urls = collectShotReferenceUrls(
      { size: "WS" },
      ["A", "B", "C"],
      threeChars,
    );
    expect(urls).toEqual(["a-tq", "b-tq", "c-tq"]);
  });
});

// ---------------------------------------------------------------------------
// rankPortraitsForShot — expose scoring for debugging.
// ---------------------------------------------------------------------------
describe("rankPortraitsForShot", () => {
  it("returns [] for empty input", () => {
    expect(rankPortraitsForShot({}, [])).toEqual([]);
  });

  it("returns entries sorted by descending score with reason tags", () => {
    const ranked = rankPortraitsForShot(
      { shotMeta: { size: "CU" } },
      [mk("back"), mk("front"), mk("three_quarter")],
    );
    expect(ranked).toHaveLength(3);
    expect(ranked[0].portrait.view).toBe("front");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[0].reason).toContain("closeup");
  });

  it("ties break on FALLBACK_ORDER", () => {
    const ranked = rankPortraitsForShot({}, [mk("custom"), mk("back"), mk("side")]);
    expect(ranked.map((r) => r.portrait.view)).toEqual(["side", "back", "custom"]);
  });
});
