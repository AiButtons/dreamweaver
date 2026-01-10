"use client";

import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import type { CameraState } from "@/types";
import {
    AZIMUTH_STEPS,
    ELEVATION_STEPS,
    DISTANCE_STEPS,
    snapToNearest,
} from "./CameraControl3D";

interface CameraSlidersProps {
    value: CameraState;
    onChange: (state: CameraState) => void;
}

export function CameraSliders({ value, onChange }: CameraSlidersProps) {
    const handleReset = () => {
        onChange({ azimuth: 0, elevation: 0, distance: 1 });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">Slider Controls</h3>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReset}
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                    <RotateCcw className="mr-1.5 h-3 w-3" />
                    Reset
                </Button>
            </div>

            {/* Azimuth */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <span className="inline-flex items-center gap-1.5 rounded bg-[#00ff88]/20 px-2 py-0.5 text-xs font-medium text-[#00ff88]">
                            Azimuth (Horizontal Rotation)
                        </span>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                            0°=front, 90°=right, 180°=back, 270°=left
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="rounded bg-muted px-2 py-1 text-sm font-mono">
                            {Math.round(value.azimuth)}°
                        </span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onChange({ ...value, azimuth: 0 })}
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>
                <Slider
                    value={[value.azimuth]}
                    onValueChange={([v]) => onChange({ ...value, azimuth: v })}
                    onValueCommit={([v]) =>
                        onChange({ ...value, azimuth: snapToNearest(v, AZIMUTH_STEPS) })
                    }
                    min={0}
                    max={315}
                    step={1}
                    className="[&_[role=slider]]:bg-[#00ff88] [&_[role=slider]]:border-[#00ff88] [&_.bg-primary]:bg-[#00ff88]"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>0</span>
                    <span>315</span>
                </div>
            </div>

            {/* Elevation */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <span className="inline-flex items-center gap-1.5 rounded bg-[#ff69b4]/20 px-2 py-0.5 text-xs font-medium text-[#ff69b4]">
                            Elevation (Vertical Angle)
                        </span>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                            -30°=low angle, 0°=eye level, 60°=high angle
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="rounded bg-muted px-2 py-1 text-sm font-mono">
                            {Math.round(value.elevation)}°
                        </span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onChange({ ...value, elevation: 0 })}
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>
                <Slider
                    value={[value.elevation]}
                    onValueChange={([v]) => onChange({ ...value, elevation: v })}
                    onValueCommit={([v]) =>
                        onChange({ ...value, elevation: snapToNearest(v, ELEVATION_STEPS) })
                    }
                    min={-30}
                    max={60}
                    step={1}
                    className="[&_[role=slider]]:bg-[#ff69b4] [&_[role=slider]]:border-[#ff69b4] [&_.bg-primary]:bg-[#ff69b4]"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>-30</span>
                    <span>60</span>
                </div>
            </div>

            {/* Distance */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <span className="inline-flex items-center gap-1.5 rounded bg-[#ffa500]/20 px-2 py-0.5 text-xs font-medium text-[#ffa500]">
                            Distance
                        </span>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                            0.6=close-up, 1.0=medium, 1.4=wide
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="rounded bg-muted px-2 py-1 text-sm font-mono">
                            {value.distance.toFixed(1)}
                        </span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onChange({ ...value, distance: 1 })}
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>
                <Slider
                    value={[value.distance]}
                    onValueChange={([v]) => onChange({ ...value, distance: v })}
                    onValueCommit={([v]) =>
                        onChange({ ...value, distance: snapToNearest(v, DISTANCE_STEPS) })
                    }
                    min={0.6}
                    max={1.4}
                    step={0.01}
                    className="[&_[role=slider]]:bg-[#ffa500] [&_[role=slider]]:border-[#ffa500] [&_.bg-primary]:bg-[#ffa500]"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>0.6</span>
                    <span>1.4</span>
                </div>
            </div>
        </div>
    );
}
