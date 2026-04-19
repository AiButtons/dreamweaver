"use client";

/**
 * M3 #6 — AutoCameo upload dialog. The producer picks a real-person
 * photo, records who the subject is (attribution), ticks a consent
 * checkbox, and previews the watermark before submitting.
 *
 * Safety rails enforced here (client-side) + in Convex mutation (server):
 *   1. Attribution text is mandatory.
 *   2. Consent checkbox must be ticked.
 *   3. Watermark is applied + visually confirmed in the preview BEFORE
 *      the producer can submit.
 *   4. sha256 of the pre-watermark bytes is recorded for forensic audit.
 *   5. The server mutation refuses `watermarkApplied: false`.
 */

import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, UploadCloud, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  applyCameoWatermark,
  hashPhotoBytes,
  loadFileAsImage,
} from "@/lib/cameo";

export interface CameoUploadDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Identity packs the producer can attach the cameo to. */
  packOptions: Array<{ packRowId: string; packName: string }>;
  /** Called once the producer submits a validated cameo. */
  onSubmit: (payload: {
    ownerPackId: string;
    watermarkedDataUrl: string;
    attributionText: string;
    cameoSourcePhotoHash: string;
    watermarkApplied: true;
    consentStatus: "approved";
  }) => Promise<void>;
}

export function CameoUploadDialog({
  open,
  onOpenChange,
  packOptions,
  onSubmit,
}: CameoUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [attribution, setAttribution] = useState<string>("");
  const [consentChecked, setConsentChecked] = useState<boolean>(false);
  const [packRowId, setPackRowId] = useState<string>("");
  const [watermarkedPreviewUrl, setWatermarkedPreviewUrl] = useState<string | null>(null);
  const [watermarkedDataUrl, setWatermarkedDataUrl] = useState<string | null>(null);
  const [sourceHash, setSourceHash] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the dialog closes so the next open is clean.
  useEffect(() => {
    if (open) return;
    setFile(null);
    setAttribution("");
    setConsentChecked(false);
    setPackRowId("");
    setWatermarkedPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setWatermarkedDataUrl(null);
    setSourceHash(null);
    setError(null);
    setBusy(false);
  }, [open]);

  // Default the pack selection to the first option once we know them.
  useEffect(() => {
    if (!packRowId && packOptions.length > 0) {
      setPackRowId(packOptions[0].packRowId);
    }
  }, [packOptions, packRowId]);

  const computeWatermarkPreview = useCallback(async () => {
    if (!file) return;
    const label = attribution.trim();
    if (label.length === 0) {
      setError("Enter the attribution label before previewing the watermark.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Hash BEFORE watermark so the digest represents the original bytes.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await hashPhotoBytes(bytes);
      setSourceHash(hash);

      const img = await loadFileAsImage(file);
      const watermarked = await applyCameoWatermark(img, { label });
      const dataUrl = await blobToDataUrl(watermarked);
      setWatermarkedDataUrl(dataUrl);

      setWatermarkedPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(watermarked);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build watermark.");
    } finally {
      setBusy(false);
    }
  }, [attribution, file]);

  const canSubmit =
    Boolean(packRowId) &&
    Boolean(file) &&
    attribution.trim().length > 0 &&
    consentChecked &&
    Boolean(watermarkedDataUrl) &&
    Boolean(sourceHash) &&
    !busy;

  const submit = async () => {
    if (!canSubmit || !watermarkedDataUrl || !sourceHash) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        ownerPackId: packRowId,
        watermarkedDataUrl,
        attributionText: attribution.trim(),
        cameoSourcePhotoHash: sourceHash,
        watermarkApplied: true,
        consentStatus: "approved",
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save cameo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add AutoCameo reference</DialogTitle>
          <DialogDescription>
            Upload a photo of a real person to use as a cameo reference for a
            character. Consent is required — we watermark every cameo image
            before it enters the generation pipeline.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cameo-pack">Target character pack</Label>
            {packOptions.length === 0 ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
                Create at least one identity pack before adding a cameo.
              </div>
            ) : (
              <select
                id="cameo-pack"
                value={packRowId}
                onChange={(e) => setPackRowId(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                disabled={busy}
              >
                {packOptions.map((opt) => (
                  <option key={opt.packRowId} value={opt.packRowId}>
                    {opt.packName}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cameo-file">Photo</Label>
            <Input
              id="cameo-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const next = e.target.files?.[0] ?? null;
                setFile(next);
                setWatermarkedDataUrl(null);
                setSourceHash(null);
                setWatermarkedPreviewUrl((prev) => {
                  if (prev) URL.revokeObjectURL(prev);
                  return null;
                });
              }}
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cameo-attribution">Attribution (required)</Label>
            <Input
              id="cameo-attribution"
              type="text"
              placeholder="e.g. Photo of Jane Doe, used with permission"
              value={attribution}
              onChange={(e) => setAttribution(e.target.value)}
              disabled={busy}
            />
            <p className="text-[11px] text-muted-foreground">
              Burned into the watermark banner. Keep it short — max 64 chars.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start gap-2"
            onClick={() => void computeWatermarkPreview()}
            disabled={!file || attribution.trim().length === 0 || busy}
          >
            <UploadCloud className="size-4" />
            {watermarkedPreviewUrl ? "Rebuild watermark preview" : "Preview watermark"}
          </Button>

          {watermarkedPreviewUrl ? (
            <div className="rounded-md border border-border/60 bg-background/80 p-2">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-emerald-300">
                <CheckCircle2 className="size-3.5" />
                Watermark applied. Preview below matches what the pipeline will see.
              </div>
              <img
                src={watermarkedPreviewUrl}
                alt="Watermarked cameo preview"
                className="max-h-64 w-full rounded-md object-contain"
              />
            </div>
          ) : null}

          <label className="flex items-start gap-2 text-[12px] text-muted-foreground">
            <Checkbox
              checked={consentChecked}
              onCheckedChange={(v) => setConsentChecked(Boolean(v))}
              disabled={busy}
              className="mt-0.5"
            />
            <span>
              I confirm I have the depicted person&apos;s explicit permission to
              use this photo as a storyboard reference. I understand that the
              pipeline will burn a visible watermark into every generated shot
              derived from this image.
            </span>
          </label>

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
              <AlertTriangle className="size-4" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="gap-1.5"
          >
            <X className="size-4" />
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {busy ? "Saving…" : "Save cameo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Unexpected FileReader result type."));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed."));
    reader.readAsDataURL(blob);
  });
