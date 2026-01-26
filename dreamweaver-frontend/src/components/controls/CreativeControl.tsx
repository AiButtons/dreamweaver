"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Paintbrush, Ruler } from "lucide-react";
import { cn } from "@/lib/utils";

interface CreativeControlProps {
    value: number;
    onChange: (value: number) => void;
    className?: string;
}

const MARKERS = [
    { value: 2, label: "2" },
    { value: 4, label: "4" },
    { value: 6, label: "6" },
    { value: 8, label: "8" },
    { value: 10, label: "10" },
    { value: 12, label: "12" },
];

export function CreativeControl({ value, onChange, className }: CreativeControlProps) {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(parseFloat(e.target.value));
    };

    // Calculate position percentage
    const percentage = ((value - 2) / (12 - 2)) * 100;

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div className={cn("flex flex-col gap-3", className)}>
                    {/* Label */}
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Creative Control
                        </span>
                        <span className="text-xs font-mono tabular-nums">{value.toFixed(1)}</span>
                    </div>

                    {/* Slider container */}
                    <div className="relative px-4">
                        {/* Icons on sides */}
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Paintbrush className="w-4 h-4" />
                                <span className="text-xs">Interpretive</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                <span className="text-xs">Literal</span>
                                <Ruler className="w-4 h-4" />
                            </div>
                        </div>

                        {/* Track */}
                        <div className="relative h-2 bg-muted rounded-full">
                            {/* Fill */}
                            <div
                                className="absolute h-full bg-gradient-to-r from-purple-500/50 via-primary/50 to-blue-500/50 rounded-full transition-all"
                                style={{ width: `${percentage}%` }}
                            />

                            {/* Markers */}
                            {MARKERS.map((marker) => {
                                const markerPos = ((marker.value - 2) / (12 - 2)) * 100;
                                return (
                                    <div
                                        key={marker.value}
                                        className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-border"
                                        style={{ left: `${markerPos}%` }}
                                    />
                                );
                            })}

                            {/* Thumb */}
                            <div
                                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-primary rounded-full border-2 border-background shadow-lg transition-all"
                                style={{ left: `${percentage}%`, transform: `translate(-50%, -50%)` }}
                            />
                        </div>

                        {/* Actual slider input (invisible but functional) */}
                        <input
                            type="range"
                            min="2"
                            max="12"
                            step="0.5"
                            value={value}
                            onChange={handleChange}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />

                        {/* Labels */}
                        <div className="flex justify-between mt-2 px-1">
                            {MARKERS.map((marker) => (
                                <span
                                    key={marker.value}
                                    className={cn(
                                        "text-[10px] tabular-nums transition-colors",
                                        Math.abs(value - marker.value) < 0.5
                                            ? "text-primary font-semibold"
                                            : "text-muted-foreground"
                                    )}
                                >
                                    {marker.label}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Description */}
                    <div className="text-center">
                        <p className="text-xs text-muted-foreground">
                            {value < 5 && "More creative freedom, looser interpretation"}
                            {value >= 5 && value < 8 && "Balanced creativity and accuracy"}
                            {value >= 8 && "Strict adherence to prompt"}
                        </p>
                    </div>
                </div>
            </TooltipTrigger>
            <TooltipContent>
                <p>Guidance scale controls prompt adherence</p>
                <p className="text-xs text-muted-foreground">Like a director's creative control</p>
            </TooltipContent>
        </Tooltip>
    );
}
