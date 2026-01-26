"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Camera, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface VirtualCameraRigProps {
    selectedAngle: string;
    onAngleSelect: (angle: string, prompt: string) => void;
    generatedAngles?: string[];
    className?: string;
}

const CAMERA_POSITIONS = [
    {
        id: "front",
        label: "Front",
        prompt: "<sks> front view eye-level close-up",
        x: 50,
        y: 20,
    },
    {
        id: "left-45",
        label: "L45°",
        prompt: "<sks> left side view 45-degree angle close-up",
        x: 20,
        y: 50,
    },
    {
        id: "original",
        label: "Center",
        prompt: "<sks> center view close-up",
        x: 50,
        y: 50,
    },
    {
        id: "right-45",
        label: "R45°",
        prompt: "<sks> right side view 45-degree angle close-up",
        x: 80,
        y: 50,
    },
    {
        id: "wide",
        label: "Wide",
        prompt: "<sks> wide establishing shot",
        x: 50,
        y: 80,
    },
];

export function VirtualCameraRig({
    selectedAngle,
    onAngleSelect,
    generatedAngles = [],
    className,
}: VirtualCameraRigProps) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div className={cn("flex flex-col gap-3", className)}>
                    {/* Label */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Camera className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Multi-Angle Setup
                            </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                            {generatedAngles.length}/{CAMERA_POSITIONS.length} angles
                        </span>
                    </div>

                    {/* Virtual rig overhead view */}
                    <div className="relative w-full aspect-square bg-gradient-to-b from-muted/30 to-muted/50 rounded-xl border border-border/50 p-4">
                        {/* Grid lines */}
                        <div className="absolute inset-4">
                            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border/30" />
                            <div className="absolute top-1/2 left-0 right-0 h-px bg-border/30" />

                            {/* Diagonal lines */}
                            <svg className="absolute inset-0 w-full h-full opacity-20">
                                <line
                                    x1="0%"
                                    y1="0%"
                                    x2="100%"
                                    y2="100%"
                                    stroke="currentColor"
                                    strokeWidth="1"
                                    strokeDasharray="4 4"
                                />
                                <line
                                    x1="100%"
                                    y1="0%"
                                    x2="0%"
                                    y2="100%"
                                    stroke="currentColor"
                                    strokeWidth="1"
                                    strokeDasharray="4 4"
                                />
                            </svg>
                        </div>

                        {/* Subject indicator (center) */}
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center border-2 border-border">
                                <div className="w-4 h-4 rounded-full bg-muted-foreground/30" />
                            </div>
                            <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground whitespace-nowrap">
                                Subject
                            </span>
                        </div>

                        {/* Camera positions */}
                        {CAMERA_POSITIONS.map((position) => {
                            const isSelected = selectedAngle === position.id;
                            const isGenerated = generatedAngles.includes(position.id);

                            return (
                                <button
                                    key={position.id}
                                    onClick={() => onAngleSelect(position.id, position.prompt)}
                                    className={cn(
                                        "absolute group transition-all",
                                        isSelected && "z-10"
                                    )}
                                    style={{
                                        left: `${position.x}%`,
                                        top: `${position.y}%`,
                                        transform: "translate(-50%, -50%)",
                                    }}
                                >
                                    {/* Camera icon */}
                                    <div
                                        className={cn(
                                            "relative w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all",
                                            isSelected
                                                ? "bg-primary border-primary scale-110"
                                                : isGenerated
                                                    ? "bg-primary/20 border-primary/50 hover:scale-105"
                                                    : "bg-muted/50 border-border/50 hover:bg-muted hover:border-muted-foreground hover:scale-105"
                                        )}
                                    >
                                        {isGenerated ? (
                                            <Check className="w-4 h-4 text-primary" />
                                        ) : (
                                            <Camera
                                                className={cn(
                                                    "w-4 h-4",
                                                    isSelected ? "text-primary-foreground" : "text-muted-foreground"
                                                )}
                                            />
                                        )}

                                        {/* Selection ring */}
                                        {isSelected && (
                                            <div className="absolute inset-0 rounded-full border-2 border-primary animate-ping opacity-75" />
                                        )}
                                    </div>

                                    {/* Label */}
                                    <div
                                        className={cn(
                                            "absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-medium whitespace-nowrap transition-colors",
                                            isSelected ? "text-primary" : "text-muted-foreground"
                                        )}
                                    >
                                        {position.label}
                                    </div>

                                    {/* Hover tooltip */}
                                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                        <div className="bg-popover text-popover-foreground text-[9px] px-2 py-1 rounded border border-border shadow-md whitespace-nowrap">
                                            {position.prompt.replace("<sks> ", "")}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {/* Legend */}
                    <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 rounded-full border-2 border-border/50 bg-muted/50" />
                            <span>Available</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 rounded-full border-2 border-primary/50 bg-primary/20 flex items-center justify-center">
                                <Check className="w-2 h-2 text-primary" />
                            </div>
                            <span>Generated</span>
                        </div>
                    </div>
                </div>
            </TooltipTrigger>
            <TooltipContent>
                <p>Virtual camera rig for multi-angle generation</p>
                <p className="text-xs text-muted-foreground">Click positions to generate that angle</p>
            </TooltipContent>
        </Tooltip>
    );
}
