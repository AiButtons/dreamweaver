"use client";

import React from "react";
import { Plus, Trash2, Maximize2, ZoomIn, ZoomOut, MoreHorizontal, Clapperboard, Film, Undo2, Redo2 } from "lucide-react";
import type { NodeType } from "@/app/storyboard/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CanvasToolbarProps {
  onAddNode: (nodeType: NodeType) => void;
  onDeleteNode: () => void;
  onFitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  hasSelection: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
  onAddNode,
  onDeleteNode,
  onFitView,
  onZoomIn,
  onZoomOut,
  hasSelection,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}) => {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="absolute right-4 top-4 z-20 rounded-2xl glass p-1 border border-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.4)]">
        <div className="flex flex-col gap-1">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="rounded-xl hover:bg-white/10">
                    <Plus className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="left">Add</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>New</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onAddNode("scene")}>
                <Clapperboard className="mr-2 size-4" /> Scene
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAddNode("shot")}>
                <Film className="mr-2 size-4" /> Shot
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onAddNode("branch")}>
                <MoreHorizontal className="mr-2 size-4" /> Branch (advanced)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {hasSelection ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="rounded-xl hover:bg-rose-500/10 hover:text-rose-300"
                  onClick={onDeleteNode}
                >
                  <Trash2 className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Delete selected</TooltipContent>
            </Tooltip>
          ) : null}

          {(onUndo || onRedo) ? (
            <>
              <div className="h-px bg-white/10 my-1" />
              {onUndo ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="rounded-xl hover:bg-white/10 disabled:opacity-40"
                      onClick={onUndo}
                      disabled={!canUndo}
                    >
                      <Undo2 className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">Undo (⌘Z)</TooltipContent>
                </Tooltip>
              ) : null}
              {onRedo ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="rounded-xl hover:bg-white/10 disabled:opacity-40"
                      onClick={onRedo}
                      disabled={!canRedo}
                    >
                      <Redo2 className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">Redo (⌘⇧Z)</TooltipContent>
                </Tooltip>
              ) : null}
            </>
          ) : null}

          <div className="h-px bg-white/10 my-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="rounded-xl hover:bg-white/10"
                onClick={onFitView}
              >
                <Maximize2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Fit view</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="rounded-xl hover:bg-white/10">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="left">Zoom</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onZoomIn}>
                <ZoomIn className="mr-2 size-4" /> Zoom in
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onZoomOut}>
                <ZoomOut className="mr-2 size-4" /> Zoom out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default CanvasToolbar;

