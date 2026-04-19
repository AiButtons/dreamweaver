import { describe, expect, it } from "bun:test";
import {
  evaluateCameoConsent,
  hashPhotoBytes,
} from "@/lib/cameo";

describe("evaluateCameoConsent", () => {
  it("approved + watermarked → usable", () => {
    const result = evaluateCameoConsent({
      consentStatus: "approved",
      watermarkApplied: true,
    });
    expect(result.usable).toBe(true);
    expect(result.blockedReason).toBeNull();
  });

  it("approved but no watermark → blocked", () => {
    const result = evaluateCameoConsent({
      consentStatus: "approved",
      watermarkApplied: false,
    });
    expect(result.usable).toBe(false);
    expect(result.blockedReason).toMatch(/watermark/i);
  });

  it("pending consent → blocked even with watermark", () => {
    const result = evaluateCameoConsent({
      consentStatus: "pending",
      watermarkApplied: true,
    });
    expect(result.usable).toBe(false);
    expect(result.blockedReason).toMatch(/pending/i);
  });

  it("denied consent → blocked with explicit reason", () => {
    const result = evaluateCameoConsent({
      consentStatus: "denied",
      watermarkApplied: true,
    });
    expect(result.usable).toBe(false);
    expect(result.blockedReason).toMatch(/denied/i);
  });

  it("missing consent status → blocked", () => {
    const result = evaluateCameoConsent({
      consentStatus: undefined,
      watermarkApplied: true,
    });
    expect(result.usable).toBe(false);
    expect(result.blockedReason).toMatch(/pending/i);
  });

  it("denied takes precedence over missing watermark", () => {
    const result = evaluateCameoConsent({
      consentStatus: "denied",
      watermarkApplied: false,
    });
    expect(result.blockedReason).toMatch(/denied/i);
  });
});

describe("hashPhotoBytes", () => {
  it("produces a 64-char hex digest for a small buffer", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const digest = await hashPhotoBytes(bytes);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", async () => {
    const bytes = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const a = await hashPhotoBytes(bytes);
    const b = await hashPhotoBytes(bytes);
    expect(a).toBe(b);
  });

  it("differs for different inputs", async () => {
    const a = await hashPhotoBytes(new Uint8Array([0, 1, 2, 3]));
    const b = await hashPhotoBytes(new Uint8Array([3, 2, 1, 0]));
    expect(a).not.toBe(b);
  });

  it("accepts ArrayBuffer directly", async () => {
    const buf = new ArrayBuffer(16);
    const view = new Uint8Array(buf);
    view.fill(42);
    const digest = await hashPhotoBytes(buf);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a hash meeting the Convex mutation length check", async () => {
    const digest = await hashPhotoBytes(new Uint8Array(64).fill(7));
    // Convex validator requires >= 16 chars; SHA-256 hex = 64 chars.
    expect(digest.length).toBeGreaterThanOrEqual(16);
  });
});
