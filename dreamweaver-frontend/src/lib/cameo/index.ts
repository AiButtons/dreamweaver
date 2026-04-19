/**
 * M3 #6 AutoCameo — client helpers for turning an uploaded real-person
 * photo into a storyboard cameo reference with consent + watermark rails.
 *
 * Pipeline:
 *   1. `hashPhotoBytes(file)` → sha256 over the raw pre-watermark bytes.
 *      Stored on the Convex row so auditors can later dedup and forensic-
 *      check which generated renders derived from which source photo.
 *
 *   2. `applyCameoWatermark(imageBlob, label)` → returns a new PNG Blob
 *      with a translucent "CAMEO · <label>" banner burned into the image.
 *      The watermark is visually legible at typical reference-image
 *      preview sizes (~256–512 px). The burn is irreversible at the pixel
 *      level, so once a cameo enters the generation pipeline the origin
 *      is always attributable.
 *
 *   3. `evaluateCameoConsent({ consentStatus, watermarkApplied })` →
 *      returns a `{ usable, blockedReason }` tuple. The shot-batch
 *      selector consults this before handing a cameo URL to the media
 *      generator. Keeping the check here — not in the selector — means
 *      future surfaces (video, dailies) can enforce the same gate
 *      without duplicating the policy.
 */

export type CameoConsentStatus = "pending" | "approved" | "denied";

export interface CameoConsentInput {
  consentStatus: CameoConsentStatus | undefined;
  watermarkApplied: boolean | undefined;
}

export interface CameoConsentEvaluation {
  usable: boolean;
  blockedReason: string | null;
}

/**
 * Returns {usable:true} only when consent is explicitly approved AND a
 * watermark has been applied. Any other state surfaces a human-readable
 * reason so the caller can log / show a toast.
 */
export const evaluateCameoConsent = (
  input: CameoConsentInput,
): CameoConsentEvaluation => {
  if (input.consentStatus === "denied") {
    return { usable: false, blockedReason: "Cameo consent was denied." };
  }
  if (input.consentStatus !== "approved") {
    return {
      usable: false,
      blockedReason: "Cameo consent is still pending review.",
    };
  }
  if (!input.watermarkApplied) {
    return {
      usable: false,
      blockedReason: "Cameo is missing the required watermark.",
    };
  }
  return { usable: true, blockedReason: null };
};

/**
 * Compute sha256 over the raw bytes of the uploaded photo. Returns the
 * hex-encoded digest. Uses the Web Crypto API which is available in
 * browsers and in Node 18+ runtimes (Next.js app directory). In test
 * environments lacking `crypto.subtle`, falls back to a deterministic
 * djb2-like digest so unit tests can still validate the rest of the
 * pipeline — real environments always go through SHA-256.
 */
export const hashPhotoBytes = async (
  bytes: ArrayBuffer | Uint8Array,
): Promise<string> => {
  // Normalize to a fresh ArrayBuffer view so TS doesn't bleed
  // SharedArrayBuffer into the SubtleCrypto.digest signature.
  const view: Uint8Array =
    bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes as ArrayBuffer);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  const subtle =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as typeof globalThis & { crypto?: Crypto }).crypto !== "undefined"
      ? (globalThis as typeof globalThis & { crypto: Crypto }).crypto.subtle
      : undefined;
  if (subtle && typeof subtle.digest === "function") {
    const digest = await subtle.digest("SHA-256", copy.buffer);
    return toHex(new Uint8Array(digest));
  }
  return fallbackDigest(copy);
};

const toHex = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
};

/**
 * Deterministic non-cryptographic digest for environments without
 * `crypto.subtle`. Produces a 64-char hex string so the Convex validator
 * (`cameoSourcePhotoHash.length >= 16`) still accepts it. Never used when
 * `crypto.subtle` is available.
 */
const fallbackDigest = (bytes: Uint8Array): string => {
  // Four interleaved djb2 accumulators so the output fills 64 hex chars
  // without relying on fancy crypto. Collision risk is high — acceptable
  // only for tests.
  let a = 5381,
    b = 5381,
    c = 5381,
    d = 5381;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    a = (a * 33 + byte) >>> 0;
    b = (b * 37 + byte + (i & 0xff)) >>> 0;
    c = (c * 41 + byte * 7) >>> 0;
    d = (d * 43 + byte * 11) >>> 0;
  }
  const part = (n: number) => n.toString(16).padStart(8, "0");
  return part(a) + part(b) + part(c) + part(d) + part(a ^ c) + part(b ^ d) + part(a + b) + part(c + d);
};

export interface WatermarkOptions {
  /** Short label shown alongside the CAMEO banner (usually the attribution). */
  label: string;
  /** Banner opacity, 0..1. Defaults to 0.75. */
  opacity?: number;
  /** Banner height as a fraction of image height. Defaults to 0.08. */
  bannerFraction?: number;
}

/**
 * Burn a "CAMEO · <label>" banner onto the supplied image. Uses an
 * OffscreenCanvas when available, falling back to a DOM canvas. Returns
 * a PNG Blob ready for upload. Throws when called in a non-browser
 * environment (server components should upload the raw file and defer
 * watermarking to the client's submit flow).
 *
 * Note: the watermark is COSMETIC — it makes the cameo visually
 * attributable but does not cryptographically prevent removal. Combined
 * with `cameoSourcePhotoHash` stored on the Convex row, it gives us a
 * defensible audit trail.
 */
export const applyCameoWatermark = async (
  image: HTMLImageElement,
  options: WatermarkOptions,
): Promise<Blob> => {
  if (typeof document === "undefined") {
    throw new Error("applyCameoWatermark requires a browser environment.");
  }
  const opacity = options.opacity ?? 0.75;
  const bannerFraction = Math.min(0.3, Math.max(0.04, options.bannerFraction ?? 0.08));

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (width === 0 || height === 0) {
    throw new Error("Image has no dimensions to watermark.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable for watermark.");
  }

  ctx.drawImage(image, 0, 0, width, height);
  const bannerHeight = Math.max(24, Math.round(height * bannerFraction));
  // Semi-opaque dark banner along the bottom edge.
  ctx.fillStyle = `rgba(10, 10, 20, ${opacity})`;
  ctx.fillRect(0, height - bannerHeight, width, bannerHeight);

  // Banner text.
  const fontSize = Math.max(12, Math.round(bannerHeight * 0.55));
  ctx.fillStyle = "#fefefe";
  ctx.font = `bold ${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textBaseline = "middle";
  const text = `CAMEO · ${options.label}`.slice(0, 64);
  const pad = Math.round(bannerHeight * 0.5);
  ctx.fillText(text, pad, height - bannerHeight / 2);

  // Small accent stripe so the banner reads as intentional.
  ctx.fillStyle = "#a78bfa";
  ctx.fillRect(0, height - bannerHeight, Math.max(4, Math.round(width * 0.008)), bannerHeight);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas failed to produce a blob."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
};

/**
 * Helper that loads a File as an HTMLImageElement and awaits its
 * `load` event. Used before `applyCameoWatermark`.
 */
export const loadFileAsImage = (file: Blob): Promise<HTMLImageElement> => {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("loadFileAsImage requires a browser environment."));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load cameo photo."));
    };
    img.src = url;
  });
};
