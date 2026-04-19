import { describe, expect, it } from "bun:test";
import { parseCriticResponse } from "@/lib/continuity-critic/parse";

const known = new Set(["a", "b", "c"]);

describe("parseCriticResponse", () => {
  it("parses well-formed JSON with violations array", () => {
    const raw = JSON.stringify({
      violations: [
        {
          code: "CRITIC_WARDROBE",
          severity: "high",
          message: "Jacket swapped without motivation.",
          nodeIds: ["a", "b"],
          edgeIds: [],
          suggestedFix: "Pick a wardrobe variant.",
        },
      ],
    });
    const out = parseCriticResponse(raw, known);
    expect(out.violations.length).toBe(1);
    expect(out.violations[0].code).toBe("CRITIC_WARDROBE");
    expect(out.violations[0].severity).toBe("high");
    expect(out.violations[0].nodeIds).toEqual(["a", "b"]);
    expect(out.violations[0].suggestedFix).toBe("Pick a wardrobe variant.");
  });

  it("parses fenced ```json ... ``` blocks", () => {
    const raw =
      "```json\n" +
      JSON.stringify({
        violations: [
          {
            code: "CRITIC_LOCATION",
            severity: "medium",
            message: "Scene jumps from beach to kitchen.",
            nodeIds: ["a"],
          },
        ],
      }) +
      "\n```";
    const out = parseCriticResponse(raw, known);
    expect(out.violations.length).toBe(1);
    expect(out.violations[0].code).toBe("CRITIC_LOCATION");
  });

  it("accepts a bare array at the root", () => {
    const raw = JSON.stringify([
      {
        code: "CRITIC_CHARACTER_ARC",
        severity: "low",
        message: "Abrupt mood reversal.",
        nodeIds: ["a"],
      },
    ]);
    const out = parseCriticResponse(raw, known);
    expect(out.violations.length).toBe(1);
    expect(out.violations[0].code).toBe("CRITIC_CHARACTER_ARC");
  });

  it("accepts already-parsed object input", () => {
    const out = parseCriticResponse(
      {
        violations: [
          {
            code: "CRITIC_NARRATIVE_TIMELINE",
            severity: "critical",
            message: "Character dies in b, reappears alive in c.",
            nodeIds: ["b", "c"],
          },
        ],
      },
      known,
    );
    expect(out.violations.length).toBe(1);
    expect(out.violations[0].nodeIds).toEqual(["b", "c"]);
  });

  it("drops hallucinated nodeIds and empties entire violation if none remain", () => {
    const raw = JSON.stringify({
      violations: [
        {
          code: "CRITIC_WARDROBE",
          severity: "high",
          message: "Bogus.",
          nodeIds: ["ghost1", "ghost2"],
        },
        {
          code: "CRITIC_WARDROBE",
          severity: "high",
          message: "Partially real.",
          nodeIds: ["a", "ghost"],
        },
      ],
    });
    const out = parseCriticResponse(raw, known);
    expect(out.violations.length).toBe(1);
    expect(out.violations[0].nodeIds).toEqual(["a"]);
  });

  it("normalizes unknown codes to CRITIC_OTHER and prefix-less codes to their canonical form", () => {
    const raw = JSON.stringify({
      violations: [
        {
          code: "WARDROBE",
          severity: "high",
          message: "Missing prefix, should normalize.",
          nodeIds: ["a"],
        },
        {
          code: "COMPLETELY_BOGUS",
          severity: "medium",
          message: "Should become OTHER.",
          nodeIds: ["b"],
        },
      ],
    });
    const out = parseCriticResponse(raw, known);
    expect(out.violations.length).toBe(2);
    expect(out.violations[0].code).toBe("CRITIC_WARDROBE");
    expect(out.violations[1].code).toBe("CRITIC_OTHER");
  });

  it("normalizes severity casing and falls back to medium for junk", () => {
    const raw = JSON.stringify({
      violations: [
        {
          code: "CRITIC_WARDROBE",
          severity: "HIGH",
          message: "Mixed case.",
          nodeIds: ["a"],
        },
        {
          code: "CRITIC_WARDROBE",
          severity: "volcanic",
          message: "Garbage severity.",
          nodeIds: ["a"],
        },
      ],
    });
    const out = parseCriticResponse(raw, known);
    expect(out.violations[0].severity).toBe("high");
    expect(out.violations[1].severity).toBe("medium");
  });

  it("returns empty on unparseable input", () => {
    expect(parseCriticResponse("garbage", known).violations).toEqual([]);
    expect(parseCriticResponse("", known).violations).toEqual([]);
  });

  it("clamps to maxViolations", () => {
    const raw = JSON.stringify({
      violations: Array.from({ length: 10 }, () => ({
        code: "CRITIC_WARDROBE",
        severity: "low",
        message: "x",
        nodeIds: ["a"],
      })),
    });
    const out = parseCriticResponse(raw, known, { maxViolations: 3 });
    expect(out.violations.length).toBe(3);
  });

  it("drops violations with empty/missing message", () => {
    const raw = JSON.stringify({
      violations: [
        {
          code: "CRITIC_WARDROBE",
          severity: "low",
          message: "",
          nodeIds: ["a"],
        },
        {
          code: "CRITIC_WARDROBE",
          severity: "low",
          nodeIds: ["a"],
        },
      ],
    });
    const out = parseCriticResponse(raw, known);
    expect(out.violations).toEqual([]);
  });
});
