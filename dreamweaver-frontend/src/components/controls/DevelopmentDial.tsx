"use client";

import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface DevelopmentDialProps {
    value: number;
    onChange: (value: number) => void;
    className?: string;
}

const PRESETS = [
    { value: 15, label: "Draft", description: "Fast preview, lower quality", angle: -135 },
    { value: 25, label: "Preview", description: "Balanced speed and quality", angle: -45 },
    { value: 35, label: "Pro", description: "Professional quality", angle: 45 },
    { value: 50, label: "Ultimate", description: "Maximum quality, slower", angle: 135 },
];

export function DevelopmentDial({ value, onChange, className }: DevelopmentDialProps) {
    const [isDragging, setIsDragging] = useState(false);

    // Find closest preset for display
    const closestPreset = PRESETS.reduce((prev, curr) =>
        Math.abs(curr.value - value) < Math.abs(prev.value - value) ? curr : prev
    );

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        setIsDragging(true);
        handleMouseMove(e);
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isDragging && e.type === "mousemove") return;

        const rect = e.currentTarget.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX);

        // Map angle to value (15-50)
        // -π to π -> 15 to 50
        const normalized = (angle + Math.PI) / (2 * Math.PI);
        const newValue = Math.round(15 + normalized * (50 - 15));
        onChange(Math.max(15, Math.min(50, newValue)));
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    React.useEffect(() => {
        if (isDragging) {
            const handleGlobalMouseUp = () => setIsDragging(false);
            window.addEventListener("mouseup", handleGlobalMouseUp);
            return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
        }
    }, [isDragging]);

    // Calculate rotation for indicator
    const rotation = ((value - 15) / (50 - 15)) * 360 - 180;

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div className={cn("flex flex-col items-center gap-3", className)}>
                    {/* Label */}
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Development
                    </span>

                    {/* Dial */}
                    <div
                        className="relative w-32 h-32 cursor-pointer select-none"
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                    >
                        {/* Outer ring with markings */}
                        <div className="absolute inset-0 rounded-full border-4 border-border/50 bg-muted/30">
                            {/* Preset markers */}
                            {PRESETS.map((preset) => (
                                <div
                                    key={preset.value}
                                    className="absolute w-0.5 h-3 bg-muted-foreground/30 origin-bottom"
                                    style={{
                                        left: "50%",
                                        top: "10%",
                                        transform: `translateX(-50%) rotate(${preset.angle}deg)`,
                                        transformOrigin: "50% 200%",
                                    }}
                                />
                            ))}
                        </div>

                        {/* Inner circle */}
                        <div className="absolute inset-3 rounded-full bg-card border-2 border-border flex items-center justify-center">
                            <div className="text-center">
                                <div className="text-2xl font-bold tabular-nums">{value}</div>
                                <div className="text-[10px] text-muted-foreground uppercase">steps</div>
                            </div>
                        </div>

                        {/* Indicator line */}
                        <div
                            className="absolute w-1 h-12 bg-primary rounded-full origin-bottom transition-transform"
                            style={{
                                left: "50%",
                                top: "20%",
                                transform: `translateX(-50%) rotate(${rotation}deg)`,
                                transformOrigin: "50% 250%",
                            }}
                        />

                        {/* Center knob */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-4 h-4 rounded-full bg-primary border-2 border-background shadow-lg" />
                        </div>
                    </div>

                    {/* Current preset label */}
                    <div className="text-center">
                        <div className="text-sm font-semibold">{closestPreset.label}</div>
                        <div className="text-xs text-muted-foreground">{closestPreset.description}</div>
                    </div>
                </div>
            </TooltipTrigger>
            <TooltipContent>
                <p>Inference steps control quality vs speed</p>
                <p className="text-xs text-muted-foreground">Like film development time</p>
            </TooltipContent>
        </Tooltip>
    );
}

// Need React import for useEffect
import * as React from "react";
