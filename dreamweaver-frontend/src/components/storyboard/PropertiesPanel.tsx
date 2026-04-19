"use client";

import React, { useMemo, useState } from "react";
import { ImageIcon, Video, Music, Sparkles, Wand2, Settings2 } from "lucide-react";
import { MediaType } from "@/app/storyboard/types";
import type {
  AspectRatio,
  CameraMove,
  DeliveryStatus,
  DeliveryVariantSpec,
  ScreenDirection,
  ShotAngle,
  ShotMeta,
  ShotSize,
  StoryEdge,
  StoryNode,
  StoryboardMediaConfig,
  UserIdentity,
  VoiceName,
} from "@/app/storyboard/types";
import DeliveryMatrixSection from "@/components/storyboard/DeliveryMatrixSection";
import ReviewPanel, { type ReviewCallbacks } from "@/components/storyboard/ReviewPanel";
import {
  ASPECT_RATIO_OPTIONS,
  CAMERA_MOVE_OPTIONS,
  LENS_MM_PRESETS,
  SHOT_ANGLE_OPTIONS,
  SHOT_SIZE_OPTIONS,
} from "@/app/storyboard/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export interface DeliveryVariantCallbacks {
  createVariant: (args: {
    storyboardId: string;
    masterAssetId: string;
    variantSpec: DeliveryVariantSpec;
    sourceUrl?: string;
    modelId?: string;
  }) => Promise<unknown>;
  createMatrix: (args: {
    storyboardId: string;
    masterAssetId: string;
    matrix: {
      aspects?: AspectRatio[];
      durationsS?: number[];
      locales?: string[];
      abLabels?: string[];
      platform?: DeliveryVariantSpec["platform"];
      endCard?: string;
      notes?: string;
    };
  }) => Promise<unknown>;
  updateSpec: (args: { mediaAssetId: string; variantSpec: DeliveryVariantSpec }) => Promise<unknown>;
  updateStatus: (args: { mediaAssetId: string; deliveryStatus: DeliveryStatus }) => Promise<unknown>;
  attachSource: (args: { mediaAssetId: string; sourceUrl: string; modelId?: string }) => Promise<unknown>;
  archive: (args: { mediaAssetId: string }) => Promise<unknown>;
  promote: (args: { mediaAssetId: string }) => Promise<unknown>;
}

interface PropertiesPanelProps {
  selectedNode: StoryNode | null;
  nodes?: StoryNode[];
  edges?: StoryEdge[];
  storyboardId?: string;
  onGenerateMedia: (nodeId: string, type: MediaType, prompt: string, config: StoryboardMediaConfig) => void;
  onEditNode: (nodeId: string, instruction: string) => void;
  onUpdateShotMeta?: (nodeId: string, next: ShotMeta) => void;
  deliveryVariantCallbacks?: DeliveryVariantCallbacks;
  userIdentity?: UserIdentity | null;
  reviewCallbacks?: ReviewCallbacks;
  isProcessing: boolean;
  onClose: () => void;
}

const defaultNegativePrompt =
  "full body shot, wide shot, distant, rotation of subject, spinning person, morphing, distortion";

const IMAGE_MODEL_OPTIONS: { id: string; name: string; description: string }[] = [
  { id: "zennah-image-gen", name: "Zennah Image Gen", description: "Cinematic, camera-aware (Modal)" },
  { id: "zennah-qwen-edit", name: "Zennah Multi-Angle", description: "Consistent multi-angle edits" },
  { id: "zennah-qwen-multiview", name: "Zennah Multi-View", description: "Auto 3-angle (LoRA)" },
  { id: "gpt-image-1", name: "GPT Image 1.5", description: "OpenAI flagship w/ editing" },
  { id: "dall-e-3", name: "DALL·E 3", description: "OpenAI high-quality" },
];

const VIDEO_MODEL_OPTIONS: { id: string; name: string; description: string }[] = [
  { id: "ltx-2.3", name: "LTX-2.3", description: "Lightricks 22B — I2V + keyframe + retake" },
  { id: "ltx-2", name: "LTX-2", description: "Legacy Lightricks LTX-2" },
  { id: "veo-3.1", name: "Veo 3.1", description: "Google DeepMind (coming soon)" },
];

function getNextNode(currentId: string, nodes: StoryNode[], edges: StoryEdge[]) {
  const edge = edges.find((e) => e.source === currentId);
  if (!edge) return null;
  return nodes.find((n) => n.id === edge.target) ?? null;
}

export default function PropertiesPanel({
  selectedNode,
  nodes = [],
  edges = [],
  storyboardId,
  onGenerateMedia,
  onEditNode,
  onUpdateShotMeta,
  deliveryVariantCallbacks,
  userIdentity,
  reviewCallbacks,
  isProcessing,
  onClose,
}: PropertiesPanelProps) {
  const [tab, setTab] = useState<"shot" | "media" | "delivery" | "review" | "continuity" | "advanced">("media");
  const tabTriggerClass =
    "border border-transparent text-muted-foreground data-[state=active]:border-primary/40 data-[state=active]:bg-primary/15 data-[state=active]:text-foreground";

  const [mediaType, setMediaType] = useState<MediaType>(MediaType.IMAGE);
  const [promptOverride, setPromptOverride] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);

  // Media config
  const [style, setStyle] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [negativePrompt, setNegativePrompt] = useState(defaultNegativePrompt);
  const [voice, setVoice] = useState<VoiceName>("Kore");
  const [duration, setDuration] = useState("5");
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [slowMotion, setSlowMotion] = useState(false);
  const [enhancePrompt, setEnhancePrompt] = useState(false);
  const [cameraMovement, setCameraMovement] = useState("static");

  // Per-node model overrides.
  const [imageModelId, setImageModelId] = useState<string>("zennah-image-gen");
  const [videoModelId, setVideoModelId] = useState<string>("ltx-2.3");

  const [rewriteInstruction, setRewriteInstruction] = useState("");

  const promptPreview = useMemo(() => {
    if (!selectedNode) return "";
    return (promptOverride.trim() ? promptOverride.trim() : selectedNode.data.segment).trim();
  }, [promptOverride, selectedNode]);

  if (!selectedNode) return null;
  const { id, data } = selectedNode;
  const nextNode = getNextNode(id, nodes, edges);
  const endImage = nextNode?.data?.image;

  const continuityBadge =
    data.continuity.consistencyStatus === "ok"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/20"
      : data.continuity.consistencyStatus === "warning"
        ? "bg-amber-500/15 text-amber-200 border-amber-500/20"
        : "bg-rose-500/15 text-rose-200 border-rose-500/20";

  const handleGenerate = () => {
    let config: StoryboardMediaConfig = {};
    if (mediaType === MediaType.AUDIO) {
      config = { voice };
    }
    if (mediaType === MediaType.IMAGE) {
      config = { style, aspectRatio, inputImage: data.image, imageModelId };
    }
    if (mediaType === MediaType.VIDEO) {
      config = {
        aspectRatio,
        negativePrompt,
        startImage: data.image,
        endImage,
        audioEnabled,
        slowMotion,
        duration: Number(duration),
        videoModelId,
        enhancePrompt: videoModelId === "ltx-2.3" ? enhancePrompt : undefined,
        cameraMovement,
      };
    }

    onGenerateMedia(id, mediaType, promptPreview, config);
  };

  const handleRewrite = () => {
    if (!rewriteInstruction.trim()) return;
    onEditNode(id, rewriteInstruction.trim());
    setRewriteInstruction("");
  };

  return (
    <div className="h-full w-full">
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border/60">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold truncate">{data.label}</div>
            <Badge variant="secondary" className="text-[10px]">
              {data.nodeType}
            </Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{data.segment}</div>
        </div>
        <Button variant="ghost" size="sm" className="h-8" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="p-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid w-full grid-cols-6 bg-background/70 border border-border/70 p-1">
            <TabsTrigger value="shot" className={tabTriggerClass}>Shot</TabsTrigger>
            <TabsTrigger value="media" className={tabTriggerClass}>Media</TabsTrigger>
            <TabsTrigger value="delivery" className={tabTriggerClass}>Delivery</TabsTrigger>
            <TabsTrigger value="review" className={tabTriggerClass}>Review</TabsTrigger>
            <TabsTrigger value="continuity" className={tabTriggerClass}>Continuity</TabsTrigger>
            <TabsTrigger value="advanced" className={tabTriggerClass}>Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="shot" className="mt-4 space-y-4">
            <ShotMetaForm
              nodeId={id}
              shotMeta={data.shotMeta}
              onUpdateShotMeta={onUpdateShotMeta}
              disabled={isProcessing}
            />

            <div className="rounded-xl border border-border/60 bg-card/40 p-3">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Rewrite Node
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Give a director-style instruction. The agent will propose an edit.
              </div>
              <div className="mt-3 flex gap-2">
                <Input
                  value={rewriteInstruction}
                  onChange={(e) => setRewriteInstruction(e.target.value)}
                  placeholder='e.g. "Make this more tense and add a reveal at the end."'
                  className="bg-background/60"
                  disabled={isProcessing}
                />
                <Button onClick={handleRewrite} disabled={!rewriteInstruction.trim() || isProcessing} className="gap-2">
                  <Wand2 className="size-4" />
                  Rewrite
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-card/40 p-3">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Selected
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-background/60 border border-border/60 px-3 py-2">
                  <div className="text-[10px] text-muted-foreground">Type</div>
                  <div className="mt-0.5 font-medium">{data.nodeType}</div>
                </div>
                <div className="rounded-lg bg-background/60 border border-border/60 px-3 py-2">
                  <div className="text-[10px] text-muted-foreground">Continuity</div>
                  <div className={cn("mt-0.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px]", continuityBadge)}>
                    {data.continuity.consistencyStatus}
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="media" className="mt-4 space-y-4">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Output Type
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "h-12 gap-2 justify-start border border-border/70 bg-background/40 hover:bg-background/70",
                  mediaType === MediaType.IMAGE
                    && "border-primary/50 bg-primary/15 text-foreground shadow-[inset_0_0_0_1px_rgba(163,230,53,0.32)]",
                )}
                onClick={() => setMediaType(MediaType.IMAGE)}
                aria-pressed={mediaType === MediaType.IMAGE}
              >
                <ImageIcon className="size-4" /> Image
              </Button>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "h-12 gap-2 justify-start border border-border/70 bg-background/40 hover:bg-background/70",
                  mediaType === MediaType.VIDEO
                    && "border-primary/50 bg-primary/15 text-foreground shadow-[inset_0_0_0_1px_rgba(163,230,53,0.32)]",
                )}
                onClick={() => setMediaType(MediaType.VIDEO)}
                aria-pressed={mediaType === MediaType.VIDEO}
              >
                <Video className="size-4" /> Video
              </Button>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "h-12 gap-2 justify-start border border-border/70 bg-background/40 hover:bg-background/70",
                  mediaType === MediaType.AUDIO
                    && "border-primary/50 bg-primary/15 text-foreground shadow-[inset_0_0_0_1px_rgba(163,230,53,0.32)]",
                )}
                onClick={() => setMediaType(MediaType.AUDIO)}
                aria-pressed={mediaType === MediaType.AUDIO}
              >
                <Music className="size-4" /> Audio
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              {mediaType === MediaType.IMAGE
                ? "Still frame generation for scene and shot look development."
                : mediaType === MediaType.VIDEO
                  ? "Motion preview generation with optional audio and continuity directives."
                  : "Voice scratch track for timing and story beats."}
            </div>

            <Collapsible open={promptOpen} onOpenChange={setPromptOpen}>
              <div className="rounded-xl border border-border/60 bg-card/40 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Prompt
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                      {promptOpen ? "Hide" : "Edit"}
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <div className="mt-2 text-xs text-muted-foreground line-clamp-3">
                  {promptPreview}
                </div>
                <CollapsibleContent className="mt-3 space-y-2">
                  <Textarea
                    value={promptOverride}
                    onChange={(e) => setPromptOverride(e.target.value)}
                    placeholder={data.segment}
                    className="min-h-[92px] bg-background/60"
                    disabled={isProcessing}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => setPromptOverride("")}
                    disabled={isProcessing || !promptOverride}
                  >
                    Use node text
                  </Button>
                </CollapsibleContent>
              </div>
            </Collapsible>

            {mediaType === MediaType.IMAGE ? (
              <ModelPicker
                label="Image Model"
                options={IMAGE_MODEL_OPTIONS}
                value={imageModelId}
                onChange={setImageModelId}
                disabled={isProcessing}
              />
            ) : null}

            {mediaType === MediaType.VIDEO ? (
              <ModelPicker
                label="Video Model"
                options={VIDEO_MODEL_OPTIONS}
                value={videoModelId}
                onChange={setVideoModelId}
                disabled={isProcessing}
              />
            ) : null}

            <Button onClick={handleGenerate} disabled={isProcessing} className="w-full h-11 gap-2">
              <Sparkles className="size-4" />
              {mediaType === MediaType.IMAGE ? "Generate Image" : mediaType === MediaType.VIDEO ? "Generate Video" : "Generate Audio"}
            </Button>
          </TabsContent>

          <TabsContent value="delivery" className="mt-4 space-y-4">
            <DeliveryMatrixSection
              storyboardId={storyboardId}
              node={selectedNode}
              callbacks={deliveryVariantCallbacks}
              disabled={isProcessing}
            />
          </TabsContent>

          <TabsContent value="review" className="mt-4 space-y-4">
            <ReviewPanel
              storyboardId={storyboardId}
              selectedNode={selectedNode}
              userIdentity={userIdentity}
              callbacks={reviewCallbacks}
            />
          </TabsContent>

          <TabsContent value="continuity" className="mt-4 space-y-4">
            <div className="rounded-xl border border-border/60 bg-card/40 p-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Rolling History
                </div>
                <div className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px]", continuityBadge)}>
                  {data.continuity.consistencyStatus}
                </div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">
                {data.historyContext.rollingSummary || "No rolling history summary yet."}
              </div>
              <Separator className="my-3" />
              <div className="text-[11px] text-muted-foreground">
                lineage: <span className="text-foreground/80">{data.historyContext.lineageHash || "pending"}</span>
                {"  "}· tokens:{" "}
                <span className="text-foreground/80">{data.historyContext.tokenBudgetUsed}</span>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="advanced" className="mt-4 space-y-4">
            <div className="rounded-xl border border-border/60 bg-card/40 p-3">
              <div className="flex items-center gap-2">
                <Settings2 className="size-4 text-muted-foreground" />
                <div className="text-sm font-semibold">Advanced</div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Optional controls for camera, motion, and negatives.
              </div>
            </div>

            {mediaType === MediaType.IMAGE ? (
              <div className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-3">
                <Field label="Aspect ratio">
                  <Input value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} disabled={isProcessing} />
                </Field>
                <Field label="Style">
                  <Input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="e.g. cinematic, anamorphic" disabled={isProcessing} />
                </Field>
              </div>
            ) : null}

            {mediaType === MediaType.VIDEO ? (
              <div className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-3">
                <Field label="Aspect ratio">
                  <Input value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} disabled={isProcessing} />
                </Field>
                <Field label="Negative prompt">
                  <Textarea
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    className="min-h-[80px] bg-background/60"
                    disabled={isProcessing}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Toggle
                    label="Audio"
                    value={audioEnabled}
                    onChange={setAudioEnabled}
                    disabled={isProcessing}
                  />
                  <Toggle
                    label="Slow motion"
                    value={slowMotion}
                    onChange={setSlowMotion}
                    disabled={isProcessing}
                  />
                </div>
                <Field label="Duration (seconds)">
                  <Input value={duration} onChange={(e) => setDuration(e.target.value)} disabled={isProcessing} />
                </Field>
                <Field label="Camera movement">
                  <Input
                    value={cameraMovement}
                    onChange={(e) => setCameraMovement(e.target.value)}
                    placeholder="static, pan-left, dolly-in, orbit..."
                    disabled={isProcessing}
                  />
                </Field>
                {videoModelId === "ltx-2.3" ? (
                  <Toggle
                    label="Enhance prompt (LTX-2.3)"
                    value={enhancePrompt}
                    onChange={setEnhancePrompt}
                    disabled={isProcessing}
                  />
                ) : null}
                <div className="text-[11px] text-muted-foreground">
                  Start frame uses this node&apos;s image. End frame uses the next node image when available.
                </div>
              </div>
            ) : null}

            {mediaType === MediaType.AUDIO ? (
              <div className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-3">
                <Field label="Voice">
                  <Input value={voice} onChange={(e) => setVoice(e.target.value as VoiceName)} disabled={isProcessing} />
                </Field>
                <div className="text-[11px] text-muted-foreground">
                  Voice presets: Puck, Charon, Kore, Fenrir, Zephyr.
                </div>
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ModelPicker({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { id: string; name: string; description: string }[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const selected = options.find((o) => o.id === value) ?? options[0];
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          {label}
        </div>
        <Badge variant="outline" className="text-[10px] font-medium">
          {selected?.name}
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {options.map((opt) => {
          const active = opt.id === value;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.id)}
              className={cn(
                "text-left rounded-lg border px-3 py-2 transition-colors",
                "border-border/60 bg-background/60 hover:bg-background/80",
                active && "border-primary/50 bg-primary/15 ring-1 ring-primary/30",
                disabled && "opacity-60 cursor-not-allowed",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold truncate">{opt.name}</div>
                <div className="text-[10px] text-muted-foreground font-mono">{opt.id}</div>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {opt.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</div>
      {children}
    </div>
  );
}

function ShotMetaForm({
  nodeId,
  shotMeta,
  onUpdateShotMeta,
  disabled,
}: {
  nodeId: string;
  shotMeta: ShotMeta | undefined;
  onUpdateShotMeta?: (nodeId: string, next: ShotMeta) => void;
  disabled: boolean;
}) {
  const current: ShotMeta = shotMeta ?? {};

  const commit = (patch: Partial<ShotMeta>) => {
    if (!onUpdateShotMeta) return;
    const next: ShotMeta = { ...current, ...patch };
    // Drop explicit undefineds so the stored object stays compact.
    for (const key of Object.keys(next) as Array<keyof ShotMeta>) {
      if (next[key] === undefined) {
        delete next[key];
      }
    }
    onUpdateShotMeta(nodeId, next);
  };

  const commitListField = (field: "props" | "sfx" | "vfx", raw: string) => {
    const parsed = raw
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    commit({ [field]: parsed.length > 0 ? parsed : undefined } as Partial<ShotMeta>);
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-3">
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
        Shot metadata
      </div>

      <Field label="Scene / shot number">
        <Input
          defaultValue={current.number ?? ""}
          placeholder="1A"
          onBlur={(e) =>
            commit({ number: e.target.value.trim() || undefined })
          }
          disabled={disabled}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Shot size">
          <select
            value={current.size ?? ""}
            disabled={disabled}
            onChange={(e) =>
              commit({ size: (e.target.value || undefined) as ShotSize | undefined })
            }
            className="w-full rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-xs"
          >
            <option value="">—</option>
            {SHOT_SIZE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} · {opt.description}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Angle">
          <select
            value={current.angle ?? ""}
            disabled={disabled}
            onChange={(e) =>
              commit({ angle: (e.target.value || undefined) as ShotAngle | undefined })
            }
            className="w-full rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-xs"
          >
            <option value="">—</option>
            {SHOT_ANGLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Camera move">
          <select
            value={current.move ?? ""}
            disabled={disabled}
            onChange={(e) =>
              commit({ move: (e.target.value || undefined) as CameraMove | undefined })
            }
            className="w-full rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-xs"
          >
            <option value="">—</option>
            {CAMERA_MOVE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Lens (mm)">
          <Input
            type="number"
            list={`lens-presets-${nodeId}`}
            defaultValue={current.lensMm ?? ""}
            placeholder="35"
            min={0}
            disabled={disabled}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") {
                commit({ lensMm: undefined });
                return;
              }
              const parsed = Number(raw);
              commit({ lensMm: Number.isFinite(parsed) ? parsed : undefined });
            }}
          />
          <datalist id={`lens-presets-${nodeId}`}>
            {LENS_MM_PRESETS.map((mm) => (
              <option key={mm} value={mm} />
            ))}
          </datalist>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Aspect ratio">
          <select
            value={current.aspect ?? ""}
            disabled={disabled}
            onChange={(e) =>
              commit({ aspect: (e.target.value || undefined) as AspectRatio | undefined })
            }
            className="w-full rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-xs"
          >
            <option value="">—</option>
            {ASPECT_RATIO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} · {opt.context}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Duration (sec)">
          <Input
            type="number"
            step={0.5}
            min={0}
            defaultValue={current.durationS ?? ""}
            placeholder="3.5"
            disabled={disabled}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") {
                commit({ durationS: undefined });
                return;
              }
              const parsed = Number(raw);
              commit({ durationS: Number.isFinite(parsed) ? parsed : undefined });
            }}
          />
        </Field>
      </div>

      <Field label="T-stop">
        <Input
          defaultValue={current.tStop ?? ""}
          placeholder="T2.8"
          disabled={disabled}
          onBlur={(e) => commit({ tStop: e.target.value.trim() || undefined })}
        />
      </Field>

      <Field label="Screen direction">
        <div className="grid grid-cols-3 gap-1">
          {([
            { value: "left_to_right", label: "←" },
            { value: "neutral", label: "neutral" },
            { value: "right_to_left", label: "→" },
          ] as Array<{ value: ScreenDirection; label: string }>).map((opt) => {
            const active = current.screenDirection === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() =>
                  commit({
                    screenDirection: active ? undefined : opt.value,
                  })
                }
                className={cn(
                  "rounded-md border px-2 py-1.5 text-xs transition-colors",
                  "border-border/60 bg-background/60 hover:bg-background/80",
                  active && "border-primary/50 bg-primary/15 ring-1 ring-primary/30",
                  disabled && "opacity-60 cursor-not-allowed",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Blocking notes">
        <Textarea
          defaultValue={current.blockingNotes ?? ""}
          placeholder="Where the actors stand, where they move, eyelines..."
          className="min-h-[72px] bg-background/60"
          disabled={disabled}
          onBlur={(e) =>
            commit({ blockingNotes: e.target.value.trim() || undefined })
          }
        />
      </Field>

      <Field label="Props (comma-separated)">
        <Input
          defaultValue={(current.props ?? []).join(", ")}
          placeholder="briefcase, umbrella"
          disabled={disabled}
          onBlur={(e) => commitListField("props", e.target.value)}
        />
      </Field>

      <Field label="SFX (comma-separated)">
        <Input
          defaultValue={(current.sfx ?? []).join(", ")}
          placeholder="thunder, footsteps"
          disabled={disabled}
          onBlur={(e) => commitListField("sfx", e.target.value)}
        />
      </Field>

      <Field label="VFX (comma-separated)">
        <Input
          defaultValue={(current.vfx ?? []).join(", ")}
          placeholder="muzzle flash, screen replacement"
          disabled={disabled}
          onBlur={(e) => commitListField("vfx", e.target.value)}
        />
      </Field>
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={cn(
        "rounded-lg border px-3 py-2 text-left transition-colors",
        "border-border/60 bg-background/60 hover:bg-background/80",
        value && "border-primary/40 ring-1 ring-primary/30",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      <div className="text-xs font-medium">{label}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{value ? "On" : "Off"}</div>
    </button>
  );
}
