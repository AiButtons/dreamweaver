// Despite the directory name, this library emits both screenplay formats
// (Fountain, FDX) and post-production handoff formats (EDL, FCP7 XML).
// TODO: AAF export (binary SMPTE structured storage — deferred, needs a
// pyaaf2 bridge or a C++ SDK). A rename of this directory to
// `src/lib/export/` is tracked as a follow-up cleanup.

export * from "./types";
export * from "./traverse";
export * from "./timecode";
export { toFountain } from "./fountain";
export { toFdx } from "./fdx";
export { toEdl } from "./edl";
export { toFcpXml } from "./fcpxml";

import type {
  ScreenplayDocument,
  ScreenplayFormat,
  ScreenplayInput,
} from "./types";
import { toFdx } from "./fdx";
import { toFountain } from "./fountain";
import { toEdl } from "./edl";
import { toFcpXml } from "./fcpxml";

export const exportScreenplay = (
  input: ScreenplayInput,
  format: ScreenplayFormat,
): ScreenplayDocument => {
  if (format === "fountain") return toFountain(input);
  if (format === "fdx") return toFdx(input);
  if (format === "edl") return toEdl(input);
  if (format === "fcpxml") return toFcpXml(input);
  throw new Error(`Unsupported screenplay format: ${format as string}`);
};
