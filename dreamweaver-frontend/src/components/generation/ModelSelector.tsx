"use client";

import { cn } from "@/lib/utils";
import { IMAGE_MODELS, VIDEO_MODELS, EDIT_MODELS, type Model } from "@/data/models";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface ModelSelectorProps {
    type: "image" | "video" | "edit";
    value: string;
    onChange: (value: string) => void;
}

export function ModelSelector({ type, value, onChange }: ModelSelectorProps) {
    const models = type === "image" ? IMAGE_MODELS : type === "video" ? VIDEO_MODELS : EDIT_MODELS;

    const selectedModel = models.find((m) => m.id === value) || models[0];

    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger className="w-full h-auto py-2">
                <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-muted text-xs font-bold uppercase">
                        {selectedModel.provider.slice(0, 2)}
                    </div>
                    <div className="flex-1 text-left">
                        <div className="text-sm font-medium">{selectedModel.name}</div>
                        <div className="text-xs text-muted-foreground">{selectedModel.description}</div>
                    </div>
                </div>
            </SelectTrigger>
            <SelectContent>
                {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                        <div className="flex items-center gap-3 py-1">
                            <div className="flex h-8 w-8 items-center justify-center rounded bg-muted text-xs font-bold uppercase">
                                {model.provider.slice(0, 2)}
                            </div>
                            <div className="flex-1">
                                <div className="text-sm font-medium">{model.name}</div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    {model.capabilities.slice(0, 3).map((cap) => (
                                        <Badge key={cap} variant="secondary" className="text-[10px] px-1.5 py-0">
                                            {cap.replace("_", " ")}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
