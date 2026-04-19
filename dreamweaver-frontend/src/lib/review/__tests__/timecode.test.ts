import { describe, expect, it } from "bun:test";
import {
  formatTimecode,
  groupComments,
  parseTimecode,
  sortTopLevelByTimecode,
  type SortableComment,
} from "@/lib/review/timecode";

describe("formatTimecode", () => {
  it("formats zero as 0:00.000", () => {
    expect(formatTimecode(0)).toBe("0:00.000");
  });

  it("formats sub-minute offsets with mm:ss.mmm", () => {
    expect(formatTimecode(1234)).toBe("0:01.234");
  });

  it("formats just-over-minute offsets as M:SS.mmm", () => {
    expect(formatTimecode(61500)).toBe("1:01.500");
  });

  it("switches to H:MM:SS.mmm at or above one hour", () => {
    expect(formatTimecode(3661500)).toBe("1:01:01.500");
  });

  it("renders undefined / null as the em-dash placeholder", () => {
    expect(formatTimecode(undefined)).toBe("—");
    expect(formatTimecode(null)).toBe("—");
  });

  it("renders non-finite values as the placeholder", () => {
    expect(formatTimecode(Number.NaN)).toBe("—");
    expect(formatTimecode(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("clamps negative inputs to zero rather than rendering a minus sign", () => {
    expect(formatTimecode(-500)).toBe("0:00.000");
  });
});

describe("parseTimecode", () => {
  it("parses M:SS.mmm", () => {
    expect(parseTimecode("1:23.456")).toBe(83456);
  });

  it("parses 0:00 as zero", () => {
    expect(parseTimecode("0:00")).toBe(0);
  });

  it("parses plain seconds as seconds", () => {
    expect(parseTimecode("83")).toBe(83000);
  });

  it("parses H:MM:SS.mmm", () => {
    expect(parseTimecode("1:01:01.500")).toBe(3661500);
  });

  it("returns null on garbage", () => {
    expect(parseTimecode("abc")).toBeNull();
    expect(parseTimecode("1:2a")).toBeNull();
    expect(parseTimecode("1:2:3:4")).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(parseTimecode("")).toBeNull();
    expect(parseTimecode("   ")).toBeNull();
  });

  it("round-trips through formatTimecode for representative values", () => {
    for (const ms of [0, 1234, 61500, 3661500, 90000]) {
      expect(parseTimecode(formatTimecode(ms))).toBe(ms);
    }
  });
});

describe("sortTopLevelByTimecode", () => {
  const mk = (overrides: Partial<SortableComment>): SortableComment => ({
    _id: overrides._id ?? "x",
    parentCommentId: overrides.parentCommentId ?? null,
    timecodeMs: overrides.timecodeMs ?? null,
    createdAt: overrides.createdAt ?? 0,
  });

  it("puts timecoded comments first in ascending timecode order", () => {
    const rows = [
      mk({ _id: "b", timecodeMs: 500, createdAt: 2 }),
      mk({ _id: "a", timecodeMs: 100, createdAt: 1 }),
      mk({ _id: "c", timecodeMs: 1000, createdAt: 3 }),
    ];
    const sorted = sortTopLevelByTimecode(rows);
    expect(sorted.map((r) => r._id)).toEqual(["a", "b", "c"]);
  });

  it("pushes null-timecode comments to the end", () => {
    const rows = [
      mk({ _id: "nt", timecodeMs: null, createdAt: 1 }),
      mk({ _id: "a", timecodeMs: 100, createdAt: 2 }),
    ];
    const sorted = sortTopLevelByTimecode(rows);
    expect(sorted.map((r) => r._id)).toEqual(["a", "nt"]);
  });

  it("breaks ties on createdAt ascending", () => {
    const rows = [
      mk({ _id: "b", timecodeMs: 100, createdAt: 2 }),
      mk({ _id: "a", timecodeMs: 100, createdAt: 1 }),
    ];
    const sorted = sortTopLevelByTimecode(rows);
    expect(sorted.map((r) => r._id)).toEqual(["a", "b"]);
  });

  it("excludes replies entirely", () => {
    const rows = [
      mk({ _id: "top", timecodeMs: 100, createdAt: 1 }),
      mk({ _id: "reply", parentCommentId: "top", createdAt: 2 }),
    ];
    const sorted = sortTopLevelByTimecode(rows);
    expect(sorted.map((r) => r._id)).toEqual(["top"]);
  });
});

describe("groupComments", () => {
  const mk = (overrides: Partial<SortableComment>): SortableComment => ({
    _id: overrides._id ?? "x",
    parentCommentId: overrides.parentCommentId ?? null,
    timecodeMs: overrides.timecodeMs ?? null,
    createdAt: overrides.createdAt ?? 0,
  });

  it("returns top-level sorted and replies grouped under parent", () => {
    const rows = [
      mk({ _id: "top2", timecodeMs: 500, createdAt: 2 }),
      mk({ _id: "reply2", parentCommentId: "top1", createdAt: 20 }),
      mk({ _id: "top1", timecodeMs: 100, createdAt: 1 }),
      mk({ _id: "reply1", parentCommentId: "top1", createdAt: 10 }),
    ];
    const { topLevel, repliesByParent } = groupComments(rows);
    expect(topLevel.map((r) => r._id)).toEqual(["top1", "top2"]);
    const repliesForTop1 = repliesByParent.get("top1") ?? [];
    expect(repliesForTop1.map((r) => r._id)).toEqual(["reply1", "reply2"]);
    expect(repliesByParent.has("top2")).toBe(false);
  });

  it("returns empty structures for an empty input", () => {
    const { topLevel, repliesByParent } = groupComments([]);
    expect(topLevel).toEqual([]);
    expect(repliesByParent.size).toBe(0);
  });
});
