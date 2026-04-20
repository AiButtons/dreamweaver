import { describe, expect, it } from "bun:test";
import {
  decidePrimarySpeaker,
  extractDialogue,
} from "@/lib/dialogue-extract";

describe("extractDialogue", () => {
  it("returns empty for empty input", () => {
    expect(extractDialogue("")).toEqual({ lines: [], narration: "" });
    expect(extractDialogue("   ")).toEqual({ lines: [], narration: "" });
  });

  it("finds a single `<NAME> says, \"…\"` dialogue", () => {
    const result = extractDialogue(
      'Wide shot of the warehouse. <MAYA> says, "Come on, just one more."',
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].speaker).toBe("MAYA");
    expect(result.lines[0].text).toBe("Come on, just one more.");
    expect(result.narration.startsWith("Wide shot of the warehouse")).toBe(
      true,
    );
    expect(result.narration).not.toContain("MAYA");
    expect(result.narration).not.toContain("Come on");
  });

  it("finds multiple attributed dialogue lines in order", () => {
    const result = extractDialogue(
      '<MAYA> says, "First line." Then <DANIEL> says, "Second line."',
    );
    expect(result.lines.map((l) => l.speaker)).toEqual(["MAYA", "DANIEL"]);
    expect(result.lines.map((l) => l.text)).toEqual([
      "First line.",
      "Second line.",
    ]);
  });

  it("handles the <NAME>: \"…\" shorthand", () => {
    const result = extractDialogue('<ELENA>: "We deliver, or we don\'t pay."');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].speaker).toBe("ELENA");
    expect(result.lines[0].text).toBe("We deliver, or we don't pay.");
  });

  it("catches unattributed quotes as null-speaker lines", () => {
    const result = extractDialogue(
      'The voice on the radio crackles: "Target in sight."',
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].speaker).toBeNull();
    expect(result.lines[0].text).toBe("Target in sight.");
  });

  it("does not double-count attributed lines when unattributed pass runs", () => {
    const result = extractDialogue(
      '<MAYA> says, "one." Silence. "two" from somewhere.',
    );
    // MAYA should land as attributed. The second quote "two" is
    // unattributed, so speaker null.
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].speaker).toBe("MAYA");
    expect(result.lines[1].speaker).toBeNull();
  });

  it("handles curly/smart quote characters", () => {
    const result = extractDialogue("<PAUL> says, \u201CLate again.\u201D");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].speaker).toBe("PAUL");
    expect(result.lines[0].text).toBe("Late again.");
  });

  it("strips leftover <NAME> tags from narration", () => {
    const result = extractDialogue(
      "Close on <MAYA>'s eyes. She glares at <DANIEL>.",
    );
    expect(result.lines).toEqual([]);
    expect(result.narration).toBe("Close on MAYA's eyes. She glares at DANIEL.");
  });

  it("normalizes whitespace in narration", () => {
    const result = extractDialogue("Line one.    \n\n\n   Line two.");
    expect(result.narration).toBe("Line one. Line two.");
  });

  it("offsets reflect source positions in order", () => {
    const source =
      'FIRST <A> says, "alpha." MIDDLE <B> says, "beta." LAST';
    const result = extractDialogue(source);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].offset).toBeLessThan(result.lines[1].offset);
  });
});

describe("decidePrimarySpeaker", () => {
  const voices = {
    MAYA: "nova",
    DANIEL: "onyx",
  };

  it("returns null speaker for empty segment", () => {
    const d = decidePrimarySpeaker("", voices);
    expect(d.speaker).toBeNull();
    expect(d.voice).toBeUndefined();
    expect(d.isSoloDialogue).toBe(false);
  });

  it("returns null speaker for narration-only", () => {
    const d = decidePrimarySpeaker(
      "Wide shot of the warehouse at dusk.",
      voices,
    );
    expect(d.speaker).toBeNull();
  });

  it("returns the single speaker + mapped voice", () => {
    const d = decidePrimarySpeaker(
      'Close on <MAYA>\'s face. <MAYA> says, "Go."',
      voices,
    );
    expect(d.speaker).toBe("MAYA");
    expect(d.voice).toBe("nova");
  });

  it("returns null when multiple distinct speakers appear", () => {
    const d = decidePrimarySpeaker(
      '<MAYA> says, "Go." <DANIEL> says, "No."',
      voices,
    );
    expect(d.speaker).toBeNull();
    expect(d.voice).toBeUndefined();
  });

  it("returns voice=undefined when the speaker has no mapping", () => {
    const d = decidePrimarySpeaker('<RITA> says, "Late again."', voices);
    expect(d.speaker).toBe("RITA");
    expect(d.voice).toBeUndefined();
  });

  it("isSoloDialogue=true when there's minimal narration", () => {
    const d = decidePrimarySpeaker('<MAYA> says, "Go."', voices);
    expect(d.isSoloDialogue).toBe(true);
  });

  it("isSoloDialogue=false when narration is substantial", () => {
    const d = decidePrimarySpeaker(
      'Wide shot of the dockside warehouse at dusk with flickering lamps. <MAYA> says, "Go."',
      voices,
    );
    expect(d.speaker).toBe("MAYA");
    expect(d.isSoloDialogue).toBe(false);
  });

  it("ignores unattributed quotes when counting unique speakers", () => {
    const d = decidePrimarySpeaker(
      '<MAYA> says, "Go." The radio buzzes, "static."',
      voices,
    );
    expect(d.speaker).toBe("MAYA");
    expect(d.voice).toBe("nova");
  });
});
