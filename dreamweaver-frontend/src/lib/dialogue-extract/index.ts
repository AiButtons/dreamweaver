/**
 * M6 — dialogue extractor.
 *
 * The ViMax storyboard_artist system prompt tells the LLM to enclose
 * character names in angle brackets in visual descriptions and to
 * include dialogue in quotes inside the description. Two shapes
 * dominate in practice:
 *
 *   1. `<MAYA> says, "Come on, just one more."`
 *   2. `<MAYA>: "Come on, just one more."`   (rarer, but seen)
 *
 * This module turns that mixed narration-and-quotes text into a
 * structured list of `{ speaker, text }` lines plus a residual
 * narration string for the audio-batch pipeline to decide whether
 * to voice each line in the character's assigned voice.
 *
 * Pure — no React, no Convex, no network. Exported as a library so
 * both the Next.js audio-batch route and client-side previews can
 * reuse the same logic.
 */

export interface DialogueLine {
  /** Uppercase speaker identifier pulled from the angle-bracket
   *  convention. `null` when a quoted line has no attribution. */
  speaker: string | null;
  /** The spoken text, with surrounding quotes stripped. */
  text: string;
  /** Character offset in the original segment where the line starts.
   *  Useful if a caller wants to interleave dialogue + narration in
   *  chronological order. */
  offset: number;
}

export interface ExtractResult {
  lines: DialogueLine[];
  /** The non-dialogue narration prose, with the matched dialogue
   *  chunks stripped out. Whitespace collapsed. */
  narration: string;
}

// Curly and straight quote characters, plus their matching closers.
// Keeping this tight to the two most common pairs — producers pasting
// in Word-formatted text occasionally get 'smart' quotes that the
// default ASCII pattern would miss.
const OPEN_QUOTES = '"\u201C';
const CLOSE_QUOTES = '"\u201D';

const DIALOGUE_PATTERN = new RegExp(
  // <NAME> optionally with apostrophes/periods in the name, followed
  // by an optional attribution verb phrase, followed by a quoted line.
  `<([A-Z][A-Z0-9_.' -]{0,40})>\\s*(?::|(?:[A-Za-z ,]{0,40}?))?\\s*([${OPEN_QUOTES}])([^${CLOSE_QUOTES}]+)[${CLOSE_QUOTES}]`,
  "g",
);

// Fallback pattern: quoted lines with no <NAME> attribution nearby.
// We still want to count them as dialogue so narration doesn't carry
// them twice, but the speaker is null.
const UNATTRIBUTED_PATTERN = new RegExp(
  `([${OPEN_QUOTES}])([^${CLOSE_QUOTES}]+)[${CLOSE_QUOTES}]`,
  "g",
);

/** Strip any `<NAME>` tags left behind in narration text so TTS doesn't
 *  literally read the angle brackets aloud. */
const stripAngleTags = (text: string): string =>
  text.replace(/<([A-Z][A-Z0-9_.' -]{0,40})>/g, (_m, name) =>
    String(name).trim(),
  );

/** Collapse runs of whitespace into single spaces and trim. */
const normalizeWhitespace = (text: string): string =>
  text.replace(/\s+/g, " ").trim();

export const extractDialogue = (segment: string): ExtractResult => {
  if (!segment || segment.trim().length === 0) {
    return { lines: [], narration: "" };
  }
  const lines: DialogueLine[] = [];
  const consumedRanges: Array<[number, number]> = [];

  // Pass 1 — attributed dialogue (<NAME> … "…").
  for (const m of segment.matchAll(DIALOGUE_PATTERN)) {
    const [full, speaker, , text] = m;
    const start = m.index ?? 0;
    const end = start + full.length;
    lines.push({
      speaker: String(speaker).toUpperCase().trim(),
      text: normalizeWhitespace(String(text)),
      offset: start,
    });
    consumedRanges.push([start, end]);
  }

  // Pass 2 — standalone quotes NOT already consumed by pass 1.
  for (const m of segment.matchAll(UNATTRIBUTED_PATTERN)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const alreadyConsumed = consumedRanges.some(
      ([s, e]) => start >= s && end <= e,
    );
    if (alreadyConsumed) continue;
    lines.push({
      speaker: null,
      text: normalizeWhitespace(m[2]),
      offset: start,
    });
    consumedRanges.push([start, end]);
  }

  // Reorder by offset so callers can interleave.
  lines.sort((a, b) => a.offset - b.offset);

  // Narration = everything outside the consumed ranges, collapsed.
  consumedRanges.sort((a, b) => a[0] - b[0]);
  let narration = "";
  let cursor = 0;
  for (const [start, end] of consumedRanges) {
    if (start > cursor) {
      narration += segment.slice(cursor, start);
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < segment.length) {
    narration += segment.slice(cursor);
  }
  return {
    lines,
    narration: normalizeWhitespace(stripAngleTags(narration)),
  };
};

export type SpeakerVoiceMap = Record<string, string | undefined>;

export interface SpeakerDecision {
  /** The single speaker detected for this shot, or null. */
  speaker: string | null;
  /** The voice the audio batch should use. Either the mapped voice
   *  for `speaker` or undefined (caller uses batch default). */
  voice: string | undefined;
  /** True when the shot contains exactly one speaker's dialogue and
   *  no competing narration. Callers can use this to short-circuit
   *  the "single-voice read-back" optimization. */
  isSoloDialogue: boolean;
}

/**
 * Decide whether a shot has a single dominant speaker that should read
 * it, or whether narration fallback is safer.
 *
 * Logic:
 *   - Zero dialogue lines → no speaker; fall back to narration voice.
 *   - Exactly one unique (non-null) speaker → return them. If any
 *     narration is non-trivial (>20 chars), `isSoloDialogue` = false
 *     so the caller knows the speaker's voice will also read the
 *     narration. That's a scaffold compromise — a full multi-track
 *     mix is a later phase.
 *   - Multiple unique speakers → no single voice wins; fall back.
 *
 * Exported for direct use in the audio batch route.
 */
export const decidePrimarySpeaker = (
  segment: string,
  speakerVoices: SpeakerVoiceMap,
): SpeakerDecision => {
  const { lines, narration } = extractDialogue(segment);
  const attributed = lines.filter((l) => l.speaker !== null);
  if (attributed.length === 0) {
    return { speaker: null, voice: undefined, isSoloDialogue: false };
  }
  const uniqueSpeakers = Array.from(
    new Set(attributed.map((l) => l.speaker as string)),
  );
  if (uniqueSpeakers.length !== 1) {
    return { speaker: null, voice: undefined, isSoloDialogue: false };
  }
  const speaker = uniqueSpeakers[0];
  return {
    speaker,
    voice: speakerVoices[speaker],
    isSoloDialogue: narration.length <= 20,
  };
};
