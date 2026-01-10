"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { CAMERAS, LENSES, FOCAL_LENGTHS, APERTURES } from "@/data/models";
import type { CameraSettings } from "@/types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Camera, CircleDot, Focus, Aperture } from "lucide-react";

interface CameraSettingsPanelProps {
    value: CameraSettings;
    onChange: (settings: CameraSettings) => void;
}

export function CameraSettingsPanel({ value, onChange }: CameraSettingsPanelProps) {
    const [tab, setTab] = useState<"all" | "recommended">("all");

    const selectedCamera = CAMERAS.find((c) => c.id === value.cameraId) || CAMERAS[0];
    const selectedLens = LENSES.find((l) => l.id === value.lensId) || LENSES[0];

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    className="h-auto w-full justify-start gap-3 px-4 py-3 bg-card border-border hover:bg-accent"
                >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                        <Camera className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 text-left">
                        <div className="text-sm font-medium">{selectedCamera.name}</div>
                        <div className="text-xs text-muted-foreground">
                            {selectedLens.name}, {value.focalLength}mm, {value.aperture}
                        </div>
                    </div>
                    <CircleDot className="h-4 w-4 text-primary" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[420px] p-0" align="end">
                <div className="p-4">
                    {/* Tabs */}
                    <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "recommended")}>
                        <TabsList className="grid w-full grid-cols-2 mb-4">
                            <TabsTrigger value="all">All</TabsTrigger>
                            <TabsTrigger value="recommended">Recommended</TabsTrigger>
                        </TabsList>
                    </Tabs>

                    {/* Selected summary */}
                    <div className="grid grid-cols-4 gap-2 mb-4">
                        <div className="flex flex-col items-center gap-1 rounded-lg bg-muted/50 p-2">
                            <Camera className="h-4 w-4 text-muted-foreground" />
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Camera</span>
                            <span className="text-xs font-medium truncate max-w-full">{selectedCamera.name.split(" ")[0]}</span>
                        </div>
                        <div className="flex flex-col items-center gap-1 rounded-lg bg-muted/50 p-2">
                            <CircleDot className="h-4 w-4 text-muted-foreground" />
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Lens</span>
                            <span className="text-xs font-medium truncate max-w-full">{selectedLens.name.split(" ")[0]}</span>
                        </div>
                        <div className="flex flex-col items-center gap-1 rounded-lg bg-primary/10 border border-primary/20 p-2">
                            <Focus className="h-4 w-4 text-primary" />
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Focal</span>
                            <span className="text-sm font-bold text-primary">{value.focalLength}</span>
                        </div>
                        <div className="flex flex-col items-center gap-1 rounded-lg bg-muted/50 p-2">
                            <Aperture className="h-4 w-4 text-muted-foreground" />
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Aperture</span>
                            <span className="text-xs font-medium">{value.aperture}</span>
                        </div>
                    </div>

                    {/* Camera selection */}
                    <div className="space-y-2 mb-4">
                        <label className="text-xs font-medium text-muted-foreground">Camera Body</label>
                        <div className="grid grid-cols-3 gap-2">
                            {CAMERAS.slice(0, 6).map((camera) => (
                                <button
                                    key={camera.id}
                                    onClick={() => onChange({ ...value, cameraId: camera.id })}
                                    className={cn(
                                        "flex flex-col items-center gap-1 rounded-lg border p-2 transition-colors",
                                        value.cameraId === camera.id
                                            ? "border-primary bg-primary/10"
                                            : "border-border hover:border-primary/50"
                                    )}
                                >
                                    <Camera className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-[10px] uppercase text-muted-foreground">{camera.type}</span>
                                    <span className="text-xs font-medium truncate max-w-full">{camera.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Lens selection */}
                    <div className="space-y-2 mb-4">
                        <label className="text-xs font-medium text-muted-foreground">Lens</label>
                        <div className="grid grid-cols-2 gap-2">
                            {LENSES.map((lens) => (
                                <button
                                    key={lens.id}
                                    onClick={() => onChange({ ...value, lensId: lens.id })}
                                    className={cn(
                                        "flex flex-col items-center gap-1 rounded-lg border p-2 transition-colors",
                                        value.lensId === lens.id
                                            ? "border-primary bg-primary/10"
                                            : "border-border hover:border-primary/50"
                                    )}
                                >
                                    <CircleDot className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-[10px] uppercase text-muted-foreground">{lens.type}</span>
                                    <span className="text-xs font-medium">{lens.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Focal length */}
                    <div className="space-y-2 mb-4">
                        <label className="text-xs font-medium text-muted-foreground">Focal Length (mm)</label>
                        <div className="flex flex-wrap gap-1.5">
                            {FOCAL_LENGTHS.map((fl) => (
                                <button
                                    key={fl}
                                    onClick={() => onChange({ ...value, focalLength: fl })}
                                    className={cn(
                                        "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                                        value.focalLength === fl
                                            ? "border-primary bg-primary text-primary-foreground"
                                            : "border-border hover:border-primary/50"
                                    )}
                                >
                                    {fl}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Aperture */}
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Aperture</label>
                        <div className="flex flex-wrap gap-1.5">
                            {APERTURES.map((ap) => (
                                <button
                                    key={ap}
                                    onClick={() => onChange({ ...value, aperture: ap })}
                                    className={cn(
                                        "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                                        value.aperture === ap
                                            ? "border-primary bg-primary text-primary-foreground"
                                            : "border-border hover:border-primary/50"
                                    )}
                                >
                                    {ap}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
