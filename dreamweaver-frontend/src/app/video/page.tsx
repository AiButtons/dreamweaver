"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, Clock, Film, Image as ImageIcon, Minus, Play, Plus, Sparkles, Square, Upload, Video, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

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
    { id: "1:1", label: "1:1" },
    { id: "3:4", label: "3:4" },
    { id: "2:3", label: "2:3" },
    { id: "9:16", label: "9:16" },
    { id: "3:2", label: "3:2" },
    { id: "4:3", label: "4:3" },
    { id: "16:9", label: "16:9", badge: "Cinematic" },
    { id: "21:9", label: "21:9", badge: "Cinematic" },
];

const DURATIONS = [
    { id: "5", label: "5s" },
    { id: "10", label: "10s" },
];

export default function VideoPage() {
    const [mode, setMode] = useState<"image" | "video">("video");
    const [prompt, setPrompt] = useState("");
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

    const selectedMovement = CAMERA_MOVEMENTS.find((m) => m.id === cameraMovement) || CAMERA_MOVEMENTS[0];

    const handleGenerate = useCallback(async () => {
        setIsGenerating(true);
        console.log("Generating video:", { prompt, cameraMovement, aspectRatio, duration, audioEnabled, slowMotion, batchSize, startFrame, endFrame });
        await new Promise((r) => setTimeout(r, 3000));
        setIsGenerating(false);
    }, [prompt, cameraMovement, aspectRatio, duration, audioEnabled, slowMotion, batchSize, startFrame, endFrame]);

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
                {/* Left Sidebar */}
                <div className="w-16 border-r border-border/50 flex flex-col items-center py-4 gap-2">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button onClick={() => setMode("image")}
                                className={cn("w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors",
                                    mode === "image" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50")}>
                                <ImageIcon className="w-5 h-5" />
                                <span className="text-[10px] font-medium">Image</span>
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">Switch to Image generation</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button onClick={() => setMode("video")}
                                className={cn("w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors",
                                    mode === "video" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50")}>
                                <Video className="w-5 h-5" />
                                <span className="text-[10px] font-medium">Video</span>
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">Switch to Video generation</TooltipContent>
                    </Tooltip>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col">
                    {/* Preview */}
                    <div className="flex-1 flex flex-col items-center justify-center px-8 py-12">
                        <div className="w-full max-w-3xl aspect-video rounded-xl bg-[#0f0f0f] border border-border/30 overflow-hidden flex items-center justify-center mb-8">
                            {startFrame ? (
                                <img src={startFrame} alt="Start frame" className="w-full h-full object-cover" />
                            ) : (
                                <div className="text-center text-muted-foreground">
                                    <Play className="w-16 h-16 mx-auto mb-4 opacity-30" />
                                    <p className="text-sm">Your video preview will appear here</p>
                                </div>
                            )}
                        </div>

                        <p className="text-xs font-medium text-primary tracking-widest uppercase mb-3">EXPLORE FEATURES</p>
                        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-center mb-4">CINEMA STUDIO</h1>
                        <p className="text-muted-foreground text-center max-w-xl text-sm">
                            Professional-grade cinematic content powered by real camera and lens simulation.
                        </p>
                    </div>

                    {/* Bottom Controls */}
                    <div className="sticky bottom-0 border-t border-border/50 bg-card/95 backdrop-blur-xl p-4">
                        <div className="max-w-5xl mx-auto space-y-3">
                            {/* Row 1: Prompt */}
                            <div className="flex items-center gap-3">
                                <Input placeholder="Upload image as a prompt or Describe the scene you imagine..." value={prompt} onChange={(e) => setPrompt(e.target.value)} className="flex-1 h-12 bg-muted/50 border-border/50 text-sm" />

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
                                            {ASPECT_RATIOS.map((ar) => (
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
