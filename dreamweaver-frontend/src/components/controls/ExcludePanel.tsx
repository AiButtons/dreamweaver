"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExcludePanelProps {
    value: string[];
    onChange: (value: string[]) => void;
    className?: string;
}

const COMMON_EXCLUSIONS = [
    { id: "distortion", label: "Distortion" },
    { id: "motion-blur", label: "Motion Blur" },
    { id: "grain", label: "Grain" },
    { id: "wide-shot", label: "Wide Shot" },
    { id: "rotation", label: "Rotation" },
    { id: "morphing", label: "Morphing" },
    { id: "full-body", label: "Full Body" },
    { id: "spinning", label: "Spinning" },
    { id: "double-heads", label: "Double Heads" },
];

export function ExcludePanel({ value, onChange, className }: ExcludePanelProps) {
    const [customInput, setCustomInput] = useState("");
    const [showCustom, setShowCustom] = useState(false);

    const toggleExclusion = (id: string, label: string) => {
        if (value.includes(label)) {
            onChange(value.filter((v) => v !== label));
        } else {
            onChange([...value, label]);
        }
    };

    const addCustom = () => {
        if (customInput.trim() && !value.includes(customInput.trim())) {
            onChange([...value, customInput.trim()]);
            setCustomInput("");
            setShowCustom(false);
        }
    };

    const removeCustom = (item: string) => {
        onChange(value.filter((v) => v !== item));
    };

    const commonIds = COMMON_EXCLUSIONS.map((e) => e.label);
    const customExclusions = value.filter((v) => !commonIds.includes(v));

    return (
        <div className={cn("flex flex-col gap-3", className)}>
            {/* Label */}
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Exclude from Generation
                </span>
                <span className="text-xs text-muted-foreground">
                    {value.length} active
                </span>
            </div>

            {/* Common exclusions grid */}
            <div className="grid grid-cols-3 gap-2">
                {COMMON_EXCLUSIONS.map((exclusion) => {
                    const isActive = value.includes(exclusion.label);
                    return (
                        <button
                            key={exclusion.id}
                            onClick={() => toggleExclusion(exclusion.id, exclusion.label)}
                            className={cn(
                                "px-3 py-2 rounded-lg border text-xs font-medium transition-all",
                                isActive
                                    ? "bg-destructive/10 border-destructive/50 text-destructive"
                                    : "bg-muted/50 border-border/50 text-muted-foreground hover:border-muted-foreground"
                            )}
                        >
                            {isActive && <span className="mr-1">✓</span>}
                            {exclusion.label}
                        </button>
                    );
                })}
            </div>

            {/* Custom exclusions */}
            {customExclusions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {customExclusions.map((item) => (
                        <div
                            key={item}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-destructive/10 border border-destructive/50"
                        >
                            <span className="text-xs font-medium text-destructive">{item}</span>
                            <button
                                onClick={() => removeCustom(item)}
                                className="text-destructive/60 hover:text-destructive"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Add custom */}
            {!showCustom ? (
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCustom(true)}
                    className="w-full gap-2"
                >
                    <Plus className="w-3 h-3" />
                    Add Custom Exclusion
                </Button>
            ) : (
                <div className="flex gap-2">
                    <Input
                        placeholder="e.g., blurry background"
                        value={customInput}
                        onChange={(e) => setCustomInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addCustom()}
                        className="flex-1 h-9"
                        autoFocus
                    />
                    <Button onClick={addCustom} size="sm" className="h-9">
                        Add
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setShowCustom(false);
                            setCustomInput("");
                        }}
                        className="h-9"
                    >
                        Cancel
                    </Button>
                </div>
            )}

            {/* Info */}
            <p className="text-xs text-muted-foreground">
                Selected items will be avoided during generation
            </p>
        </div>
    );
}
