"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface MotionCurveProps {
    value: "linear" | "ease-in" | "ease-out" | "custom";
    onChange: (value: "linear" | "ease-in" | "ease-out" | "custom", customCurve?: number[]) => void;
    className?: string;
}

const PRESETS = [
    { id: "linear" as const, label: "Linear", description: "Constant speed" },
    { id: "ease-in" as const, label: "Ease In", description: "Slow → Fast" },
    { id: "ease-out" as const, label: "Ease Out", description: "Fast → Slow" },
    { id: "custom" as const, label: "Custom", description: "Draw your own" },
];

export function MotionCurve({ value, onChange, className }: MotionCurveProps) {
    const [isDrawing, setIsDrawing] = useState(false);
    const [customPoints, setCustomPoints] = useState<number[]>([0, 0.5, 1]);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        drawCurve();
    }, [value, customPoints]);

    const drawCurve = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Grid
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);

        // Vertical lines
        for (let i = 0; i <= 4; i++) {
            const x = (width / 4) * i;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        // Horizontal lines
        for (let i = 0; i <= 2; i++) {
            const y = (height / 2) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        ctx.setLineDash([]);

        // Draw curve
        ctx.strokeStyle = "hsl(var(--primary))";
        ctx.lineWidth = 3;
        ctx.beginPath();

        const drawPoints = getPoints();

        for (let i = 0; i < drawPoints.length; i++) {
            const x = (i / (drawPoints.length - 1)) * width;
            const y = height - drawPoints[i] * height;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.stroke();

        // Start/end markers
        ctx.fillStyle = "hsl(var(--primary))";
        ctx.beginPath();
        ctx.arc(0, height - drawPoints[0] * height, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(width, height - drawPoints[drawPoints.length - 1] * height, 4, 0, Math.PI * 2);
        ctx.fill();
    };

    const getPoints = (): number[] => {
        const points = 50;
        const result: number[] = [];

        for (let i = 0; i < points; i++) {
            const t = i / (points - 1);
            let y = 0;

            switch (value) {
                case "linear":
                    y = t;
                    break;
                case "ease-in":
                    y = t * t; // Quadratic ease-in
                    break;
                case "ease-out":
                    y = 1 - (1 - t) * (1 - t); // Quadratic ease-out
                    break;
                case "custom":
                    // Interpolate custom points
                    const idx = t * (customPoints.length - 1);
                    const i1 = Math.floor(idx);
                    const i2 = Math.ceil(idx);
                    const frac = idx - i1;
                    y = customPoints[i1] + (customPoints[i2] - customPoints[i1]) * frac;
                    break;
            }

            result.push(Math.max(0, Math.min(1, y)));
        }

        return result;
    };

    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (value !== "custom") return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const normalizedY = 1 - y / canvas.height;
        const normalizedX = x / canvas.width;

        // Add or update point
        const idx = Math.round(normalizedX * (customPoints.length - 1));
        const newPoints = [...customPoints];
        newPoints[idx] = normalizedY;
        setCustomPoints(newPoints);
        onChange("custom", newPoints);
    };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div className={cn("flex flex-col gap-3", className)}>
                    {/* Label */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Speed Ramp
                            </span>
                        </div>
                    </div>

                    {/* Canvas */}
                    <div className="relative bg-muted/30 rounded-lg border border-border/50 p-3">
                        <canvas
                            ref={canvasRef}
                            width={280}
                            height={140}
                            onClick={handleCanvasClick}
                            className={cn(
                                "w-full h-auto",
                                value === "custom" && "cursor-crosshair"
                            )}
                        />

                        {/* Axis labels */}
                        <div className="absolute -left-2 top-3 text-[9px] text-muted-foreground">Fast</div>
                        <div className="absolute -left-2 bottom-3 text-[9px] text-muted-foreground">Slow</div>
                        <div className="absolute left-3 -bottom-2 text-[9px] text-muted-foreground">Start</div>
                        <div className="absolute right-3 -bottom-2 text-[9px] text-muted-foreground">End</div>
                    </div>

                    {/* Presets */}
                    <div className="grid grid-cols-4 gap-2">
                        {PRESETS.map((preset) => (
                            <button
                                key={preset.id}
                                onClick={() => onChange(preset.id)}
                                className={cn(
                                    "px-2 py-1.5 rounded-lg border text-xs font-medium transition-all",
                                    value === preset.id
                                        ? "bg-primary/10 border-primary text-primary"
                                        : "bg-muted/50 border-border/50 text-muted-foreground hover:border-muted-foreground"
                                )}
                            >
                                <div className="font-semibold">{preset.label}</div>
                                <div className="text-[9px] opacity-70">{preset.description}</div>
                            </button>
                        ))}
                    </div>

                    {value === "custom" && (
                        <p className="text-xs text-muted-foreground">
                            Click on the curve to adjust the speed ramp
                        </p>
                    )}
                </div>
            </TooltipTrigger>
            <TooltipContent>
                <p>Motion curve for speed ramping</p>
                <p className="text-xs text-muted-foreground">Like ramping on cinema cameras</p>
            </TooltipContent>
        </Tooltip>
    );
}
