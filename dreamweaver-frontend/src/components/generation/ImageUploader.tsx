"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, X, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ImageUploaderProps {
    value?: string; // base64 or URL
    onChange: (value: string | undefined) => void;
    className?: string;
}

export function ImageUploader({ value, onChange, className }: ImageUploaderProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const handleFileChange = useCallback(
        (file: File) => {
            if (!file.type.startsWith("image/")) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target?.result as string;
                onChange(result);
            };
            reader.readAsDataURL(file);
        },
        [onChange]
    );

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setIsDragging(false);

            const file = e.dataTransfer.files[0];
            if (file) handleFileChange(file);
        },
        [handleFileChange]
    );

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback(() => {
        setIsDragging(false);
    }, []);

    const handleClick = () => {
        fileInputRef.current?.click();
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFileChange(file);
    };

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange(undefined);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    return (
        <div className={cn("relative", className)}>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleInputChange}
                className="hidden"
            />

            {value ? (
                <div className="relative group rounded-xl overflow-hidden border border-border bg-card">
                    <img
                        src={value}
                        alt="Uploaded"
                        className="w-full h-auto object-cover"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleClick}
                            className="text-xs"
                        >
                            Replace
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleClear}
                            className="text-xs"
                        >
                            <X className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>
            ) : (
                <div
                    onClick={handleClick}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    className={cn(
                        "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors",
                        isDragging
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50 hover:bg-accent/50"
                    )}
                >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                        <Upload className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="text-center">
                        <p className="text-sm font-medium">Drop Image Here</p>
                        <p className="text-xs text-muted-foreground">- or -</p>
                        <p className="text-sm font-medium text-primary">Click to Upload</p>
                    </div>
                </div>
            )}
        </div>
    );
}
