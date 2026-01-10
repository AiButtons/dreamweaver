"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Minus, Plus, RectangleHorizontal, Square, RectangleVertical, Monitor, Heart } from "lucide-react";
import { ASPECT_RATIOS, RESOLUTIONS } from "@/data/models";

interface ImageControlsProps {
    aspectRatio: string;
    resolution: string;
    batchSize: number;
    onAspectRatioChange: (value: string) => void;
    onResolutionChange: (value: string) => void;
    onBatchSizeChange: (value: number) => void;
}

export function ImageControls({
    aspectRatio,
    resolution,
    batchSize,
    onAspectRatioChange,
    onResolutionChange,
    onBatchSizeChange,
}: ImageControlsProps) {
    const getAspectIcon = (id: string) => {
        switch (id) {
            case "16:9":
                return <RectangleHorizontal className="h-3.5 w-3.5" />;
            case "4:3":
                return <Monitor className="h-3.5 w-3.5" />;
            case "1:1":
                return <Square className="h-3.5 w-3.5" />;
            case "9:16":
                return <RectangleVertical className="h-3.5 w-3.5" />;
            case "21:9":
                return <RectangleHorizontal className="h-3.5 w-3.5" />;
            default:
                return <Square className="h-3.5 w-3.5" />;
        }
    };

    return (
        <div className="flex items-center gap-4 flex-wrap">
            {/* Batch Size */}
            <div className="flex items-center gap-2">
                <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onBatchSizeChange(Math.max(1, batchSize - 1))}
                    disabled={batchSize <= 1}
                >
                    <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="min-w-[40px] text-center text-sm font-medium">
                    {batchSize}/4
                </span>
                <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onBatchSizeChange(Math.min(4, batchSize + 1))}
                    disabled={batchSize >= 4}
                >
                    <Plus className="h-3.5 w-3.5" />
                </Button>
            </div>

            {/* Aspect Ratio */}
            <ToggleGroup
                type="single"
                value={aspectRatio}
                onValueChange={(value) => value && onAspectRatioChange(value)}
                className="bg-muted rounded-lg p-1"
            >
                {ASPECT_RATIOS.slice(0, 4).map((ar) => (
                    <ToggleGroupItem
                        key={ar.id}
                        value={ar.id}
                        className="h-8 px-3 data-[state=on]:bg-background"
                    >
                        {getAspectIcon(ar.id)}
                        <span className="ml-1.5 text-xs">{ar.label}</span>
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>

            {/* Resolution */}
            <div className="flex items-center gap-2">
                <Heart className="h-4 w-4 text-muted-foreground" />
                <Select value={resolution} onValueChange={onResolutionChange}>
                    <SelectTrigger className="h-8 w-[80px] text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {RESOLUTIONS.map((res) => (
                            <SelectItem key={res.id} value={res.id}>
                                {res.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}
