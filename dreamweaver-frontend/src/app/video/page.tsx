"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Camera, Film, Mic, MicOff, Play, Settings2, Square, Timer, Upload, X, ChevronRight, Check, Image as ImageIcon, Video, Plus, Clock, Volume2, VolumeX, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner"; // Assuming sonner is used, or alert
import { useMutation } from "convex/react";
import { mutationRef } from "@/lib/convexRefs";


// Camera movements
const CAMERA_MOVEMENTS = [
    { id: "static", label: "Static" },
    { id: "handheld", label: "Handheld" },
    { id: "zoom-out", label: "Zoom Out" },
    { id: "zoom-in", label: "Zoom in" },
    { id: "camera-follows", label: "Camera follows" },
    { id: "pan-left", label: "Pan left" },
    { id: "pan-right", label: "Pan right" },
    { id: "tilt-up", label: "Tilt up" },
    { id: "tilt-down", label: "Tilt down" },
    { id: "dolly-in", label: "Dolly in" },
    { id: "dolly-out", label: "Dolly out" },
    { id: "orbit", label: "Orbit" },
];

const ASPECT_RATIOS = [
    { id: "16:9", label: "16:9" },
    { id: "9:16", label: "9:16" },
    { id: "1:1", label: "1:1" },
    { id: "21:9", label: "21:9" },
    { id: "4:3", label: "4:3" },
    { id: "3:4", label: "3:4" },
    { id: "2:3", label: "2:3" },
    { id: "3:2", label: "3:2" },
];

interface AspectRatio {
    id: string;
    label: string;
    badge?: string;
}

const MODELS = [
    { id: "ltx-2", name: "LTX-2", description: "Lightricks LTX Video Model", icon: "🎬", selected: true },
    { id: "veo-3.1", name: "Veo 3.1", description: "Google DeepMind Veo Model", icon: "G" },
];

const LORAS: Array<{ id: string; name: string; description: string; icon: string }> = [];

const DURATIONS = [
    { id: "5", label: "5s" },
    { id: "10", label: "10s" },
];

export default function VideoPage() {
    const [mode, setMode] = useState<"image" | "video">("video");
    const [prompt, setPrompt] = useState("");
    const [negativePrompt, setNegativePrompt] = useState("");
    const [modelId, setModelId] = useState("ltx-2");
    const [modelTab, setModelTab] = useState<"models" | "loras">("models");
    const [cameraMovement, setCameraMovement] = useState("static");
    const [aspectRatio, setAspectRatio] = useState("16:9");
    const [duration, setDuration] = useState("5");
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [slowMotion, setSlowMotion] = useState(false);
    const [batchSize, setBatchSize] = useState(1);
    const [startFrame, setStartFrame] = useState<string | undefined>();
    const [endFrame, setEndFrame] = useState<string | undefined>();
    const [isGenerating, setIsGenerating] = useState(false);

    const [showMovementsModal, setShowMovementsModal] = useState(false);
    const [showStartFrameModal, setShowStartFrameModal] = useState(false);
    const [showEndFrameModal, setShowEndFrameModal] = useState(false);
    const [frameModalTab, setFrameModalTab] = useState<"recent" | "generations" | "liked">("generations");

    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const persistGeneration = useMutation(mutationRef("generations:create"));

    const selectedMovement = CAMERA_MOVEMENTS.find((m) => m.id === cameraMovement) || CAMERA_MOVEMENTS[0];

    const handleGenerate = useCallback(async () => {
        if (!prompt && !startFrame) {
            toast.error("Please provide a prompt or start frame");
            return;
        }

        setIsGenerating(true);
        setVideoUrl(null);

        try {
            const payload = {
                prompt,
                negative_prompt: negativePrompt,
                model_id: modelId,
                start_image: startFrame,
                end_image: endFrame,
                aspect_ratio: aspectRatio,
                duration,
                camera_movement: cameraMovement,
                audio_enabled: audioEnabled,
                slow_motion: slowMotion,
                batch_size: batchSize
            };

            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/video/generate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || "Generation failed");
            }

            const data = await response.json();
            if (data.url) {
                setVideoUrl(data.url);
                toast.success("Video generated successfully!");

                try {
                    await persistGeneration({
                        kind: "video",
                        prompt: prompt || "",
                        modelId,
                        resultUrls: [data.url],
                        status: "completed",
                        metadata: {
                            duration,
                            aspectRatio,
                            cameraMovement,
                            audioEnabled: String(audioEnabled),
                            slowMotion: String(slowMotion),
                            batchSize: String(batchSize),
                        },
                    });
                } catch (persistError) {
                    console.warn("Failed to persist generation:", persistError);
                }
            }
        } catch (error) {
            console.error("Video generation failed:", error);
            toast.error(error instanceof Error ? error.message : "Video generation failed");
        } finally {
            setIsGenerating(false);
        }
    }, [prompt, cameraMovement, aspectRatio, duration, audioEnabled, slowMotion, batchSize, startFrame, endFrame, modelId, persistGeneration]);

    const handleFileUpload = (type: "start" | "end") => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const result = ev.target?.result as string;
                    if (type === "start") {
                        setStartFrame(result);
                        setShowStartFrameModal(false);
                    } else {
                        setEndFrame(result);
                        setShowEndFrameModal(false);
                    }
                };
                reader.readAsDataURL(file);
            }
        };
        input.click();
    };

    return (
        <TooltipProvider delayDuration={300}>
            <div className="min-h-[calc(100vh-3.5rem)] bg-background flex">
                {/* Main Content */}
                <div className="flex-1 flex flex-col">
                    {/* Preview */}
                    <div className="flex-1 flex flex-col items-center justify-center px-8 py-12">
                        <div className="w-full max-w-4xl aspect-video rounded-xl bg-[#0f0f0f] border border-border/30 overflow-hidden flex items-center justify-center mb-0 relative group shadow-2xl">
                            {isGenerating ? (
                                <div className="absolute inset-0 flex items-center justify-center p-8 bg-black/50 backdrop-blur-sm">
                                    <div className="flex items-center gap-6 w-full max-w-2xl px-8 relative">
                                        {/* Start Frame */}
                                        <div className="relative w-1/3 aspect-[16/9] rounded-lg overflow-hidden border-2 border-primary/30 shadow-2xl bg-black">
                                            {startFrame ? (
                                                <img src={startFrame} className="w-full h-full object-contain" alt="Start" />
                                            ) : (
                                                <div className="w-full h-full bg-muted/20 flex items-center justify-center">
                                                    <span className="text-xs text-muted-foreground">Start</span>
                                                </div>
                                            )}
                                            <div className="absolute inset-0 bg-primary/10 ring-1 ring-inset ring-primary/20" />
                                        </div>

                                        {/* Animated Transition */}
                                        <div className="flex-1 flex flex-col items-center justify-center gap-2">
                                            <div className="h-1 w-full bg-muted/20 rounded-full overflow-hidden relative">
                                                <div className="absolute inset-y-0 left-0 w-1/3 bg-primary/80 blur-sm rounded-full animate-[shimmer_1.5s_infinite_linear]"
                                                    style={{ content: '""', transform: 'translateX(-100%)', animationName: 'slide-right' }} />
                                            </div>
                                            <div className="flex gap-1">
                                                <span className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                                                <span className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                                                <span className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                                            </div>
                                            <span className="text-xs font-mono text-primary/80 animate-pulse mt-1">MORPHING</span>
                                        </div>

                                        {/* End Frame */}
                                        <div className="relative w-1/3 aspect-[16/9] rounded-lg overflow-hidden border-2 border-primary/30 shadow-2xl bg-black">
                                            {endFrame ? (
                                                <img src={endFrame} className="w-full h-full object-contain" alt="End" />
                                            ) : (
                                                <div className="w-full h-full bg-muted/20 flex items-center justify-center">
                                                    <span className="text-xs text-muted-foreground">End</span>
                                                </div>
                                            )}
                                            <div className="absolute inset-0 bg-primary/10 ring-1 ring-inset ring-primary/20" />
                                        </div>
                                    </div>

                                    {/* Particles/Overlay */}
                                    <div className="absolute inset-0 pointer-events-none opacity-20 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-opacity-30 mix-blend-overlay" />
                                </div>
                            ) : videoUrl ? (
                                <video src={videoUrl} controls className="w-full h-full object-contain" autoPlay loop />
                            ) : startFrame ? (
                                <img src={startFrame} alt="Start frame" className="w-full h-full object-contain" />
                            ) : (
                                <div className="text-center space-y-4 p-8">
                                    <div className="mb-6 inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 text-primary mb-6">
                                        <Film className="w-10 h-10" />
                                    </div>
                                    <div className="space-y-2">
                                        <p className="text-xs font-medium text-primary tracking-[0.2em] uppercase">EXPLORE FEATURES</p>
                                        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white">CINEMA STUDIO</h1>
                                        <p className="text-muted-foreground max-w-lg mx-auto text-sm leading-relaxed">
                                            Professional-grade cinematic content powered by real camera and lens simulation.
                                            <br />Upload a start frame to begin.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Add keyframes for the custom animation if not in global css */}
                        <style jsx global>{`
                            @keyframes slide-right {
                                0% { transform: translateX(-100%); }
                                100% { transform: translateX(300%); }
                            }
                        `}</style>

                    </div>

                    {/* Bottom Controls */}
                    <div className="sticky bottom-0 border-t border-border/50 bg-card/95 backdrop-blur-xl p-4">
                        <div className="max-w-5xl mx-auto space-y-3">
                            {/* Row 1: Prompts */}
                            <div className="flex gap-3">
                                <div className="flex-1 space-y-2">
                                    <Input
                                        placeholder="Describe the scene you imagine..."
                                        value={prompt}
                                        onChange={(e) => setPrompt(e.target.value)}
                                        className="h-12 bg-muted/50 border-border/50 text-sm"
                                    />
                                    <Input
                                        placeholder="Negative prompt (e.g. blurry, distorted, low quality)..."
                                        value={negativePrompt}
                                        onChange={(e) => setNegativePrompt(e.target.value)}
                                        className="h-10 bg-muted/30 border-border/30 text-xs text-muted-foreground"
                                    />
                                </div>

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button onClick={() => setShowStartFrameModal(true)}
                                            className="h-16 w-20 rounded-lg border-2 border-dashed border-primary/50 bg-muted/30 flex flex-col items-center justify-center gap-1 hover:border-primary transition-colors">
                                            {startFrame ? (
                                                <img src={startFrame} alt="Start" className="w-full h-full object-cover rounded-md" />
                                            ) : (
                                                <>
                                                    <Plus className="w-4 h-4 text-muted-foreground" />
                                                    <span className="text-[10px] font-medium text-muted-foreground uppercase">Start Frame</span>
                                                </>
                                            )}
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>Upload start frame reference</TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button onClick={() => setShowEndFrameModal(true)}
                                            className="h-16 w-20 rounded-lg border-2 border-dashed border-border bg-muted/30 flex flex-col items-center justify-center gap-1 hover:border-muted-foreground transition-colors">
                                            {endFrame ? (
                                                <img src={endFrame} alt="End" className="w-full h-full object-cover rounded-md" />
                                            ) : (
                                                <>
                                                    <Plus className="w-4 h-4 text-muted-foreground" />
                                                    <span className="text-[10px] font-medium text-muted-foreground uppercase">End Frame</span>
                                                </>
                                            )}
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>Upload end frame reference</TooltipContent>
                                </Tooltip>

                                <Button size="lg" className="h-16 px-8 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" onClick={handleGenerate} disabled={isGenerating}>
                                    {isGenerating ? (
                                        <><div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" /> Generating...</>
                                    ) : (
                                        "GENERATE"
                                    )}
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
                                                    <span className="text-sm font-bold">{MODELS.find(m => m.id === modelId)?.icon}</span>
                                                    <span className="text-sm">{MODELS.find(m => m.id === modelId)?.name}</span>
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
                                                        </div>
                                                        <span className="text-xs text-muted-foreground">{model.description}</span>
                                                    </div>
                                                    {modelId === model.id && <Check className="w-4 h-4 text-primary" />}
                                                </button>
                                            )) : (
                                                <div className="p-4 text-center text-sm text-muted-foreground">
                                                    No LoRAs available for video generation yet.
                                                </div>
                                            )}
                                        </div>
                                    </PopoverContent>
                                </Popover>

                                {/* Movements - shows selected movement */}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="outline" className="h-10 px-3 bg-muted/50 border-border/50 gap-1.5" onClick={() => setShowMovementsModal(true)}>
                                            <Film className="w-3.5 h-3.5" />
                                            <span className="text-sm">{selectedMovement.label}</span>
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Select camera movement style</TooltipContent>
                                </Tooltip>

                                {/* Aspect Ratio */}
                                <Popover>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" className="h-10 px-3 bg-muted/50 border-border/50 gap-1.5">
                                                    <Square className="w-3.5 h-3.5" />
                                                    <span className="text-sm">{aspectRatio}</span>
                                                </Button>
                                            </PopoverTrigger>
                                        </TooltipTrigger>
                                        <TooltipContent>Choose aspect ratio</TooltipContent>
                                    </Tooltip>
                                    <PopoverContent align="start" className="w-56 p-2">
                                        <div className="space-y-0.5">
                                            {(ASPECT_RATIOS as AspectRatio[]).map((ar) => (
                                                <button key={ar.id} onClick={() => setAspectRatio(ar.id)}
                                                    className={cn("w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left",
                                                        aspectRatio === ar.id ? "bg-muted" : "hover:bg-muted/50")}>
                                                    <Square className="w-3.5 h-3.5 text-muted-foreground" />
                                                    <span className="flex-1 text-sm">{ar.label}</span>
                                                    {ar.badge && <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded">{ar.badge}</span>}
                                                    {aspectRatio === ar.id && <Check className="w-4 h-4 text-primary" />}
                                                </button>
                                            ))}
                                        </div>
                                    </PopoverContent>
                                </Popover>

                                {/* Duration */}
                                <Popover>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" className="h-10 px-3 bg-muted/50 border-border/50 gap-1.5">
                                                    <Clock className="w-3.5 h-3.5" />
                                                    <span className="text-sm">{duration}s</span>
                                                </Button>
                                            </PopoverTrigger>
                                        </TooltipTrigger>
                                        <TooltipContent>Set video duration</TooltipContent>
                                    </Tooltip>
                                    <PopoverContent align="start" className="w-32 p-2">
                                        <div className="text-sm font-medium text-muted-foreground px-3 py-1.5">Duration</div>
                                        <div className="space-y-0.5">
                                            {DURATIONS.map((d) => (
                                                <button key={d.id} onClick={() => setDuration(d.id)}
                                                    className={cn("w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-left",
                                                        duration === d.id ? "bg-muted" : "hover:bg-muted/50")}>
                                                    <span className="flex-1 text-sm">{d.label}</span>
                                                    {duration === d.id && <Check className="w-4 h-4 text-primary" />}
                                                </button>
                                            ))}
                                        </div>
                                    </PopoverContent>
                                </Popover>

                                {/* Audio Toggle */}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="outline" onClick={() => setAudioEnabled(!audioEnabled)}
                                            className={cn("h-10 px-3 gap-1.5 border-border/50", audioEnabled ? "bg-muted/50" : "bg-transparent")}>
                                            {audioEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                                            <span className="text-sm">{audioEnabled ? "On" : "Off"}</span>
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Toggle audio generation</TooltipContent>
                                </Tooltip>

                                {/* Slow Motion Toggle */}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="outline" onClick={() => setSlowMotion(!slowMotion)}
                                            className={cn("h-10 px-3 gap-1.5 border-border/50", slowMotion ? "bg-primary/20 border-primary/50 text-primary" : "bg-transparent")}>
                                            <Clock className="w-3.5 h-3.5" />
                                            <span className="text-sm">{slowMotion ? "On" : "Off"}</span>
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Toggle slow motion effect</TooltipContent>
                                </Tooltip>

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
                                    <TooltipContent>Number of videos to generate</TooltipContent>
                                </Tooltip>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Movements Modal */}
                <Dialog open={showMovementsModal} onOpenChange={setShowMovementsModal}>
                    <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="text-sm font-medium bg-muted inline-block px-3 py-1.5 rounded-full w-fit">
                                Camera movement
                            </DialogTitle>
                        </DialogHeader>
                        <div className="grid grid-cols-6 gap-3 py-4">
                            {CAMERA_MOVEMENTS.map((movement) => (
                                <button key={movement.id} onClick={() => { setCameraMovement(movement.id); setShowMovementsModal(false); }}
                                    className={cn("group relative aspect-[3/4] rounded-lg overflow-hidden border-2 transition-all",
                                        cameraMovement === movement.id ? "border-primary" : "border-transparent hover:border-muted-foreground/50")}>
                                    <div className="absolute inset-0 bg-gradient-to-b from-orange-900/50 to-orange-700/30" />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="w-8 h-12 bg-black/30 rounded" />
                                    </div>
                                    <div className="absolute bottom-2 left-0 right-0 text-center">
                                        <span className="text-xs font-medium text-white drop-shadow-lg">{movement.label}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Start Frame Modal */}
                <Dialog open={showStartFrameModal} onOpenChange={setShowStartFrameModal}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>Select Start Frame</DialogTitle>
                            <Tabs value={frameModalTab} onValueChange={(v) => setFrameModalTab(v as typeof frameModalTab)} className="w-full">
                                <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto">
                                    <TabsTrigger value="recent" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Recently attached</TabsTrigger>
                                    <TabsTrigger value="generations" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Image Generations</TabsTrigger>
                                    <TabsTrigger value="liked" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Liked</TabsTrigger>
                                </TabsList>
                            </Tabs>
                        </DialogHeader>
                        <div className="py-6">
                            <button onClick={() => handleFileUpload("start")}
                                className="w-40 h-32 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 hover:border-muted-foreground transition-colors">
                                <Plus className="w-6 h-6 text-muted-foreground" />
                                <span className="text-sm font-medium text-muted-foreground">Upload Images</span>
                            </button>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* End Frame Modal */}
                <Dialog open={showEndFrameModal} onOpenChange={setShowEndFrameModal}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>Select End Frame</DialogTitle>
                            <Tabs value={frameModalTab} onValueChange={(v) => setFrameModalTab(v as typeof frameModalTab)} className="w-full">
                                <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto">
                                    <TabsTrigger value="recent" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Recently attached</TabsTrigger>
                                    <TabsTrigger value="generations" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Image Generations</TabsTrigger>
                                    <TabsTrigger value="liked" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Liked</TabsTrigger>
                                </TabsList>
                            </Tabs>
                        </DialogHeader>
                        <div className="py-6">
                            <button onClick={() => handleFileUpload("end")}
                                className="w-40 h-32 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 hover:border-muted-foreground transition-colors">
                                <Plus className="w-6 h-6 text-muted-foreground" />
                                <span className="text-sm font-medium text-muted-foreground">Upload Images</span>
                            </button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </TooltipProvider>
    );
}
