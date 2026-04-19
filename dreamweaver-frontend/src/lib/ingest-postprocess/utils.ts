import type { CharacterFacing, PythonIngestedCharacter } from "./types";

/**
 * Recursively replace `null` with `undefined` so Convex `v.optional(...)`
 * validators accept the payload. Python serializes unset `Optional[str]`
 * fields as JSON `null`, but Convex treats `null` as a distinct value from
 * "absent" and rejects it.
 */
export const stripNulls = <T>(value: T): T => {
  if (value === null) return undefined as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => stripNulls(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const scrubbed = stripNulls(raw);
      if (scrubbed !== undefined) out[key] = scrubbed;
    }
    return out as T;
  }
  return value;
};

/**
 * Serialize a character's features into a compact JSON blob for the
 * identity pack's `dnaJson` column. Caps the text summary at 500 chars so
 * the payload stays lean even for verbose descriptions.
 */
export const cheapDnaFromCharacter = (c: PythonIngestedCharacter): string => {
  const tokens = [c.staticFeatures, c.dynamicFeatures]
    .filter((s) => s && s.length > 0)
    .join(" ");
  return JSON.stringify({
    sourceIdentifier: c.identifier,
    staticFeatures: c.staticFeatures,
    dynamicFeatures: c.dynamicFeatures,
    textSummary: tokens.slice(0, 500),
  });
};

/**
 * Compose a stable `(characterId, view)` → url lookup key. Exposed so the
 * post-processor and any callers that need to resolve references share
 * the exact same encoding.
 */
export const portraitKey = (characterId: string, view: string): string =>
  `${characterId}::${view}`;

/**
 * Shared SSE frame formatter. Used by the streaming route's ReadableStream
 * controller and by Python bridge code that wants to pre-encode frames.
 */
export const sseFrame = (eventType: string, data: unknown): string =>
  `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Flatten the Python-emitted `characterFacings` record into the parallel-
 * array shape Convex's `bulkCreateNodes` validator accepts.
 *
 * Rules (loose end #4):
 *   - Drop entries whose characterId isn't in the shot's character list.
 *   - Drop entries whose value is `null` / undefined / the "unknown"
 *     sentinel (Python already does this, but be defensive at the wire
 *     boundary so a misbehaving ingester can't corrupt the Convex row).
 *   - Preserve iteration order of the input record (V8 keeps insertion
 *     order for string keys, which aligns with ff_vis_char_idxs order).
 *   - Return `undefined` when the resulting array would be empty so the
 *     caller can drop the field from the payload entirely.
 */
export const flattenCharacterFacings = (
  facings: Record<string, CharacterFacing> | null | undefined,
  characterIds: readonly string[] | undefined,
): Array<{ characterId: string; facing: CharacterFacing }> | undefined => {
  if (!facings) return undefined;
  const allowed = characterIds && characterIds.length > 0 ? new Set(characterIds) : null;
  const out: Array<{ characterId: string; facing: CharacterFacing }> = [];
  for (const [characterId, facing] of Object.entries(facings)) {
    if (!facing) continue;
    if ((facing as string) === "unknown") continue;
    if (allowed && !allowed.has(characterId)) continue;
    out.push({ characterId, facing });
  }
  return out.length > 0 ? out : undefined;
};
