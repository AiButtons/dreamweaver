import { describe, expect, it } from "bun:test";
import {
  createLogger,
  formatLogLine,
  resolveRequestId,
} from "@/lib/observability";

describe("formatLogLine", () => {
  it("produces a valid JSON object with the expected fields", () => {
    const line = formatLogLine(
      "info",
      "stage_started",
      { service: "ingest-stream", requestId: "req-abc" },
      { stage: "extracting_characters" },
    );
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("info");
    expect(parsed.service).toBe("ingest-stream");
    expect(parsed.requestId).toBe("req-abc");
    expect(parsed.msg).toBe("stage_started");
    expect(parsed.stage).toBe("extracting_characters");
    expect(typeof parsed.ts).toBe("string");
    expect(Number.isFinite(Date.parse(parsed.ts))).toBe(true);
  });

  it("merges context.extra into every line", () => {
    const line = formatLogLine(
      "warn",
      "abort",
      {
        service: "ingest",
        requestId: "r1",
        extra: { storyboardId: "sb_42", mode: "idea" },
      },
      { reason: "timeout" },
    );
    const parsed = JSON.parse(line);
    expect(parsed.storyboardId).toBe("sb_42");
    expect(parsed.mode).toBe("idea");
    expect(parsed.reason).toBe("timeout");
  });

  it("per-call fields override context.extra on key collision", () => {
    const line = formatLogLine(
      "info",
      "m",
      { service: "s", requestId: "r", extra: { stage: "old" } },
      { stage: "new" },
    );
    expect(JSON.parse(line).stage).toBe("new");
  });
});

describe("createLogger", () => {
  const capture = () => {
    const lines: Array<{ level: string; line: string }> = [];
    const original = {
      debug: console.debug,
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
    console.debug = (line: string) => lines.push({ level: "debug", line });
    console.log = (line: string) => lines.push({ level: "info", line });
    console.warn = (line: string) => lines.push({ level: "warn", line });
    console.error = (line: string) => lines.push({ level: "error", line });
    const restore = () => {
      console.debug = original.debug;
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    };
    return { lines, restore };
  };

  it("routes each level to the matching console method", () => {
    const { lines, restore } = capture();
    try {
      const log = createLogger({ service: "ingest", requestId: "req-1" });
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
    } finally {
      restore();
    }
    expect(lines.map((x) => x.level)).toEqual(["debug", "info", "warn", "error"]);
  });

  it("startTimer emits start + finish with durationMs", async () => {
    const { lines, restore } = capture();
    try {
      const log = createLogger({ service: "ingest", requestId: "req-2" });
      const end = log.startTimer("stage_portraits", { total: 6 });
      await new Promise((r) => setTimeout(r, 10));
      end({ succeeded: 6 });
    } finally {
      restore();
    }
    expect(lines).toHaveLength(2);
    const start = JSON.parse(lines[0].line);
    const finish = JSON.parse(lines[1].line);
    expect(start.msg).toBe("stage_portraits:start");
    expect(finish.msg).toBe("stage_portraits");
    expect(finish.total).toBe(6);
    expect(finish.succeeded).toBe(6);
    expect(typeof finish.durationMs).toBe("number");
    expect(finish.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("child logger inherits context and adds extra fields", () => {
    const { lines, restore } = capture();
    try {
      const parent = createLogger({
        service: "ingest",
        requestId: "req-3",
        extra: { mode: "novel" },
      });
      const child = parent.child({ episodeIndex: 2 });
      child.info("episode_started");
    } finally {
      restore();
    }
    const entry = JSON.parse(lines[0].line);
    expect(entry.service).toBe("ingest");
    expect(entry.requestId).toBe("req-3");
    expect(entry.mode).toBe("novel");
    expect(entry.episodeIndex).toBe(2);
  });
});

describe("resolveRequestId", () => {
  it("uses an incoming x-request-id header when present and well-formed", () => {
    const h = new Headers({ "x-request-id": "req-abc-123" });
    expect(resolveRequestId(h)).toBe("req-abc-123");
  });

  it("rejects malformed incoming ids and mints a UUID", () => {
    const h = new Headers({ "x-request-id": "not valid ! @" });
    const id = resolveRequestId(h);
    expect(id).not.toBe("not valid ! @");
    // UUIDs are 36 chars with four dashes.
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("rejects ids that are too short", () => {
    const h = new Headers({ "x-request-id": "abc" });
    expect(resolveRequestId(h).length).toBeGreaterThan(10);
  });

  it("mints a fresh id when no header is present", () => {
    const h = new Headers();
    const a = resolveRequestId(h);
    const b = resolveRequestId(h);
    expect(a).not.toBe(b);
  });
});
