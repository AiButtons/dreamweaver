import { describe, expect, it } from "bun:test";
import {
  buildIngestionDialogHref,
  buildShotBatchNavHref,
  type IngestionRunInput,
} from "@/components/storyboard/StoryboardCopilotBridge";

// These helpers drive the M3 #4 agent → UI handoff: the chat supervisor
// emits `request_ingestion_run`, the bridge renders an ApprovalCard, and
// on approve we `router.push(...)` the URL produced here. The library
// page then reads `?ingest=<mode>` and auto-opens the dialog.
describe("buildIngestionDialogHref", () => {
  it("encodes mode + title as query params", () => {
    const input: IngestionRunInput = {
      mode: "screenplay",
      title: "Night Train",
      rationale: "r",
      hints: {},
    };
    const href = buildIngestionDialogHref(input);
    expect(href).toMatch(/^\/storyboard\?/);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("ingest")).toBe("screenplay");
    expect(params.get("title")).toBe("Night Train");
  });

  it("prefixes hint keys so the library page can namespace them", () => {
    const input: IngestionRunInput = {
      mode: "novel",
      title: "Harbour",
      rationale: "",
      hints: {
        style: "Cinematic",
        targetEpisodeCount: 4,
      },
    };
    const href = buildIngestionDialogHref(input);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("hint_style")).toBe("Cinematic");
    expect(params.get("hint_targetEpisodeCount")).toBe("4");
  });

  it("omits title param when title is empty", () => {
    const input: IngestionRunInput = {
      mode: "idea",
      title: "",
      rationale: "",
      hints: {},
    };
    const href = buildIngestionDialogHref(input);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.has("title")).toBe(false);
    expect(params.get("ingest")).toBe("idea");
  });

  it("produces deterministic output for the same input", () => {
    const input: IngestionRunInput = {
      mode: "idea",
      title: "Dragon Egg",
      rationale: "",
      hints: { style: "Whimsical" },
    };
    expect(buildIngestionDialogHref(input)).toBe(buildIngestionDialogHref(input));
  });
});

// Loose end #2 — the bridge navigates across storyboards by encoding the
// deferred shot-batch trigger as URL params. `buildShotBatchNavHref`
// produces the target href; the destination page reads the params on
// mount and dispatches the CustomEvent.
describe("buildShotBatchNavHref", () => {
  it("encodes storyboardId in the path segment", () => {
    const href = buildShotBatchNavHref({
      storyboardId: "sb_42",
      skipExisting: true,
      concurrency: 3,
    });
    expect(href).toMatch(/^\/storyboard\/sb_42\?/);
  });

  it("encodes skipExisting as 1/0 and clamps concurrency", () => {
    const a = buildShotBatchNavHref({
      storyboardId: "sb_42",
      skipExisting: true,
      concurrency: 99,
    });
    const b = buildShotBatchNavHref({
      storyboardId: "sb_42",
      skipExisting: false,
      concurrency: -5,
    });
    const aParams = new URLSearchParams(a.split("?")[1]);
    const bParams = new URLSearchParams(b.split("?")[1]);
    expect(aParams.get("batchSkipExisting")).toBe("1");
    expect(aParams.get("batchConcurrency")).toBe("6");
    expect(bParams.get("batchSkipExisting")).toBe("0");
    expect(bParams.get("batchConcurrency")).toBe("1");
  });

  it("always sets triggerBatch=1", () => {
    const href = buildShotBatchNavHref({
      storyboardId: "sb_99",
      skipExisting: true,
      concurrency: 2,
    });
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("triggerBatch")).toBe("1");
  });

  it("URL-encodes awkward storyboardId characters", () => {
    const href = buildShotBatchNavHref({
      storyboardId: "sb with spaces/slash",
      skipExisting: true,
      concurrency: 3,
    });
    expect(href).toMatch(/^\/storyboard\/sb%20with%20spaces%2Fslash\?/);
  });
});

// M5 — the video batch event and image batch event carry different
// payload shapes (video adds videoModelId). Confirm the constants are
// distinct strings so a single window-level listener on the image event
// never fires for a video approval.
describe("SHOT_*_BATCH_TRIGGER_EVENT constants", () => {
  it("are distinct event names", async () => {
    const {
      SHOT_BATCH_TRIGGER_EVENT,
      SHOT_VIDEO_BATCH_TRIGGER_EVENT,
    } = await import("@/components/storyboard/StoryboardCopilotBridge");
    expect(SHOT_BATCH_TRIGGER_EVENT).not.toBe(SHOT_VIDEO_BATCH_TRIGGER_EVENT);
    // Prefix sanity: both should live under `storyboard:` so a
    // wildcard subscriber can filter them cleanly.
    expect(SHOT_BATCH_TRIGGER_EVENT.startsWith("storyboard:")).toBe(true);
    expect(SHOT_VIDEO_BATCH_TRIGGER_EVENT.startsWith("storyboard:")).toBe(
      true,
    );
  });
});
