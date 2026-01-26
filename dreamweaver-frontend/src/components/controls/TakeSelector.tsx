"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Clapperboard, Shuffle, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface TakeSelectorProps {
    value: number;
    onChange: (value: number) => void;
    onGenerateVariations?: (seeds: number[]) => void;
    className?: string;
}

export function TakeSelector({ value, onChange, onGenerateVariations, className }: TakeSelectorProps) {
    const [variations, setVariations] = useState<number[]>([value]);
    const [isExpanded, setIsExpanded] = useState(false);

    const handleRandom = () => {
        const randomSeed = Math.floor(Math.random() * 10000);
        onChange(randomSeed);
        setVariations([randomSeed]);
    };

    const handleIncrement = () => {
        onChange(value + 1);
    };

    const handleDecrement = () => {
        onChange(Math.max(0, value - 1));
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value);
        if (!isNaN(val) && val >= 0) {
            onChange(val);
        }
    };

    const generateVariations = () => {
        const newVariations = [value, value + 1, value + 2, value + 3];
        setVariations(newVariations);
        setIsExpanded(true);
        onGenerateVariations?.(newVariations);
    };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div className={cn("flex flex-col gap-3", className)}>
                    {/* Label */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Clapperboard className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Take Selector
                            </span>
                        </div>
                    </div>

                    {/* Main control */}
                    <div className="flex items-center gap-2">
                        {/* Seed input with steppers */}
                        <div className="flex-1 flex items-center gap-1 bg-muted/50 rounded-lg border border-border/50 p-1">
                            <div className="flex flex-col">
                                <button
                                    onClick={handleIncrement}
                                    className="h-3.5 px-1.5 hover:bg-muted rounded-sm transition-colors"
                                >
                                    <ChevronUp className="w-3 h-3 text-muted-foreground" />
                                </button>
                                <button
                                    onClick={handleDecrement}
                                    className="h-3.5 px-1.5 hover:bg-muted rounded-sm transition-colors"
                                >
                                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                </button>
                            </div>

                            <div className="flex-1 flex items-center gap-1.5 px-2">
                                <span className="text-xs font-bold text-muted-foreground">Take</span>
                                <Input
                                    type="number"
                                    min="0"
                                    value={value}
                                    onChange={handleInputChange}
                                    className="h-7 w-full text-center font-mono text-sm bg-transparent border-none p-0"
                                />
                            </div>
                        </div>

                        {/* Random button */}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRandom}
                            className="h-9 gap-2"
                        >
                            <Shuffle className="w-3.5 h-3.5" />
                            Random
                        </Button>
                    </div>

                    {/* Generate variations button */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={generateVariations}
                        className="w-full gap-2"
                    >
                        Generate Variations
                    </Button>

                    {/* Variations display */}
                    {isExpanded && variations.length > 1 && (
                        <div className="grid grid-cols-4 gap-2">
                            {variations.map((seed, idx) => (
                                <button
                                    key={seed}
                                    onClick={() => onChange(seed)}
                                    className={cn(
                                        "flex flex-col items-center justify-center p-2 rounded-lg border transition-all",
                                        value === seed
                                            ? "bg-primary/10 border-primary text-primary"
                                            : "bg-muted/30 border-border/50 text-muted-foreground hover:border-muted-foreground"
                                    )}
                                >
                                    <div className="text-[10px] font-medium mb-1">
                                        Take {seed}
                                    </div>
                                    <div
                                        className={cn(
                                            "w-8 h-8 rounded border-2 flex items-center justify-center transition-all",
                                            value === seed ? "border-primary" : "border-border"
                                        )}
                                    >
                                        {value === seed ? (
                                            <div className="w-3 h-3 rounded-full bg-primary" />
                                        ) : (
                                            <div className="w-3 h-3 rounded-full border border-muted-foreground" />
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Description */}
                    <p className="text-xs text-muted-foreground">
                        Seed ensures reproducible results. Same seed = same output.
                    </p>
                </div>
            </TooltipTrigger>
            <TooltipContent>
                <p>Seed control for reproducible generation</p>
                <p className="text-xs text-muted-foreground">Like slate/take numbers on film sets</p>
            </TooltipContent>
        </Tooltip>
    );
}
