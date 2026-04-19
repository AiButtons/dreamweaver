"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ExportMenuProps {
  storyboardId: string;
  storyboardTitle: string;
  disabled?: boolean;
}

type ExportFormat = "fountain" | "fdx" | "edl" | "fcpxml";

const FORMAT_META: Record<ExportFormat, { label: string; extension: string }> = {
  fountain: { label: "Fountain (.fountain)", extension: "fountain" },
  fdx: { label: "Final Draft (.fdx)", extension: "fdx" },
  edl: { label: "EDL (.edl)", extension: "edl" },
  fcpxml: { label: "FCP7 XML (.xml)", extension: "xml" },
};

const slugifyForFilename = (raw: string): string => {
  const base = (raw ?? "").toLowerCase().trim();
  const slug = base
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.length > 0 ? slug : "storyboard";
};

export function ExportMenu({ storyboardId, storyboardTitle, disabled }: ExportMenuProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    if (!storyboardId || isExporting) return;
    setIsExporting(true);
    try {
      const response = await fetch("/api/storyboard/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyboardId, format, title: storyboardTitle }),
      });
      if (!response.ok) {
        console.error(`Screenplay export failed: ${response.status} ${response.statusText}`);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slugifyForFilename(storyboardTitle)}.${FORMAT_META[format].extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Screenplay export failed", error);
    } finally {
      setIsExporting(false);
    }
  };

  const isDisabled = disabled || !storyboardId || isExporting;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={isDisabled}
          title="Export screenplay"
          aria-label="Export screenplay"
          className="h-7 gap-1.5 px-2 text-[11px]"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuLabel>Screenplay</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void handleExport("fountain");
          }}
        >
          {FORMAT_META.fountain.label}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void handleExport("fdx");
          }}
        >
          {FORMAT_META.fdx.label}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Post-production</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void handleExport("edl");
          }}
        >
          {FORMAT_META.edl.label}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void handleExport("fcpxml");
          }}
        >
          {FORMAT_META.fcpxml.label}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>AAF coming soon</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
