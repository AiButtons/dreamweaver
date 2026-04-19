import { describe, expect, it } from "bun:test";
import {
  canPromoteCutTier,
  formatReviewRound,
  nextCutTier,
} from "@/lib/cut-tier";

describe("canPromoteCutTier", () => {
  it("allows any target when from is undefined", () => {
    expect(canPromoteCutTier(undefined, "delivered")).toBe(true);
    expect(canPromoteCutTier(undefined, "assembly")).toBe(true);
  });

  it("allows forward progression", () => {
    expect(canPromoteCutTier("assembly", "editors")).toBe(true);
    expect(canPromoteCutTier("assembly", "delivered")).toBe(true);
  });

  it("rejects regression", () => {
    expect(canPromoteCutTier("directors", "assembly")).toBe(false);
    expect(canPromoteCutTier("delivered", "online")).toBe(false);
  });

  it("allows idempotent same-tier transition", () => {
    expect(canPromoteCutTier("pictureLock", "pictureLock")).toBe(true);
  });
});

describe("nextCutTier", () => {
  it("returns assembly for undefined input", () => {
    expect(nextCutTier(undefined)).toBe("assembly");
  });

  it("advances one step along the ladder", () => {
    expect(nextCutTier("assembly")).toBe("editors");
    expect(nextCutTier("editors")).toBe("directors");
    expect(nextCutTier("pictureLock")).toBe("online");
    expect(nextCutTier("online")).toBe("delivered");
  });

  it("returns null at the top of the ladder", () => {
    expect(nextCutTier("delivered")).toBeNull();
  });
});

describe("formatReviewRound", () => {
  it("formats positive integers as R#", () => {
    expect(formatReviewRound(1)).toBe("R1");
    expect(formatReviewRound(3)).toBe("R3");
  });

  it("returns null for nullish / invalid inputs", () => {
    expect(formatReviewRound(undefined)).toBeNull();
    expect(formatReviewRound(null)).toBeNull();
    expect(formatReviewRound(0)).toBeNull();
    expect(formatReviewRound(-1)).toBeNull();
    expect(formatReviewRound(Number.NaN)).toBeNull();
    expect(formatReviewRound(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("floors non-integer rounds", () => {
    expect(formatReviewRound(2.7)).toBe("R2");
  });
});
