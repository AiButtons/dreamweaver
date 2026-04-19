/**
 * Minimal structured-logging + request-correlation helpers for the
 * storyboard ingest / shot-batch / agent routes.
 *
 * Goals:
 *   - Every log line is JSON so operators can pipe stdout into whichever
 *     log backend they run (Vercel / DataDog / plain journalctl).
 *   - Every ingestion carries a stable `requestId` that shows up in both
 *     the Next.js route's logs AND the storyboard-agent's logs, so an
 *     incident responder can grep by id to reconstruct the whole run.
 *   - Zero runtime deps — this module only touches `console.log` and
 *     `crypto.randomUUID()`.
 *
 * Usage:
 *
 *   const log = createLogger({ service: "ingest-stream", requestId });
 *   log.info("stage_started", { stage: "extracting_characters" });
 *   const end = log.startTimer("stage_completed", { stage: "..." });
 *   ...do work...
 *   end({ outcomeCount: 42 });
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerContext {
  /** Short name of the service/route emitting the log. */
  service: string;
  /** Stable id for correlating logs across services. */
  requestId: string;
  /** Optional extra fields applied to every line. */
  extra?: Record<string, unknown>;
}

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /**
   * Returns a callback that, when invoked, logs a single line with a
   * `durationMs` field computed from when `startTimer` was called.
   * Second arg lets callers attach additional fields at completion time
   * (e.g. the count the stage produced).
   */
  startTimer(msg: string, startFields?: LogFields): (endFields?: LogFields) => void;
  /** Derive a child logger that inherits context + adds more fields. */
  child(moreExtra: LogFields): Logger;
}

/**
 * Format a log entry as a JSON line. Exported so tests can assert
 * exactly what hits stdout without capturing console output.
 */
export const formatLogLine = (
  level: LogLevel,
  msg: string,
  context: LoggerContext,
  fields: LogFields = {},
): string => {
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: context.service,
    requestId: context.requestId,
    msg,
    ...(context.extra ?? {}),
    ...fields,
  };
  return JSON.stringify(entry);
};

const CONSOLE_FOR_LEVEL: Record<LogLevel, (line: string) => void> = {
  debug: (line) => console.debug(line),
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

/**
 * Build a logger bound to a specific service + request. The returned
 * logger is cheap to construct; re-create on each request instead of
 * mutating a global.
 */
export const createLogger = (context: LoggerContext): Logger => {
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    const line = formatLogLine(level, msg, context, fields);
    CONSOLE_FOR_LEVEL[level](line);
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    startTimer: (msg, startFields) => {
      const startedAt = Date.now();
      emit("info", `${msg}:start`, startFields);
      return (endFields) =>
        emit("info", msg, {
          ...startFields,
          ...endFields,
          durationMs: Date.now() - startedAt,
        });
    },
    child: (moreExtra) =>
      createLogger({
        ...context,
        extra: { ...(context.extra ?? {}), ...moreExtra },
      }),
  };
};

/**
 * Resolve a request id from (a) an inbound `x-request-id` header, if
 * present, or (b) a fresh UUID. Exported so the same id can be echoed
 * back to the caller in responses and forwarded to the Python agent.
 */
export const resolveRequestId = (headers: Headers): string => {
  const incoming = headers.get("x-request-id");
  if (incoming && /^[a-zA-Z0-9_-]{6,128}$/.test(incoming)) {
    return incoming;
  }
  // `crypto.randomUUID` is available in Node 18+ and all modern browsers.
  return crypto.randomUUID();
};
