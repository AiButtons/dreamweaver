"use client";

import React, { useMemo, useState } from "react";
import { MoreHorizontal, Plus, Grid3x3 } from "lucide-react";
import { useQuery } from "convex/react";
import { queryRef } from "@/lib/convexRefs";
import type {
  AspectRatio,
  DeliveryPlatform,
  DeliveryStatus,
  DeliveryVariantSpec,
  StoryNode,
} from "@/app/storyboard/types";
import {
  ASPECT_RATIO_OPTIONS,
  COMMON_DELIVERY_DURATIONS_S,
  COMMON_DELIVERY_LOCALES,
  DELIVERY_PLATFORM_OPTIONS,
  DELIVERY_STATUS_OPTIONS,
} from "@/app/storyboard/types";
import { expandVariantMatrix, MATRIX_MAX_ROWS } from "@/lib/delivery-matrix";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { DeliveryVariantCallbacks } from "./PropertiesPanel";

interface DeliveryMatrixSectionProps {
  storyboardId?: string;
  node: StoryNode;
  callbacks?: DeliveryVariantCallbacks;
  disabled: boolean;
}

const STATUS_TONE_CLASS: Record<"neutral" | "info" | "success" | "muted" | "warn", string> = {
  neutral: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  info: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  muted: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  warn: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

/**
 * Delivery-variant surface for the currently selected node. Reads the
 * node's `activeImageId` / `activeVideoId` — those are the "masters". For
 * each master, renders a sub-panel with a variant table + add/matrix
 * actions. When `callbacks` is absent (e.g. storybook preview), the
 * controls render in a disabled state.
 */
export default function DeliveryMatrixSection({
  storyboardId,
  node,
  callbacks,
  disabled,
}: DeliveryMatrixSectionProps) {
  const activeImageId = node.data.media?.activeImageId;
  const activeVideoId = node.data.media?.activeVideoId;
  const imageEntry = activeImageId
    ? node.data.media?.images?.find((m) => m.id === activeImageId)
    : undefined;
  const videoEntry = activeVideoId
    ? node.data.media?.videos?.find((m) => m.id === activeVideoId)
    : undefined;

  if (!callbacks || !storyboardId) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card/30 p-4 text-xs text-muted-foreground">
        <div className="font-semibold text-foreground/80 mb-1">Delivery variants</div>
        <div>Not connected. Variant controls appear once the storyboard is loaded.</div>
      </div>
    );
  }

  if (!activeImageId && !activeVideoId) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card/30 p-4 text-xs text-muted-foreground">
        <div className="font-semibold text-foreground/80 mb-1">Delivery variants</div>
        <div>Generate an image or video master first to unlock delivery variants.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {activeImageId ? (
        <MasterVariantPanel
          title="Image master"
          storyboardId={storyboardId}
          masterId={activeImageId}
          masterUrl={imageEntry?.url}
          masterModelId={imageEntry?.modelId}
          callbacks={callbacks}
          disabled={disabled}
        />
      ) : null}
      {activeVideoId ? (
        <MasterVariantPanel
          title="Video master"
          storyboardId={storyboardId}
          masterId={activeVideoId}
          masterUrl={videoEntry?.url}
          masterModelId={videoEntry?.modelId}
          callbacks={callbacks}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}

interface VariantRow {
  id: string;
  masterAssetId: string;
  kind: "image" | "video";
  sourceUrl: string;
  modelId?: string;
  generationStatus: "pending" | "completed" | "failed" | "rolled_back";
  deliveryStatus: DeliveryStatus;
  variantSpec: DeliveryVariantSpec;
  createdAt: number;
  updatedAt: number;
}

function MasterVariantPanel({
  title,
  storyboardId,
  masterId,
  masterUrl,
  masterModelId,
  callbacks,
  disabled,
}: {
  title: string;
  storyboardId: string;
  masterId: string;
  masterUrl?: string;
  masterModelId?: string;
  callbacks: DeliveryVariantCallbacks;
  disabled: boolean;
}) {
  const variants = useQuery(queryRef("mediaAssets:listVariantsForMaster"), {
    storyboardId,
    masterAssetId: masterId,
  }) as VariantRow[] | undefined;

  const count = variants?.length ?? 0;

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {masterUrl ? (
            <a
              href={masterUrl}
              target="_blank"
              rel="noreferrer"
              className="h-10 w-10 rounded-md overflow-hidden bg-background/60 border border-border/60 shrink-0"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={masterUrl} alt="master" className="h-full w-full object-cover" />
            </a>
          ) : (
            <div className="h-10 w-10 rounded-md bg-background/60 border border-border/60 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate">{title}</div>
            <div className="text-[10px] text-muted-foreground font-mono truncate">
              {masterModelId ?? "(model unknown)"}
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {count} {count === 1 ? "variant" : "variants"}
          </Badge>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <AddVariantPopover
            storyboardId={storyboardId}
            masterId={masterId}
            disabled={disabled}
            onSubmit={callbacks.createVariant}
          />
          <AddMatrixPopover
            storyboardId={storyboardId}
            masterId={masterId}
            disabled={disabled}
            onSubmit={callbacks.createMatrix}
          />
        </div>
      </div>

      {variants === undefined ? (
        <div className="text-[11px] text-muted-foreground">Loading variants…</div>
      ) : variants.length === 0 ? (
        <div className="text-[11px] text-muted-foreground py-3 text-center border border-dashed border-border/50 rounded-md">
          No variants yet. Add one or spawn a matrix.
        </div>
      ) : (
        <div className="space-y-1">
          {variants.map((v) => (
            <VariantRowView
              key={v.id}
              variant={v}
              disabled={disabled}
              callbacks={callbacks}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VariantRowView({
  variant,
  disabled,
  callbacks,
}: {
  variant: VariantRow;
  disabled: boolean;
  callbacks: DeliveryVariantCallbacks;
}) {
  const statusOpt = DELIVERY_STATUS_OPTIONS.find((o) => o.value === variant.deliveryStatus)
    ?? DELIVERY_STATUS_OPTIONS[0];
  const spec = variant.variantSpec;

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5 text-[11px]">
      <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
        {spec.aspect ? <Chip>{spec.aspect}</Chip> : null}
        {spec.durationS !== undefined ? <Chip>{spec.durationS}s</Chip> : null}
        {spec.locale ? <Chip>{spec.locale}</Chip> : null}
        {spec.platform ? <Chip>{spec.platform}</Chip> : null}
        {spec.abLabel ? <Chip>{spec.abLabel}</Chip> : null}
        {!spec.aspect && spec.durationS === undefined && !spec.locale && !spec.platform && !spec.abLabel ? (
          <span className="text-muted-foreground italic">unconfigured</span>
        ) : null}
      </div>
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] shrink-0",
          STATUS_TONE_CLASS[statusOpt.tone],
        )}
      >
        {statusOpt.label}
      </span>
      <VariantRowMenu variant={variant} disabled={disabled} callbacks={callbacks} />
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px]">
      {children}
    </span>
  );
}

function VariantRowMenu({
  variant,
  disabled,
  callbacks,
}: {
  variant: VariantRow;
  disabled: boolean;
  callbacks: DeliveryVariantCallbacks;
}) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={disabled}>
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="text-xs">
          <DropdownMenuItem onSelect={() => setStatusOpen(true)}>Set status…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPasteOpen(true)}>Paste source URL…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => callbacks.promote({ mediaAssetId: variant.id })}>
            Promote to master
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => callbacks.archive({ mediaAssetId: variant.id })}
            className="text-rose-300 focus:text-rose-200"
          >
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover open={pasteOpen} onOpenChange={setPasteOpen}>
        <PopoverTrigger asChild>
          <span />
        </PopoverTrigger>
        <PopoverContent side="left" className="w-64 space-y-2 text-xs">
          <div className="font-semibold">Attach source URL</div>
          <Input
            value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)}
            placeholder="https://…"
            className="h-8"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7"
              disabled={!pasteUrl.trim()}
              onClick={async () => {
                await callbacks.attachSource({
                  mediaAssetId: variant.id,
                  sourceUrl: pasteUrl.trim(),
                });
                setPasteUrl("");
                setPasteOpen(false);
              }}
            >
              Attach
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Popover open={statusOpen} onOpenChange={setStatusOpen}>
        <PopoverTrigger asChild>
          <span />
        </PopoverTrigger>
        <PopoverContent side="left" className="w-56 space-y-1 text-xs">
          <div className="font-semibold mb-1">Set delivery status</div>
          {DELIVERY_STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={async () => {
                await callbacks.updateStatus({
                  mediaAssetId: variant.id,
                  deliveryStatus: opt.value,
                });
                setStatusOpen(false);
              }}
              className={cn(
                "w-full text-left rounded-md border px-2 py-1 text-[11px]",
                STATUS_TONE_CLASS[opt.tone],
                opt.value === variant.deliveryStatus && "ring-1 ring-primary/40",
              )}
            >
              {opt.label}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </>
  );
}

function AddVariantPopover({
  storyboardId,
  masterId,
  disabled,
  onSubmit,
}: {
  storyboardId: string;
  masterId: string;
  disabled: boolean;
  onSubmit: DeliveryVariantCallbacks["createVariant"];
}) {
  const [open, setOpen] = useState(false);
  const [aspect, setAspect] = useState<AspectRatio | "">("");
  const [durationS, setDurationS] = useState<string>("");
  const [locale, setLocale] = useState("");
  const [abLabel, setAbLabel] = useState("");
  const [platform, setPlatform] = useState<DeliveryPlatform | "">("");
  const [endCard, setEndCard] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");

  const reset = () => {
    setAspect("");
    setDurationS("");
    setLocale("");
    setAbLabel("");
    setPlatform("");
    setEndCard("");
    setSourceUrl("");
  };

  const handleSubmit = async () => {
    const spec: DeliveryVariantSpec = {};
    if (aspect) spec.aspect = aspect as AspectRatio;
    const parsedDuration = durationS.trim() ? Number(durationS) : NaN;
    if (Number.isFinite(parsedDuration)) spec.durationS = parsedDuration;
    if (locale.trim()) spec.locale = locale.trim();
    if (abLabel.trim()) spec.abLabel = abLabel.trim();
    if (platform) spec.platform = platform as DeliveryPlatform;
    if (endCard.trim()) spec.endCard = endCard.trim();

    await onSubmit({
      storyboardId,
      masterAssetId: masterId,
      variantSpec: spec,
      sourceUrl: sourceUrl.trim() || undefined,
    });
    reset();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" disabled={disabled}>
          <Plus className="size-3" /> Variant
        </Button>
      </PopoverTrigger>
      <PopoverContent side="left" className="w-72 space-y-2 text-xs">
        <div className="font-semibold">Add variant</div>
        <PopField label="Aspect">
          <select
            value={aspect}
            onChange={(e) => setAspect(e.target.value as AspectRatio | "")}
            className="w-full rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[11px]"
          >
            <option value="">—</option>
            {ASPECT_RATIO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} · {o.context}
              </option>
            ))}
          </select>
        </PopField>
        <PopField label="Duration (s)">
          <Input
            type="number"
            min={0}
            value={durationS}
            onChange={(e) => setDurationS(e.target.value)}
            className="h-7 text-[11px]"
          />
        </PopField>
        <PopField label="Locale">
          <Input
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            list={`locales-${masterId}`}
            placeholder="en-US"
            className="h-7 text-[11px]"
          />
          <datalist id={`locales-${masterId}`}>
            {COMMON_DELIVERY_LOCALES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </datalist>
        </PopField>
        <PopField label="A/B label">
          <Input
            value={abLabel}
            onChange={(e) => setAbLabel(e.target.value)}
            placeholder="A"
            className="h-7 text-[11px]"
          />
        </PopField>
        <PopField label="Platform">
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as DeliveryPlatform | "")}
            className="w-full rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[11px]"
          >
            <option value="">—</option>
            {DELIVERY_PLATFORM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </PopField>
        <PopField label="End card">
          <Input
            value={endCard}
            onChange={(e) => setEndCard(e.target.value)}
            placeholder="logo_v2.png"
            className="h-7 text-[11px]"
          />
        </PopField>
        <PopField label="Source URL (optional)">
          <Input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
            className="h-7 text-[11px]"
          />
        </PopField>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" className="h-7" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" className="h-7" onClick={handleSubmit}>
            Add
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PopField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      {children}
    </div>
  );
}

function AddMatrixPopover({
  storyboardId,
  masterId,
  disabled,
  onSubmit,
}: {
  storyboardId: string;
  masterId: string;
  disabled: boolean;
  onSubmit: DeliveryVariantCallbacks["createMatrix"];
}) {
  const [open, setOpen] = useState(false);
  const [aspects, setAspects] = useState<AspectRatio[]>([]);
  const [durations, setDurations] = useState<number[]>([]);
  const [locales, setLocales] = useState<string[]>([]);
  const [abText, setAbText] = useState("");
  const [platform, setPlatform] = useState<DeliveryPlatform | "">("");
  const [notes, setNotes] = useState("");

  const abLabels = useMemo(
    () =>
      abText
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    [abText],
  );

  const { count, error } = useMemo(() => {
    try {
      const rows = expandVariantMatrix({
        aspects: aspects.length ? aspects : undefined,
        durationsS: durations.length ? durations : undefined,
        locales: locales.length ? locales : undefined,
        abLabels: abLabels.length ? abLabels : undefined,
        platform: platform || undefined,
        notes: notes.trim() || undefined,
      });
      return { count: rows.length, error: null as string | null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { count: 0, error: message };
    }
  }, [aspects, durations, locales, abLabels, platform, notes]);

  const toggleAspect = (value: AspectRatio) => {
    setAspects((cur) => (cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]));
  };
  const toggleDuration = (value: number) => {
    setDurations((cur) => (cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]));
  };
  const toggleLocale = (value: string) => {
    setLocales((cur) => (cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]));
  };

  const reset = () => {
    setAspects([]);
    setDurations([]);
    setLocales([]);
    setAbText("");
    setPlatform("");
    setNotes("");
  };

  const canSubmit = !error && count > 0 && count <= MATRIX_MAX_ROWS;

  const handleSubmit = async () => {
    await onSubmit({
      storyboardId,
      masterAssetId: masterId,
      matrix: {
        aspects: aspects.length ? aspects : undefined,
        durationsS: durations.length ? durations : undefined,
        locales: locales.length ? locales : undefined,
        abLabels: abLabels.length ? abLabels : undefined,
        platform: platform || undefined,
        notes: notes.trim() || undefined,
      },
    });
    reset();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" disabled={disabled}>
          <Grid3x3 className="size-3" /> Matrix…
        </Button>
      </PopoverTrigger>
      <PopoverContent side="left" className="w-96 space-y-3 text-xs">
        <div className="font-semibold">Spawn variant matrix</div>

        <PopField label="Aspect ratios">
          <div className="grid grid-cols-2 gap-1">
            {ASPECT_RATIO_OPTIONS.map((o) => (
              <label
                key={o.value}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] cursor-pointer",
                  aspects.includes(o.value)
                    ? "border-primary/50 bg-primary/15"
                    : "border-border/60 bg-background/60",
                )}
              >
                <input
                  type="checkbox"
                  checked={aspects.includes(o.value)}
                  onChange={() => toggleAspect(o.value)}
                />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
          </div>
        </PopField>

        <PopField label="Durations (s)">
          <div className="flex flex-wrap gap-1">
            {COMMON_DELIVERY_DURATIONS_S.map((d) => (
              <label
                key={d}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] cursor-pointer",
                  durations.includes(d)
                    ? "border-primary/50 bg-primary/15"
                    : "border-border/60 bg-background/60",
                )}
              >
                <input
                  type="checkbox"
                  checked={durations.includes(d)}
                  onChange={() => toggleDuration(d)}
                />
                <span>{d}s</span>
              </label>
            ))}
          </div>
        </PopField>

        <PopField label="Locales">
          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
            {COMMON_DELIVERY_LOCALES.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => toggleLocale(l.value)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px]",
                  locales.includes(l.value)
                    ? "border-primary/50 bg-primary/15 text-foreground"
                    : "border-border/60 bg-background/60 text-muted-foreground",
                )}
              >
                {l.value}
              </button>
            ))}
          </div>
        </PopField>

        <PopField label="A/B labels (comma-separated)">
          <Input
            value={abText}
            onChange={(e) => setAbText(e.target.value)}
            placeholder="A, B"
            className="h-7 text-[11px]"
          />
        </PopField>

        <PopField label="Platform">
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as DeliveryPlatform | "")}
            className="w-full rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[11px]"
          >
            <option value="">—</option>
            {DELIVERY_PLATFORM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </PopField>

        <PopField label="Notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[48px] text-[11px] bg-background/60"
          />
        </PopField>

        <div
          className={cn(
            "rounded-md border px-2 py-1.5 text-[11px]",
            error
              ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
              : count === 0
                ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
          )}
        >
          {error ? error : `Will create ${count} ${count === 1 ? "variant" : "variants"}.`}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" className="h-7" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" className="h-7" disabled={!canSubmit} onClick={handleSubmit}>
            Spawn
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
