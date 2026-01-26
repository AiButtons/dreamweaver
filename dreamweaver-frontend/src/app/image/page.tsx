"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Check, ChevronRight, Image as ImageIcon, Minus, Pencil, Plus, Sparkles, Square, Camera, Upload, FileImage, Video as VideoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CameraState } from "@/types";
import { CameraSliders } from "@/components/camera/CameraSliders";
import { FileUpload } from "@/components/upload/FileUpload";

const CameraControl3D = dynamic(
    () => import("@/components/camera/CameraControl3D").then((mod) => mod.CameraControl3D),
    { ssr: false, loading: () => <div className="w-full aspect-[16/10] bg-[#1a1a1a] rounded-xl animate-pulse" /> }
);

// Model data
const MODELS = [
    { id: "zennah-image-gen", name: "Qwen Image", description: "Cinematic image generation with camera controls", icon: "🎬" },
    { id: "zennah-qwen-edit", name: "Qwen Edit", description: "Consistent image editing with prompts", icon: "✏️" },

    { id: "nano-banana-pro", name: "Nano Banana Pro", description: "Google's Flagship Generation Model", icon: "G", selected: true },
    { id: "nano-banana", name: "Nano Banana", description: "Google's Standard Generation Model", icon: "G", premium: true },
    { id: "seedream-45", name: "Seedream 4.5", description: "ByteDance's Next-Gen 4K Image Model", icon: "📊", premium: true },
    { id: "gpt-image-1", name: "GPT Image 1.5", description: "True-Color Precision Rendering", icon: "⚙", premium: true },
    { id: "z-image", name: "Z-Image", description: "Instant Lifelike Portraits", icon: "◇" },
];

const LORAS = [
    { id: "zennah-qwen-multiview", name: "Qwen Multi-View", description: "Automatic 3-angle view generation", icon: "📐" },
];

const ASPECT_RATIOS = [
    { id: "auto", label: "Auto" },
    { id: "1:1", label: "1:1" },
    { id: "4:3", label: "4:3" },
    { id: "16:9", label: "16:9" },
    { id: "21:9", label: "21:9" },
    { id: "3:2", label: "3:2" },
    { id: "2:3", label: "2:3" },
    { id: "9:16", label: "9:16" },
];

// Camera equipment data
const CAMERAS = [
    { id: "arriflex-16sr", name: "Arriflex 16SR", type: "FILM" },
    { id: "arri-alexa", name: "ARRI Alexa", type: "DIGITAL" },
    { id: "red-komodo", name: "RED Komodo", type: "DIGITAL" },
    { id: "sony-venice", name: "Sony Venice", type: "DIGITAL" },
    { id: "blackmagic", name: "Blackmagic", type: "DIGITAL" },
];

const LENSES = [
    { id: "panavision-c", name: "Panavision C-Series", type: "ANAMORPHIC" },
    { id: "cooke-s4", name: "Cooke S4", type: "SPHERICAL" },
    { id: "zeiss-master", name: "Zeiss Master", type: "SPHERICAL" },
    { id: "canon-sumire", name: "Canon Sumire", type: "SPHERICAL" },
];

const FOCAL_LENGTHS = [14, 24, 35, 50, 85, 100, 135, 200];
const APERTURES = ["f/1.4", "f/2", "f/2.8", "f/4", "f/5.6", "f/8", "f/11", "f/16"];

// Scrollable column component
function ScrollableColumn({ items, selectedIndex, onSelect, label, renderItem }: {
    items: { id: string; name: string; type?: string }[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    label: string;
    renderItem: (item: { id: string; name: string; type?: string }, isSelected: boolean) => React.ReactNode;
}) {
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 1 : -1;
        const newIndex = Math.max(0, Math.min(items.length - 1, selectedIndex + delta));
        onSelect(newIndex);
    }, [items.length, selectedIndex, onSelect]);

    return (
        <div className="flex flex-col items-center">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">{label}</span>
            <div onWheel={handleWheel} className="h-40 overflow-hidden relative cursor-ns-resize select-none">
                <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-[#1a1a1a] via-transparent to-[#1a1a1a] z-10" />
                <div className="flex flex-col items-center transition-transform duration-200" style={{ transform: `translateY(${(2 - selectedIndex) * 40}px)` }}>
                    {items.map((item, i) => (
                        <div key={item.id}
                            className={cn("h-10 flex items-center justify-center px-3 transition-all cursor-pointer",
                                i === selectedIndex ? "scale-110 text-foreground" : "scale-90 text-muted-foreground/50")}
                            onClick={() => onSelect(i)}>
                            {renderItem(item, i === selectedIndex)}
                        </div>
                    ))}
                </div>
            </div>
            {items[selectedIndex]?.type && (
                <span className="text-[9px] font-medium text-muted-foreground mt-2 bg-muted/50 px-2 py-0.5 rounded">
                    {items[selectedIndex].type}
                </span>
            )}
            <span className="text-xs font-medium mt-1">
                {items[selectedIndex]?.name}
                {label === "FOCAL LENGTH" && " mm"}
            </span>
        </div>
    );
}

export default function ImageGenerationPage() {
    const [prompt, setPrompt] = useState("");
    const [modelId, setModelId] = useState("zennah-image-gen");
    const [modelTab, setModelTab] = useState<"models" | "loras">("models");
    const [aspectRatio, setAspectRatio] = useState("1:1");
    const [batchSize, setBatchSize] = useState(1);
    const [isGenerating, setIsGenerating] = useState(false);

    const [showCameraModal, setShowCameraModal] = useState(false);
    const [cameraState, setCameraState] = useState<CameraState>({ azimuth: 0, elevation: 0, distance: 1 });
    const [showDrawModal, setShowDrawModal] = useState(false);
    const [drawTab, setDrawTab] = useState<"sketch" | "draw" | "edit">("edit");

    // Camera equipment state
    const [showEquipmentModal, setShowEquipmentModal] = useState(false);
    const [cameraIndex, setCameraIndex] = useState(0);
    const [lensIndex, setLensIndex] = useState(0);
    const [focalIndex, setFocalIndex] = useState(2);
    const [apertureIndex, setApertureIndex] = useState(6);

    // Advanced controls
    const [showAdvancedModal, setShowAdvancedModal] = useState(false);
    const [inferenceSteps, setInferenceSteps] = useState(35);
    const [guidanceScale, setGuidanceScale] = useState(8.0);
    const [seed, setSeed] = useState(42);

    // Upload and generation state
    const [uploadedImage, setUploadedImage] = useState<{ file: File; dataUrl: string } | null>(null);
    const [generatedImages, setGeneratedImages] = useState<Array<{ url?: string; b64_json?: string }>>([]);

    const allModels = [...MODELS, ...LORAS];
    const selectedModel = allModels.find((m) => m.id === modelId) || MODELS[0];
    const selectedCamera = CAMERAS[cameraIndex];

    const focalItems = FOCAL_LENGTHS.map(f => ({ id: String(f), name: String(f) }));
    const apertureItems = APERTURES.map(a => ({ id: a, name: a }));

    // Check if edit workflow (requires uploaded image)
    const isEditWorkflow = modelId === "zennah-qwen-edit" || modelId === "zennah-qwen-multiview";

    const handleGenerate = useCallback(async () => {
        if (!prompt.trim()) {
            console.warn('No prompt provided');
            return;
        }

        if (isEditWorkflow && !uploadedImage) {
            alert('Please upload an image first for edit/multi-view workflows');
            return;
        }

        setIsGenerating(true);
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
            const endpoint = isEditWorkflow
                ? `${apiUrl}/api/image/edit`
                : `${apiUrl}/api/image/generate`;

            const payload: any = {
                prompt,
                model_id: modelId,
            };

            if (isEditWorkflow && uploadedImage) {
                payload.image = uploadedImage.dataUrl;
                payload.extra_params = {
                    n_steps: inferenceSteps,
                    guidance_scale: guidanceScale,
                    seed: seed,
                    // Send camera state for multi-view generation
                    azimuth: cameraState.azimuth,
                    elevation: cameraState.elevation,
                    distance: cameraState.distance,
                };
            } else {
                payload.azimuth = cameraState.azimuth;
                payload.elevation = cameraState.elevation;
                payload.distance = cameraState.distance;
                payload.camera_id = CAMERAS[cameraIndex].id;
                payload.lens_id = LENSES[lensIndex].id;
                payload.focal_length = FOCAL_LENGTHS[focalIndex];
                payload.aperture = APERTURES[apertureIndex];
                payload.aspect_ratio = aspectRatio;
                payload.batch_size = batchSize;
                payload.quality = "standard";
                payload.n_steps = inferenceSteps;
                payload.guidance_scale = guidanceScale;
                payload.seed = seed;
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const error = await response.json();
                console.error('Generation failed:', error);
                alert(`Generation failed: ${error.detail || 'Unknown error'}`);
                return;
            }

            const data = await response.json();
            console.log('✅ Generated:', data);
            setGeneratedImages(data.images || []);
        } catch (error: any) {
            console.error('Error generating image:', error);
            alert('Failed to generate image. Check console for details.');
        } finally {
            setIsGenerating(false);
        }
    }, [prompt, modelId, uploadedImage, isEditWorkflow, cameraState, cameraIndex, lensIndex, focalIndex, apertureIndex, aspectRatio, batchSize, inferenceSteps, guidanceScale, seed]);

    return (
        <TooltipProvider delayDuration={300}>
            <div className="min-h-[calc(100vh-3.5rem)] bg-background flex flex-col">
                {/* Main Content */}
                <div className="flex-1 overflow-y-auto px-4 py-12">
                    {/* Upload Section for Edit Workflows */}
                    {isEditWorkflow && !generatedImages.length && (
                        <div className="max-w-2xl mx-auto mb-8">
                            <div className="mb-4">
                                <h3 className="text-lg font-semibold mb-1">Upload Base Image</h3>
                                <p className="text-sm text-muted-foreground">
                                    {modelId === "zennah-qwen-multiview"
                                        ? "Upload an image to generate 3-angle multi-view composite"
                                        : "Upload an image to edit with AI"}
                                </p>
                            </div>
                            <FileUpload
                                onFileUpload={(file, dataUrl) => setUploadedImage({ file, dataUrl })}
                                onClear={() => setUploadedImage(null)}
                                accept="image/*"
                                maxSizeMB={10}
                                disabled={isGenerating}
                            />
                        </div>
                    )}

                    {/* Generated Images Grid */}
                    {generatedImages.length > 0 ? (
                        <div className="max-w-4xl mx-auto">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-2xl font-bold">Generated Images</h2>
                                <Button variant="outline" size="sm" onClick={() => setGeneratedImages([])}>Clear</Button>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                {generatedImages.map((img, i) => {
                                    const imgSrc = img.url || (img.b64_json ? `data:image/jpeg;base64,${img.b64_json}` : '');
                                    return (
                                        <div key={i} className="relative group">
                                            <img src={imgSrc} alt={`Generated ${i + 1}`} className="w-full rounded-xl border border-border/50 shadow-lg" />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : !isEditWorkflow && (
                        /* Hero Section */
                        <div className="flex flex-col items-center justify-center">
                            <div className="relative mb-8">
                                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 flex items-center justify-center">
                                    <ImageIcon className="w-12 h-12 text-primary" />
                                </div>
                                <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-primary animate-pulse" />
                            </div>
                            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-center mb-4 uppercase">{selectedModel.name}</h1>
                            <p className="text-muted-foreground text-center max-w-md">Create stunning, high-aesthetic images in seconds</p>
                        </div>
                    )}
                </div>

                {/* Bottom Controls */}
                <div className="sticky bottom-0 border-t border-border/50 bg-card/95 backdrop-blur-xl p-4">
                    <div className="max-w-4xl mx-auto space-y-3">
                        {/* Row 1: Prompt */}
                        <div className="flex items-center gap-3">
                            <div className="flex-1 relative">
                                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                                    <Plus className="w-4 h-4 text-muted-foreground" />
                                </div>
                                <Input
                                    placeholder="Describe the scene you imagine"
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey && prompt.trim() && !isGenerating) {
                                            e.preventDefault();
                                            handleGenerate();
                                        }
                                    }}
                                    className="pl-10 pr-4 h-12 bg-muted/50 border-border/50 text-base"
                                    disabled={isGenerating}
                                />
                            </div>
                            <Button size="lg" className="h-12 px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" onClick={handleGenerate} disabled={isGenerating}>
                                {isGenerating ? (<><div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" /> Generating...</>) : "Generate"}
                            </Button>
                        </div>

                        {/* Row 2: Controls */}
                        <div className="flex items-center gap-2">
                            {/* Model Selector */}
                            <Popover>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" className="h-10 px-3 bg-primary/10 border-primary/30 hover:bg-primary/20 text-primary font-medium gap-1.5">
                                                <span className="text-sm font-bold">{selectedModel.icon}</span>
                                                <span className="text-sm">{selectedModel.name}</span>
                                                <ChevronRight className="w-3 h-3 opacity-60" />
                                            </Button>
                                        </PopoverTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent>Select AI model</TooltipContent>
                                </Tooltip>
                                <PopoverContent align="start" className="w-80 p-2">
                                    <Tabs value={modelTab} onValueChange={(v) => setModelTab(v as "models" | "loras")} className="w-full">
                                        <TabsList className="grid w-full grid-cols-2 mb-2">
                                            <TabsTrigger value="models">Models</TabsTrigger>
                                            <TabsTrigger value="loras">LoRAs</TabsTrigger>
                                        </TabsList>
                                    </Tabs>
                                    <div className="space-y-1 max-h-[350px] overflow-y-auto">
                                        {modelTab === "models" ? MODELS.map((model) => (
                                            <button key={model.id} onClick={() => setModelId(model.id)}
                                                className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left", modelId === model.id ? "bg-muted" : "hover:bg-muted/50")}>
                                                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">{model.icon}</span>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium">{model.name}</span>
                                                        {model.premium && <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded">Premium</span>}
                                                    </div>
                                                    <span className="text-xs text-muted-foreground">{model.description}</span>
                                                </div>
                                                {modelId === model.id && <Check className="w-4 h-4 text-primary" />}
                                            </button>
                                        )) : LORAS.map((lora) => (
                                            <button key={lora.id} onClick={() => setModelId(lora.id)}
                                                className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left", modelId === lora.id ? "bg-purple-500/20" : "hover:bg-muted/50")}>
                                                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/20 text-sm font-bold text-purple-400">{lora.icon}</span>
                                                <div className="flex-1 min-w-0">
                                                    <span className="text-sm font-medium text-purple-400">{lora.name}</span>
                                                    <span className="text-xs text-muted-foreground block">{lora.description}</span>
                                                </div>
                                                {modelId === lora.id && <Check className="w-4 h-4 text-purple-400" />}
                                            </button>
                                        ))}
                                    </div>
                                </PopoverContent>
                            </Popover>

                            {/* Batch Size */}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1 bg-muted/50 rounded-lg px-2 h-10 border border-border/50">
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setBatchSize(Math.max(1, batchSize - 1))} disabled={batchSize <= 1}>
                                            <Minus className="h-3 w-3" />
                                        </Button>
                                        <span className="text-sm font-medium min-w-[32px] text-center">{batchSize}/4</span>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setBatchSize(Math.min(4, batchSize + 1))} disabled={batchSize >= 4}>
                                            <Plus className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>Number of images to generate</TooltipContent>
                            </Tooltip>

                            {/* Aspect Ratio */}
                            <Popover>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" className="h-10 px-3 bg-muted/50 border-border/50 gap-1.5">
                                                <Square className="w-3.5 h-3.5" />
                                                <span className="text-sm">Auto</span>
                                            </Button>
                                        </PopoverTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent>Choose aspect ratio</TooltipContent>
                                </Tooltip>
                                <PopoverContent align="start" className="w-44 p-2">
                                    <div className="text-sm font-medium text-muted-foreground px-3 py-2">Aspect ratio</div>
                                    <div className="space-y-0.5 max-h-[300px] overflow-y-auto">
                                        {ASPECT_RATIOS.map((ar) => (
                                            <button key={ar.id} onClick={() => setAspectRatio(ar.id)}
                                                className={cn("w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left", aspectRatio === ar.id ? "bg-muted" : "hover:bg-muted/50")}>
                                                <Square className="w-3.5 h-3.5 text-muted-foreground" />
                                                <span className="flex-1 text-sm">{ar.label}</span>
                                                {aspectRatio === ar.id && <Check className="w-4 h-4 text-primary" />}
                                            </button>
                                        ))}
                                    </div>
                                </PopoverContent>
                            </Popover>

                            {/* Draw Mode */}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="outline" className="h-10 px-3 bg-muted/50 border-border/50 gap-1.5" onClick={() => setShowDrawModal(true)}>
                                        <Pencil className="w-3.5 h-3.5" />
                                        <span className="text-sm">Draw</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Open sketch/draw editor</TooltipContent>
                            </Tooltip>

                            {/* Camera Control */}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="outline" className="h-10 px-3 bg-muted/50 border-border/50 gap-1.5" onClick={() => setShowCameraModal(true)}>
                                        <Camera className="w-3.5 h-3.5" />
                                        <span className="text-sm">Camera control</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Adjust 3D camera angle</TooltipContent>
                            </Tooltip>

                            {/* Camera Equipment */}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="outline" className="h-10 px-3 bg-muted/50 border-border/50 gap-1.5" onClick={() => setShowEquipmentModal(true)}>
                                        <VideoIcon className="w-3.5 h-3.5" />
                                        <span className="text-sm">{selectedCamera.name}</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Select camera and lens equipment</TooltipContent>
                            </Tooltip>
                        </div>
                    </div>
                </div>

                {/* Camera Control Modal */}
                <Dialog open={showCameraModal} onOpenChange={setShowCameraModal}>
                    <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Camera className="w-5 h-5 text-primary" />
                                Camera Control
                            </DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            <CameraControl3D value={cameraState} onChange={setCameraState} compact />
                            <CameraSliders value={cameraState} onChange={setCameraState} />
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Camera Equipment Modal - Fixed with DialogTitle and dark bg */}
                <Dialog open={showEquipmentModal} onOpenChange={setShowEquipmentModal}>
                    <DialogContent className="max-w-2xl bg-[#1a1a1a] border-border/50">
                        <DialogHeader>
                            <VisuallyHidden>
                                <DialogTitle>Camera Equipment</DialogTitle>
                            </VisuallyHidden>
                            <div className="flex items-center gap-3">
                                <span className="text-sm font-medium bg-foreground text-background px-3 py-1 rounded-full">All</span>
                                <span className="text-sm text-muted-foreground">Recommended</span>
                            </div>
                        </DialogHeader>
                        <div className="py-6">
                            <div className="grid grid-cols-4 gap-6">
                                <ScrollableColumn
                                    items={CAMERAS}
                                    selectedIndex={cameraIndex}
                                    onSelect={setCameraIndex}
                                    label="CAMERA"
                                    renderItem={(item, isSelected) => (
                                        <div className={cn("w-14 h-10 rounded-lg bg-muted/30 border border-border/50 flex items-center justify-center", isSelected && "bg-muted border-muted-foreground/50")}>
                                            <Camera className="w-5 h-5" />
                                        </div>
                                    )}
                                />
                                <ScrollableColumn
                                    items={LENSES}
                                    selectedIndex={lensIndex}
                                    onSelect={setLensIndex}
                                    label="LENS"
                                    renderItem={(item, isSelected) => (
                                        <div className={cn("w-14 h-10 rounded-lg bg-muted/30 border border-border/50 flex items-center justify-center", isSelected && "bg-muted border-muted-foreground/50")}>
                                            <div className="w-6 h-4 bg-muted-foreground/50 rounded" />
                                        </div>
                                    )}
                                />
                                <ScrollableColumn
                                    items={focalItems}
                                    selectedIndex={focalIndex}
                                    onSelect={setFocalIndex}
                                    label="FOCAL LENGTH"
                                    renderItem={(item, isSelected) => (
                                        <span className={cn("text-2xl font-bold tabular-nums", isSelected ? "text-foreground" : "text-muted-foreground/30")}>
                                            {item.name}
                                        </span>
                                    )}
                                />
                                <ScrollableColumn
                                    items={apertureItems}
                                    selectedIndex={apertureIndex}
                                    onSelect={setApertureIndex}
                                    label="APERTURE"
                                    renderItem={(item, isSelected) => (
                                        <div className={cn("w-8 h-8 rounded-full border-2", isSelected ? "border-foreground" : "border-muted-foreground/30")} />
                                    )}
                                />
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Draw Modal */}
                <Dialog open={showDrawModal} onOpenChange={setShowDrawModal}>
                    <DialogContent className="max-w-lg">
                        <DialogHeader>
                            <VisuallyHidden>
                                <DialogTitle>Draw Tools</DialogTitle>
                            </VisuallyHidden>
                            <Tabs value={drawTab} onValueChange={(v) => setDrawTab(v as typeof drawTab)} className="w-full">
                                <TabsList className="grid w-full grid-cols-3 bg-muted/50">
                                    <TabsTrigger value="sketch" className="gap-1.5 text-xs data-[state=active]:bg-background">
                                        <Pencil className="w-3.5 h-3.5" />
                                        Sketch to Video
                                        <span className="text-[9px] bg-primary/20 text-primary px-1 rounded">NEW</span>
                                    </TabsTrigger>
                                    <TabsTrigger value="draw" className="gap-1.5 text-xs data-[state=active]:bg-background">
                                        <Pencil className="w-3.5 h-3.5" />
                                        Draw to Video
                                    </TabsTrigger>
                                    <TabsTrigger value="edit" className="gap-1.5 text-xs data-[state=active]:bg-background">
                                        <Pencil className="w-3.5 h-3.5" />
                                        Draw to Edit
                                    </TabsTrigger>
                                </TabsList>
                            </Tabs>
                        </DialogHeader>
                        <div className="py-6">
                            <div className="border-2 border-dashed border-border rounded-xl p-6 text-center">
                                <div className="w-40 h-28 mx-auto mb-4 bg-muted/50 rounded-lg flex items-center justify-center">
                                    <ImageIcon className="w-10 h-10 text-muted-foreground/50" />
                                </div>
                                <h3 className="text-base font-bold mb-1.5 uppercase tracking-wide">Draw to Edit</h3>
                                <p className="text-xs text-muted-foreground mb-5">From sketch to a complete picture<br />in a second. No prompt needed.</p>
                                <div className="space-y-2.5">
                                    <Button variant="outline" className="w-full h-10 gap-2 text-sm"><Upload className="w-4 h-4" />Upload Media</Button>
                                    <Button variant="outline" className="w-full h-10 gap-2 text-sm"><FileImage className="w-4 h-4" />Create blank</Button>
                                </div>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </TooltipProvider>
    );
}
