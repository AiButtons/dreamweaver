import type { AspectRatio, DeliveryPlatform, DeliveryVariantSpec } from "@/app/storyboard/types";

export interface MatrixInput {
  aspects?: AspectRatio[];
  durationsS?: number[];
  locales?: string[];
  abLabels?: string[];
  platform?: DeliveryPlatform;
  endCard?: string;
  notes?: string;
}

/**
 * Hard ceiling on the number of variants a single matrix spawn can produce.
 * Picking every option across every dimension in a busy campaign trivially
 * blows past the thousands; the UI side would also die rendering that many
 * rows. Kept here (not in the Convex mutation only) so the "live preview
 * count" on the matrix dialog and the server-side guard agree.
 */
export const MATRIX_MAX_ROWS = 500;

/**
 * Cartesian-expand the chosen dimensions to a list of variant specs.
 * Dimensions with no options are collapsed (contribute a single unset slot),
 * so choosing just aspects = [16:9, 9:16] with no duration produces 2 rows.
 *
 * Canonical iteration order: aspects (outermost) → durations → locales →
 * abLabels (innermost). This is the order a human reads a delivery matrix
 * row label in ("16:9 / 15s / en-US / A") and keeps the preview stable as
 * inputs are added/removed.
 */
export const expandVariantMatrix = (input: MatrixInput): DeliveryVariantSpec[] => {
  const aspects = input.aspects && input.aspects.length > 0 ? input.aspects : [undefined];
  const durations = input.durationsS && input.durationsS.length > 0 ? input.durationsS : [undefined];
  const locales = input.locales && input.locales.length > 0 ? input.locales : [undefined];
  const abLabels = input.abLabels && input.abLabels.length > 0 ? input.abLabels : [undefined];

  const total = aspects.length * durations.length * locales.length * abLabels.length;
  if (total > MATRIX_MAX_ROWS) {
    throw new Error(
      `Delivery matrix would produce ${total} variants; cap is ${MATRIX_MAX_ROWS}. ` +
        `Narrow the selection before spawning.`,
    );
  }

  const out: DeliveryVariantSpec[] = [];
  for (const aspect of aspects) {
    for (const durationS of durations) {
      for (const locale of locales) {
        for (const abLabel of abLabels) {
          const spec: DeliveryVariantSpec = {};
          if (aspect !== undefined) spec.aspect = aspect;
          if (durationS !== undefined) spec.durationS = durationS;
          if (locale !== undefined) spec.locale = locale;
          if (abLabel !== undefined) spec.abLabel = abLabel;
          if (input.platform !== undefined) spec.platform = input.platform;
          if (input.endCard !== undefined) spec.endCard = input.endCard;
          if (input.notes !== undefined) spec.notes = input.notes;
          out.push(spec);
        }
      }
    }
  }
  return out;
};
