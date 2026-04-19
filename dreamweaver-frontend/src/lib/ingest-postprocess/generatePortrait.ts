export const DEFAULT_PORTRAIT_TIMEOUT_MS = 90_000;

/**
 * Fire a POST to the in-process `/api/media/generate` route with optional
 * reference-image URLs (populated by M2 for the 3-view conditioning trick).
 * Returns the resolved URL or null on any failure — the caller decides how
 * to react (skip the row, surface an error event, etc.).
 */
export async function generatePortraitImage(options: {
  origin: string;
  prompt: string;
  cookieHeader: string | null;
  referenceImageUrls?: string[];
  timeoutMs?: number;
}): Promise<string | null> {
  const {
    origin,
    prompt,
    cookieHeader,
    referenceImageUrls,
    timeoutMs = DEFAULT_PORTRAIT_TIMEOUT_MS,
  } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${origin}/api/media/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: JSON.stringify({
        prompt,
        // Upper-case to match `Modality.IMAGE` in @/lib/llm/types. The route
        // does not case-normalize `type`, so "image" → 400 "Invalid type" and
        // every portrait silently dropped out of the pipeline.
        type: "IMAGE",
        config: { aspect_ratio: "9:16" },
        reference_image_urls:
          referenceImageUrls && referenceImageUrls.length > 0
            ? referenceImageUrls
            : undefined,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`portrait gen failed: ${res.status} ${text.slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { url?: string };
    return data.url && data.url.length > 0 ? data.url : null;
  } catch (err) {
    console.warn("portrait gen exception", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
