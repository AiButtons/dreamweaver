import { describe, expect, it } from "bun:test";
import { SseFrameParser } from "@/lib/sse-ingest/parse";

describe("SseFrameParser", () => {
  it("parses a single frame", () => {
    const p = new SseFrameParser();
    const frames = p.push(`event: stage\ndata: {"pct":10}\n\n`);
    expect(frames).toEqual([{ event: "stage", data: `{"pct":10}` }]);
  });

  it("defaults event name to 'message' when omitted", () => {
    const p = new SseFrameParser();
    const frames = p.push(`data: {"ok":true}\n\n`);
    expect(frames).toEqual([{ event: "message", data: `{"ok":true}` }]);
  });

  it("buffers partial frames across push calls", () => {
    const p = new SseFrameParser();
    expect(p.push("event: stage\n")).toEqual([]);
    expect(p.push("data: ")).toEqual([]);
    expect(p.push(`{"a":1}\n\n`)).toEqual([{ event: "stage", data: `{"a":1}` }]);
  });

  it("handles multiple frames in one push", () => {
    const p = new SseFrameParser();
    const frames = p.push(
      `event: a\ndata: 1\n\nevent: b\ndata: 2\n\n`,
    );
    expect(frames).toEqual([
      { event: "a", data: "1" },
      { event: "b", data: "2" },
    ]);
  });

  it("concatenates multi-line data fields with \\n", () => {
    const p = new SseFrameParser();
    const frames = p.push(`event: x\ndata: first\ndata: second\n\n`);
    expect(frames).toEqual([{ event: "x", data: "first\nsecond" }]);
  });

  it("ignores comment lines", () => {
    const p = new SseFrameParser();
    const frames = p.push(`:heartbeat\nevent: stage\ndata: ok\n\n`);
    expect(frames).toEqual([{ event: "stage", data: "ok" }]);
  });

  it("skips frames with no data lines", () => {
    const p = new SseFrameParser();
    const frames = p.push(`event: retry\n\n`);
    expect(frames).toEqual([]);
  });

  it("flush returns any buffered remainder", () => {
    const p = new SseFrameParser();
    p.push(`event: a\ndata: hello`);
    expect(p.flush()).toEqual([{ event: "a", data: "hello" }]);
    expect(p.push("").length).toBe(0);
  });
});
