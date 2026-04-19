import { describe, expect, it } from "bun:test";
import {
  orderPortraitsCanonically,
  portraitSetStatus,
} from "@/lib/identity-portraits";
import type { PortraitView } from "@/lib/identity-portraits";

type TestPortrait = {
  id: string;
  portraitView?: PortraitView;
  createdAt: number;
};

const make = (
  id: string,
  portraitView: PortraitView | undefined,
  createdAt: number,
): TestPortrait => ({ id, portraitView, createdAt });

describe("portraitSetStatus", () => {
  it("returns empty state for an empty array", () => {
    const status = portraitSetStatus<TestPortrait>([]);
    expect(status.presentViews).toEqual([]);
    expect(status.hasFront).toBe(false);
    expect(status.hasSide).toBe(false);
    expect(status.hasBack).toBe(false);
    expect(status.hasCanonicalThreeView).toBe(false);
    expect(status.missingCanonical).toEqual(["front", "side", "back"]);
  });

  it("detects a lone front portrait", () => {
    const status = portraitSetStatus<TestPortrait>([make("a", "front", 1)]);
    expect(status.hasFront).toBe(true);
    expect(status.hasSide).toBe(false);
    expect(status.hasBack).toBe(false);
    expect(status.hasCanonicalThreeView).toBe(false);
    expect(status.missingCanonical).toEqual(["side", "back"]);
    expect(status.presentViews).toEqual(["front"]);
  });

  it("flags the canonical three-view set", () => {
    const status = portraitSetStatus<TestPortrait>([
      make("a", "front", 1),
      make("b", "side", 2),
      make("c", "back", 3),
    ]);
    expect(status.hasCanonicalThreeView).toBe(true);
    expect(status.missingCanonical).toEqual([]);
    expect(status.presentViews).toEqual(["front", "side", "back"]);
  });

  it("collapses duplicate views in presentViews", () => {
    const status = portraitSetStatus<TestPortrait>([
      make("a", "front", 1),
      make("b", "front", 2),
      make("c", "front", 3),
    ]);
    expect(status.presentViews).toEqual(["front"]);
    expect(status.hasFront).toBe(true);
    expect(status.hasSide).toBe(false);
    expect(status.missingCanonical).toEqual(["side", "back"]);
  });

  it("ignores three_quarter / custom when deciding canonical completeness", () => {
    const status = portraitSetStatus<TestPortrait>([
      make("a", "three_quarter", 1),
      make("b", "custom", 2),
    ]);
    expect(status.hasCanonicalThreeView).toBe(false);
    expect(status.missingCanonical).toEqual(["front", "side", "back"]);
    // three_quarter and custom do appear in presentViews though.
    expect(status.presentViews).toContain("three_quarter");
    expect(status.presentViews).toContain("custom");
  });
});

describe("orderPortraitsCanonically", () => {
  it("sorts front-then-back-then-side into canonical order", () => {
    const ordered = orderPortraitsCanonically<TestPortrait>([
      make("back1", "back", 1),
      make("front1", "front", 2),
      make("side1", "side", 3),
    ]);
    expect(ordered.map((p) => p.id)).toEqual(["front1", "side1", "back1"]);
  });

  it("breaks ties within the same view by ascending createdAt", () => {
    const ordered = orderPortraitsCanonically<TestPortrait>([
      make("f2", "front", 200),
      make("f1", "front", 100),
      make("f3", "front", 300),
    ]);
    expect(ordered.map((p) => p.id)).toEqual(["f1", "f2", "f3"]);
  });

  it("sorts three_quarter between front and side", () => {
    const ordered = orderPortraitsCanonically<TestPortrait>([
      make("side", "side", 1),
      make("tq", "three_quarter", 2),
      make("front", "front", 3),
    ]);
    expect(ordered.map((p) => p.id)).toEqual(["front", "tq", "side"]);
  });

  it("sends portraits with an undefined view to the end", () => {
    const ordered = orderPortraitsCanonically<TestPortrait>([
      make("unknown", undefined, 1),
      make("custom", "custom", 2),
      make("front", "front", 3),
    ]);
    expect(ordered.map((p) => p.id)).toEqual(["front", "custom", "unknown"]);
  });

  it("does not mutate the input array", () => {
    const input: TestPortrait[] = [
      make("back", "back", 1),
      make("front", "front", 2),
    ];
    const snapshot = input.map((p) => p.id);
    orderPortraitsCanonically(input);
    expect(input.map((p) => p.id)).toEqual(snapshot);
  });
});
