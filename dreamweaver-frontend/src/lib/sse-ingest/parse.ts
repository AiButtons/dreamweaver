/**
 * Pure SSE frame parser. Converts a chunk of incoming bytes into
 * zero-or-more { event, data } records, buffering partial frames. Carries
 * no React / browser deps so it's trivially unit-testable.
 *
 * SSE framing reminder: records end with a blank line (`\n\n`); each record
 * is a sequence of `event: <type>`, `data: <payload>`, `id: <id>`, or
 * comment (`:...`) lines. The `data` field may be multi-line — consecutive
 * `data:` lines concatenate with `\n`.
 */

export interface ParsedSseFrame {
  event: string;
  data: string;
}

export class SseFrameParser {
  private buffer = "";

  /**
   * Feed a chunk of decoded text (already UTF-8-decoded from the response
   * body's ReadableStream) and return any complete frames that became
   * available. Incomplete tail frames stay in the buffer.
   */
  push(chunk: string): ParsedSseFrame[] {
    this.buffer += chunk;
    const frames: ParsedSseFrame[] = [];
    let sep = this.buffer.indexOf("\n\n");
    while (sep !== -1) {
      const raw = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      sep = this.buffer.indexOf("\n\n");
      const parsed = parseSseRecord(raw);
      if (parsed) frames.push(parsed);
    }
    return frames;
  }

  /** Drain any remaining frame — usually empty; useful for tests. */
  flush(): ParsedSseFrame[] {
    const tail = this.buffer.trim();
    this.buffer = "";
    if (!tail) return [];
    const parsed = parseSseRecord(tail);
    return parsed ? [parsed] : [];
  }
}

function parseSseRecord(raw: string): ParsedSseFrame | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue; // comment
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}
