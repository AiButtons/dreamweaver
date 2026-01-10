"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Check, Eraser, Image as ImageIcon, Layers, Minus, Move, PaintBucket, Paintbrush, Plus, Sparkles, Square, Upload, Wand2, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

// Edit modes
const EDIT_MODES = [
    { id: "inpaint", label: "Inpaint", icon: Paintbrush, description: "Fill selected areas with AI-generated content" },
    { id: "outpaint", label: "Outpaint", icon: Layers, description: "Extend your image beyond its borders" },
    { id: "remove", label: "Remove", icon: Eraser, description: "Remove objects from your image" },
    { id: "replace", label: "Replace", icon: PaintBucket, description: "Replace selected areas with new content" },
];

const BRUSH_SIZES = [
    { id: "small", label: "S", size: 10 },
    { id: "medium", label: "M", size: 25 },
    { id: "large", label: "L", size: 50 },
    { id: "xlarge", label: "XL", size: 100 },
];

const ASPECT_RATIOS = [
    { id: "1:1", label: "1:1" },
    { id: "4:3", label: "4:3" },
    { id: "16:9", label: "16:9" },
    { id: "3:2", label: "3:2" },
    { id: "2:3", label: "2:3" },
    { id: "9:16", label: "9:16" },
];

export default function EditPage() {
    const [prompt, setPrompt] = useState("");
    const [editMode, setEditMode] = useState("inpaint");
    const [brushSize, setBrushSize] = useState("medium");
    const [aspectRatio, setAspectRatio] = useState("1:1");
    const [uploadedImage, setUploadedImage] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [frameModalTab, setFrameModalTab] = useState<"recent" | "generations" | "liked">("generations");

    const selectedMode = EDIT_MODES.find((m) => m.id === editMode) || EDIT_MODES[0];

    const handleGenerate = useCallback(async () => {
        setIsGenerating(true);
        console.log("Editing:", { prompt, editMode, brushSize, aspectRatio });
        await new Promise((r) => setTimeout(r, 2000));
        setIsGenerating(false);
    }, [prompt, editMode, brushSize, aspectRatio]);

    const handleFileUpload = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    setUploadedImage(ev.target?.result as string);
                    setShowUploadModal(false);
                };
                reader.readAsDataURL(file);
            }
        };
        input.click();
    };

    return (
        <TooltipProvider delayDuration={300}>
            <div className="min-h-[calc(100vh-3.5rem)] bg-background flex flex-col">
                {/* Main Content - Canvas Area */}
                <div className="flex-1 flex items-center justify-center p-8">
                    {uploadedImage ? (
                        <div className="relative">
                            {/* Canvas with image */}
                            <div className="relative rounded-xl overflow-hidden border border-border/50 shadow-2xl">
                                <img src={uploadedImage} alt="Editing" className="max-w-full max-h-[60vh] object-contain" />
                                {/* Overlay for brush/mask (would be interactive in real app) */}
                                <div className="absolute inset-0 pointer-events-none" />
                            </div>

                            {/* Floating toolbar */}
                            <div className="absolute -right-16 top-1/2 -translate-y-1/2 flex flex-col gap-2 bg-card/90 backdrop-blur rounded-xl p-2 border border-border/50">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="w-10 h-10"><ZoomIn className="w-4 h-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">Zoom in</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="w-10 h-10"><ZoomOut className="w-4 h-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">Zoom out</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="w-10 h-10"><Move className="w-4 h-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">Pan</TooltipContent>
                                </Tooltip>
                                <div className="h-px bg-border my-1" />
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="w-10 h-10 text-destructive" onClick={() => setUploadedImage(null)}><X className="w-4 h-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">Clear image</TooltipContent>
                                </Tooltip>
                            </div>
                        </div>
                    ) : (
                        /* Empty state */
                        <div className="text-center">
                            <div className="relative mb-8 mx-auto w-fit">
                                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 flex items-center justify-center">
                                    <Wand2 className="w-12 h-12 text-primary" />
                                </div>
                                <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-primary animate-pulse" />
                            </div>

                            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-center mb-4 uppercase">
                                AI Image Editor
                            </h1>
                            <p className="text-muted-foreground text-center max-w-md mx-auto mb-8">
                                Inpaint, outpaint, remove objects, or replace elements with AI-powered precision
                            </p>

                            <Button size="lg" className="h-14 px-8 gap-3 text-lg" onClick={() => setShowUploadModal(true)}>
                                <Upload className="w-5 h-5" />
                                Upload Image to Edit
                            </Button>
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
                                    placeholder={editMode === "remove" ? "What would you like to remove?" : "Describe how you want to edit the image"}
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    className="pl-10 pr-4 h-12 bg-muted/50 border-border/50 text-base"
                                />
                            </div>
                            <Button
                                size="lg"
                                className="h-12 px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                                onClick={handleGenerate}
                                disabled={isGenerating || !uploadedImage}
                            >
                                {isGenerating ? (
                                    <><div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" /> Generating...</>
                                ) : (
                                    "Apply Edit"
                                )}
                            </Button>
                        </div>

                        {/* Row 2: Controls */}
                        <div className="flex items-center gap-2">
                            {/* Edit Mode */}
                            <Popover>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" className="h-10 px-3 bg-primary/10 border-primary/30 hover:bg-primary/20 text-primary font-medium gap-1.5">
                                                <selectedMode.icon className="w-4 h-4" />
                                                <span className="text-sm">{selectedMode.label}</span>
                                            </Button>
                                        </PopoverTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent>Select edit mode</TooltipContent>
                                </Tooltip>
                                <PopoverContent align="start" className="w-72 p-2">
                                    <div className="text-sm font-medium text-muted-foreground px-3 py-2">Edit mode</div>
                                    <div className="space-y-1">
                                        {EDIT_MODES.map((mode) => {
                                            const Icon = mode.icon;
                                            return (
                                                <button key={mode.id} onClick={() => setEditMode(mode.id)}
                                                    className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left", editMode === mode.id ? "bg-muted" : "hover:bg-muted/50")}>
                                                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                                                        <Icon className="w-4 h-4 text-primary" />
                                                    </span>
                                                    <div className="flex-1 min-w-0">
                                                        <span className="text-sm font-medium block">{mode.label}</span>
                                                        <span className="text-xs text-muted-foreground">{mode.description}</span>
                                                    </div>
                                                    {editMode === mode.id && <Check className="w-4 h-4 text-primary" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </PopoverContent>
                            </Popover>

                            {/* Brush Size */}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg px-1 h-10 border border-border/50">
                                        {BRUSH_SIZES.map((size) => (
                                            <Button
                                                key={size.id}
                                                variant="ghost"
                                                size="sm"
                                                className={cn("h-8 w-8 p-0", brushSize === size.id && "bg-muted")}
                                                onClick={() => setBrushSize(size.id)}
                                            >
                                                <span className="text-xs font-medium">{size.label}</span>
                                            </Button>
                                        ))}
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>Brush size</TooltipContent>
                            </Tooltip>

                            {/* Aspect Ratio (for outpaint) */}
                            {editMode === "outpaint" && (
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
                                        <TooltipContent>Output aspect ratio</TooltipContent>
                                    </Tooltip>
                                    <PopoverContent align="start" className="w-44 p-2">
                                        <div className="text-sm font-medium text-muted-foreground px-3 py-2">Aspect ratio</div>
                                        <div className="space-y-0.5">
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
                            )}

                            {/* Upload New */}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="outline" className="h-10 px-3 bg-muted/50 border-border/50 gap-1.5" onClick={() => setShowUploadModal(true)}>
                                        <Upload className="w-3.5 h-3.5" />
                                        <span className="text-sm">Upload</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Upload a new image</TooltipContent>
                            </Tooltip>
                        </div>
                    </div>
                </div>

                {/* Upload Modal */}
                <Dialog open={showUploadModal} onOpenChange={setShowUploadModal}>
                    <DialogContent className="max-w-2xl bg-[#1a1a1a] border-border/50">
                        <DialogHeader>
                            <VisuallyHidden>
                                <DialogTitle>Upload Image</DialogTitle>
                            </VisuallyHidden>
                            <Tabs value={frameModalTab} onValueChange={(v) => setFrameModalTab(v as typeof frameModalTab)} className="w-full">
                                <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto">
                                    <TabsTrigger value="recent" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Recently attached</TabsTrigger>
                                    <TabsTrigger value="generations" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Image Generations</TabsTrigger>
                                    <TabsTrigger value="liked" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Liked</TabsTrigger>
                                </TabsList>
                            </Tabs>
                        </DialogHeader>
                        <div className="py-6">
                            <button onClick={handleFileUpload}
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
