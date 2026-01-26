"use client";

import { useCallback, useState } from "react";
import { Upload, X, Image as ImageIcon, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileUploadProps {
    onFileUpload: (file: File, dataUrl: string) => void;
    onClear?: () => void;
    accept?: string;
    maxSizeMB?: number;
    className?: string;
    disabled?: boolean;
}

export function FileUpload({
    onFileUpload,
    onClear,
    accept = "image/*,video/*",
    maxSizeMB = 50,
    className,
    disabled = false,
}: FileUploadProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const validateFile = useCallback((file: File): string | null => {
        // Check file size
        const fileSizeMB = file.size / (1024 * 1024);
        if (fileSizeMB > maxSizeMB) {
            return `File too large. Max size: ${maxSizeMB}MB`;
        }

        // Check file type
        const acceptedTypes = accept.split(",").map(t => t.trim());
        const isAccepted = acceptedTypes.some(type => {
            if (type === "image/*") return file.type.startsWith("image/");
            if (type === "video/*") return file.type.startsWith("video/");
            return file.type === type;
        });

        if (!isAccepted) {
            return "Invalid file type";
        }

        return null;
    }, [accept, maxSizeMB]);

    const processFile = useCallback(async (file: File) => {
        setError(null);
        setIsProcessing(true);

        const validationError = validateFile(file);
        if (validationError) {
            setError(validationError);
            setIsProcessing(false);
            return;
        }

        try {
            // Read file as data URL
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUrl = e.target?.result as string;
                setUploadedFile(file);
                setPreview(dataUrl);
                setIsProcessing(false);
                onFileUpload(file, dataUrl);
            };
            reader.onerror = () => {
                setError("Failed to read file");
                setIsProcessing(false);
            };
            reader.readAsDataURL(file);
        } catch (err) {
            setError("Failed to process file");
            setIsProcessing(false);
        }
    }, [validateFile, onFileUpload]);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) setIsDragging(true);
    }, [disabled]);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        if (disabled) return;

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            processFile(files[0]);
        }
    }, [disabled, processFile]);

    const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            processFile(files[0]);
        }
    }, [processFile]);

    const handleClear = useCallback(() => {
        setUploadedFile(null);
        setPreview(null);
        setError(null);
        onClear?.();
    }, [onClear]);

    const isImage = uploadedFile?.type.startsWith("image/");
    const isVideo = uploadedFile?.type.startsWith("video/");

    return (
        <div className={cn("relative", className)}>
            {/* Upload Area */}
            {!uploadedFile && (
                <div
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    className={cn(
                        "relative rounded-lg border-2 border-dashed transition-all",
                        isDragging
                            ? "border-primary bg-primary/5 scale-[1.02]"
                            : "border-border/50 hover:border-border",
                        disabled && "opacity-50 cursor-not-allowed",
                        error && "border-destructive"
                    )}
                >
                    <label
                        className={cn(
                            "flex flex-col items-center justify-center py-12 px-6 cursor-pointer",
                            disabled && "cursor-not-allowed"
                        )}
                    >
                        <input
                            type="file"
                            className="hidden"
                            accept={accept}
                            onChange={handleFileInput}
                            disabled={disabled || isProcessing}
                        />

                        {isProcessing ? (
                            <>
                                <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
                                <p className="text-sm font-medium">Processing file...</p>
                            </>
                        ) : (
                            <>
                                <Upload className={cn(
                                    "w-12 h-12 mb-4 transition-colors",
                                    isDragging ? "text-primary" : "text-muted-foreground"
                                )} />
                                <p className="text-sm font-medium mb-1">
                                    {isDragging ? "Drop file here" : "Drag & drop or click to upload"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Max {maxSizeMB}MB • {accept.replace(/\*/g, "any")}
                                </p>
                            </>
                        )}
                    </label>
                </div>
            )}

            {/* Preview */}
            {uploadedFile && preview && (
                <div className="relative rounded-lg border border-border overflow-hidden bg-muted/20">
                    <div className="relative aspect-video bg-black/5">
                        {isImage && (
                            <img
                                src={preview}
                                alt="Preview"
                                className="w-full h-full object-contain"
                            />
                        )}
                        {isVideo && (
                            <video
                                src={preview}
                                controls
                                className="w-full h-full"
                            />
                        )}

                        {/* Clear Button */}
                        <button
                            onClick={handleClear}
                            className="absolute top-2 right-2 p-2 rounded-full bg-background/90 hover:bg-background border border-border shadow-lg transition-all hover:scale-110"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* File Info */}
                    <div className="p-3 border-t border-border bg-background/50">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{uploadedFile.name}</p>
                                <p className="text-xs text-muted-foreground">
                                    {(uploadedFile.size / (1024 * 1024)).toFixed(2)} MB
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="mt-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <p className="text-sm text-destructive">{error}</p>
                </div>
            )}
        </div>
    );
}
