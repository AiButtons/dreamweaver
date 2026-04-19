import { describe, expect, it } from "bun:test";
import {
  buildIngestionDialogHref,
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
