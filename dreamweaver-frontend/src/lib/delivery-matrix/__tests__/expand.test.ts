import { describe, expect, it } from "bun:test";
import { expandVariantMatrix, MATRIX_MAX_ROWS } from "@/lib/delivery-matrix/expand";

describe("expandVariantMatrix", () => {
  it("expands single aspect x two durations and copies platform/endCard onto every row", () => {
    const rows = expandVariantMatrix({
      aspects: ["16:9"],
      durationsS: [15, 30],
      platform: "meta",
      endCard: "logo_v2.png",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ aspect: "16:9", durationS: 15, platform: "meta", endCard: "logo_v2.png" });
    expect(rows[1]).toEqual({ aspect: "16:9", durationS: 30, platform: "meta", endCard: "logo_v2.png" });
  });

  it("empty input still yields one empty spec so the user can fill it in by hand", () => {
    const rows = expandVariantMatrix({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({});
  });

  it("3 aspects x 3 durations x 3 locales x 2 A/B labels = 54 specs", () => {
    const rows = expandVariantMatrix({
      aspects: ["16:9", "9:16", "1:1"],
      durationsS: [6, 15, 30],
      locales: ["en-US", "es-MX", "fr-FR"],
      abLabels: ["A", "B"],
    });
    expect(rows).toHaveLength(54);
  });

  it("throws when expansion exceeds the 500-row cap", () => {
    // 7 aspects x 6 durations x 10 locales x 2 A/B = 840 > 500
    expect(() =>
      expandVariantMatrix({
        aspects: ["2.39:1", "1.85:1", "16:9", "9:16", "4:5", "1:1", "2:1"],
        durationsS: [6, 10, 15, 30, 60, 90],
        locales: ["en-US", "en-GB", "es-MX", "es-ES", "fr-FR", "de-DE", "pt-BR", "ja-JP", "zh-CN", "hi-IN"],
        abLabels: ["A", "B"],
      }),
    ).toThrow(/cap is 500/);
    expect(MATRIX_MAX_ROWS).toBe(500);
  });

  it("preserves canonical iteration order: aspect (outer) > duration > locale > abLabel (inner)", () => {
    const rows = expandVariantMatrix({
      aspects: ["16:9", "9:16"],
      durationsS: [15, 30],
      locales: ["en-US", "es-MX"],
      abLabels: ["A", "B"],
    });
    // 2 x 2 x 2 x 2 = 16 rows; innermost-varying dimension is abLabel.
    expect(rows).toHaveLength(16);
    expect(rows[0]).toEqual({ aspect: "16:9", durationS: 15, locale: "en-US", abLabel: "A" });
    expect(rows[1]).toEqual({ aspect: "16:9", durationS: 15, locale: "en-US", abLabel: "B" });
    expect(rows[2]).toEqual({ aspect: "16:9", durationS: 15, locale: "es-MX", abLabel: "A" });
    expect(rows[3]).toEqual({ aspect: "16:9", durationS: 15, locale: "es-MX", abLabel: "B" });
    expect(rows[4]).toEqual({ aspect: "16:9", durationS: 30, locale: "en-US", abLabel: "A" });
    expect(rows[8]).toEqual({ aspect: "9:16", durationS: 15, locale: "en-US", abLabel: "A" });
    expect(rows[15]).toEqual({ aspect: "9:16", durationS: 30, locale: "es-MX", abLabel: "B" });
  });
});
