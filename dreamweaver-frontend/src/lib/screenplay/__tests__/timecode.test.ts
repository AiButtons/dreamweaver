import { describe, expect, it } from "bun:test";
import {
  framesToSmpte,
  isNtscFrameRate,
  normalizeFrameRate,
  secondsToFrames,
  secondsToSmpte,
  smpteToFrames,
} from "@/lib/screenplay/timecode";

describe("secondsToSmpte", () => {
  it("formats zero", () => {
    expect(secondsToSmpte(0, 24)).toBe("00:00:00:00");
  });
  it("formats exact seconds", () => {
    expect(secondsToSmpte(1, 24)).toBe("00:00:01:00");
    expect(secondsToSmpte(1, 30)).toBe("00:00:01:00");
  });
  it("formats half seconds at 24fps", () => {
    expect(secondsToSmpte(0.5, 24)).toBe("00:00:00:12");
  });
  it("formats hour+minute+second+frame", () => {
    expect(secondsToSmpte(3661.5, 24)).toBe("01:01:01:12");
  });
});

describe("smpteToFrames", () => {
  it("round-trips through secondsToSmpte at 24fps", () => {
    const tc = secondsToSmpte(2.5, 24);
    expect(smpteToFrames(tc, 24)).toBe(60);
  });
  it("parses 1-hour preroll", () => {
    expect(smpteToFrames("01:00:00:00", 24)).toBe(86400);
  });
  it("returns NaN on malformed input", () => {
    expect(Number.isNaN(smpteToFrames("garbage", 24))).toBe(true);
    expect(Number.isNaN(smpteToFrames("", 24))).toBe(true);
    expect(Number.isNaN(smpteToFrames("01:00:60:00", 24))).toBe(true); // seconds >= 60
    expect(Number.isNaN(smpteToFrames("01:00:00:24", 24))).toBe(true); // frames >= tb
  });
});

describe("framesToSmpte + secondsToFrames", () => {
  it("round-trips", () => {
    expect(framesToSmpte(secondsToFrames(7.25, 24), 24)).toBe("00:00:07:06");
  });
  it("clamps negatives", () => {
    expect(secondsToFrames(-1, 24)).toBe(0);
    expect(framesToSmpte(-5, 24)).toBe("00:00:00:00");
  });
});

describe("normalizeFrameRate", () => {
  it("snaps close NTSC variants", () => {
    expect(normalizeFrameRate(23.98)).toBe(23.976);
    expect(normalizeFrameRate(29.98)).toBe(29.97);
  });
  it("picks closest accepted", () => {
    expect(normalizeFrameRate(45)).toBe(48);
  });
  it("defaults undefined / invalid to 24", () => {
    expect(normalizeFrameRate(undefined)).toBe(24);
    expect(normalizeFrameRate(0)).toBe(24);
    expect(normalizeFrameRate(-5)).toBe(24);
  });
});

describe("isNtscFrameRate", () => {
  it("flags the three NTSC rates", () => {
    expect(isNtscFrameRate(23.976)).toBe(true);
    expect(isNtscFrameRate(29.97)).toBe(true);
    expect(isNtscFrameRate(59.94)).toBe(true);
  });
  it("returns false for the rest", () => {
    expect(isNtscFrameRate(24)).toBe(false);
    expect(isNtscFrameRate(30)).toBe(false);
    expect(isNtscFrameRate(60)).toBe(false);
  });
});
