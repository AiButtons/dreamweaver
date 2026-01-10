"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImageUploader } from "@/components/generation/ImageUploader";
import { ModelSelector } from "@/components/generation/ModelSelector";
import { CameraSliders } from "@/components/camera/CameraSliders";
import { Sparkles, Wand2, Eraser, Expand } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CameraState } from "@/types";
import { buildPrompt } from "@/components/camera/CameraControl3D";

// Dynamic import for 3D component
const CameraControl3D = dynamic(
    () => import("@/components/camera/CameraControl3D").then((mod) => mod.CameraControl3D),
    { ssr: false, loading: () => <div className="w-full aspect-[4/3] bg-[#1a1a1a] rounded-xl animate-pulse" /> }
);

export default function EditPage() {
    const [inputImage, setInputImage] = useState<string | undefined>();
    const [prompt, setPrompt] = useState("");
    const [editMode, setEditMode] = useState<"edit" | "inpaint" | "outpaint">("edit");
    const [cameraState, setCameraState] = useState<CameraState>({
        azimuth: 0,
        elevation: 0,
        distance: 1,
    });
    const [modelId, setModelId] = useState("gpt-image-1");
    const [isGenerating, setIsGenerating] = useState(false);
    const [outputImage, setOutputImage] = useState<string | undefined>();

    const cameraPrompt = buildPrompt(cameraState.azimuth, cameraState.elevation, cameraState.distance);

    const handleGenerate = useCallback(async () => {
        if (!inputImage) return;
        setIsGenerating(true);
        console.log("Editing with:", { inputImage, prompt, editMode, cameraState, modelId });
        await new Promise((resolve) => setTimeout(resolve, 2000));
        setIsGenerating(false);
    }, [inputImage, prompt, editMode, cameraState, modelId]);

    return (
        <div className="min-h-screen bg-background">
            {/* Hero */}
            <div className="relative py-12 text-center">
                <p className="text-sm font-medium text-primary tracking-wide uppercase mb-3">
                    AI-POWERED EDITING
                </p>
                <h1 className="text-4xl font-bold tracking-tight mb-4">
                    IMAGE EDIT
                </h1>
                <p className="text-muted-foreground max-w-xl mx-auto">
                    Transform your images with natural language. Inpaint, outpaint, or apply camera adjustments.
                </p>
            </div>

            <div className="container max-w-6xl mx-auto px-4 pb-16">
                <div className="grid lg:grid-cols-2 gap-6">
                    {/* Left: Input & Output */}
                    <div className="space-y-6">
                        {/* Edit Mode Tabs */}
                        <Tabs value={editMode} onValueChange={(v) => setEditMode(v as typeof editMode)}>
                            <TabsList className="grid w-full grid-cols-3">
                                <TabsTrigger value="edit" className="flex items-center gap-2">
                                    <Wand2 className="h-4 w-4" />
                                    Edit
                                </TabsTrigger>
                                <TabsTrigger value="inpaint" className="flex items-center gap-2">
                                    <Eraser className="h-4 w-4" />
                                    Inpaint
                                </TabsTrigger>
                                <TabsTrigger value="outpaint" className="flex items-center gap-2">
                                    <Expand className="h-4 w-4" />
                                    Outpaint
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>

                        {/* Input Image */}
                        <Card className="bg-card border-border">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-medium">Input Image</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ImageUploader value={inputImage} onChange={setInputImage} />
                            </CardContent>
                        </Card>

                        {/* Output Preview */}
                        <Card className="bg-card border-border">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-medium">Result</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="aspect-square bg-[#0f0f0f] rounded-lg flex items-center justify-center">
                                    {outputImage ? (
                                        <img src={outputImage} alt="Output" className="w-full h-full object-cover rounded-lg" />
                                    ) : (
                                        <p className="text-sm text-muted-foreground">Edited image will appear here</p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right: Controls */}
                    <div className="space-y-4">
                        {/* Prompt */}
                        <Card className="bg-card border-border">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-medium">Edit Prompt</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <Textarea
                                    placeholder={
                                        editMode === "edit"
                                            ? "Describe what changes you want to make..."
                                            : editMode === "inpaint"
                                                ? "Describe what to fill in the masked area..."
                                                : "Describe what to add in the extended areas..."
                                    }
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    className="min-h-[100px] resize-none"
                                />
                            </CardContent>
                        </Card>

                        {/* Camera Adjustment */}
                        <Card className="bg-card border-border">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                    <Wand2 className="h-4 w-4 text-primary" />
                                    Camera Adjustment (Optional)
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <CameraControl3D
                                    value={cameraState}
                                    onChange={setCameraState}
                                    imageUrl={inputImage}
                                />
                                <CameraSliders value={cameraState} onChange={setCameraState} />
                            </CardContent>
                        </Card>

                        {/* Model */}
                        <Card className="bg-card border-border">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-medium">Model</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ModelSelector type="edit" value={modelId} onChange={setModelId} />
                            </CardContent>
                        </Card>

                        {/* Generated Prompt */}
                        <Card className="bg-card border-border">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-xs font-medium text-muted-foreground">Camera Prompt</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-xs font-mono text-primary bg-primary/10 rounded-md p-2">{cameraPrompt}</p>
                            </CardContent>
                        </Card>

                        {/* Generate */}
                        <Button
                            size="lg"
                            className="w-full h-12 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                            onClick={handleGenerate}
                            disabled={isGenerating || !inputImage}
                        >
                            {isGenerating ? (
                                <>
                                    <div className="h-4 w-4 mr-2 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="h-4 w-4 mr-2" />
                                    {editMode === "edit" ? "EDIT IMAGE" : editMode === "inpaint" ? "INPAINT" : "OUTPAINT"}
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
