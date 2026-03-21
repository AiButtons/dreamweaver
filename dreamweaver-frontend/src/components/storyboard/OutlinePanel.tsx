"use client";

import React, { useMemo, useState } from "react";
import { Search, Plus, ChevronDown, GitBranch, Film, Clapperboard } from "lucide-react";
import type { StoryEdge, StoryNode, NodeType } from "@/app/storyboard/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type OutlineItem = {
  nodeId: string;
  nodeType: NodeType;
  label: string;
  segment: string;
};

const normalize = (value: string) => value.toLowerCase().trim();

const nodeTypeLabel: Record<NodeType, string> = {
  scene: "Scene",
  shot: "Shot",
  branch: "Branch",
  merge: "Merge",
  character_ref: "Character",
  background_ref: "Background",
};

const nodeTypeIcon = (nodeType: NodeType) => {
  if (nodeType === "shot") return Film;
  if (nodeType === "branch") return GitBranch;
  return Clapperboard;
};

const getEdgeType = (edge: StoryEdge): string | undefined =>
  typeof edge.data?.edgeType === "string" ? edge.data.edgeType : undefined;

const isPrimary = (edge: StoryEdge): boolean =>
  typeof edge.data?.isPrimary === "boolean" ? edge.data.isPrimary : true;

function buildPrimaryLine(nodes: StoryNode[], edges: StoryEdge[]) {
  const serialEdges = edges.filter((edge) => getEdgeType(edge) === "serial" && isPrimary(edge));
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, string>();

  for (const node of nodes) incomingCount.set(node.id, 0);
  for (const edge of serialEdges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    // Prefer first encountered primary serial link.
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, edge.target);
  }

  const starts = nodes.filter((node) => (incomingCount.get(node.id) ?? 0) === 0);
  const start = starts
    .slice()
    .sort((a, b) => (a.position.y - b.position.y) || (a.position.x - b.position.x))[0];

  const line: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = start?.id;
  while (cursor && !seen.has(cursor)) {
    line.push(cursor);
    seen.add(cursor);
    cursor = outgoing.get(cursor);
  }
  return { line, set: seen };
}

export function OutlinePanel({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onAddNode,
  onFocusNode,
}: {
  nodes: StoryNode[];
  edges: StoryEdge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onAddNode: (nodeType: NodeType) => void;
  onFocusNode?: (nodeId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [branchesOpen, setBranchesOpen] = useState(false);

  const { primaryItems, branchItems, otherItems } = useMemo(() => {
    const q = normalize(query);
    const match = (item: OutlineItem) =>
      !q
      || normalize(item.label).includes(q)
      || normalize(item.segment).includes(q)
      || normalize(nodeTypeLabel[item.nodeType]).includes(q);

    const { line, set: primarySet } = buildPrimaryLine(nodes, edges);
    const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
    const toItem = (id: string): OutlineItem | null => {
      const node = nodeById.get(id);
      if (!node) return null;
      return {
        nodeId: node.id,
        nodeType: node.data.nodeType,
        label: node.data.label,
        segment: node.data.segment,
      };
    };

    const primaryItemsRaw = line.map(toItem).filter((v): v is OutlineItem => Boolean(v));

    const branchTargets = new Set(
      edges
        .filter((edge) => {
          const type = getEdgeType(edge);
          return type === "branch" || type === "parallel";
        })
        .map((edge) => edge.target),
    );
    const branchItemsRaw = nodes
      .filter((node) => branchTargets.has(node.id))
      .sort((a, b) => (a.position.y - b.position.y) || (a.position.x - b.position.x))
      .map((node) => ({
        nodeId: node.id,
        nodeType: node.data.nodeType,
        label: node.data.label,
        segment: node.data.segment,
      }));

    const otherItemsRaw = nodes
      .filter((node) => !primarySet.has(node.id) && !branchTargets.has(node.id))
      .sort((a, b) => (a.position.y - b.position.y) || (a.position.x - b.position.x))
      .map((node) => ({
        nodeId: node.id,
        nodeType: node.data.nodeType,
        label: node.data.label,
        segment: node.data.segment,
      }));

    return {
      primaryItems: primaryItemsRaw.filter(match),
      branchItems: branchItemsRaw.filter(match),
      otherItems: otherItemsRaw.filter(match),
    };
  }, [edges, nodes, query]);

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-4 pt-4 pb-3 border-b border-border/60 bg-background/40">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold tracking-tight">Outline</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Scenes and shots on the primary line.
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="size-4" />
                Add
                <ChevronDown className="size-3 opacity-80" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>New</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onAddNode("scene")}>
                <Clapperboard className="mr-2 size-4" />
                Scene
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAddNode("shot")}>
                <Film className="mr-2 size-4" />
                Shot
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Advanced</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onAddNode("branch")}>
                <GitBranch className="mr-2 size-4" />
                Branch node
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-3 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search scenes, shots, branches..."
            className="pl-9 bg-background/60"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-3">
          <Section
            title="Primary Line"
            items={primaryItems}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            onFocusNode={onFocusNode}
          />

          <Collapsible open={branchesOpen} onOpenChange={setBranchesOpen}>
            <div className="flex items-center justify-between px-1">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Branches
              </div>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                  {branchesOpen ? "Hide" : "Show"}
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="mt-2">
              <Section
                title={null}
                items={branchItems}
                selectedNodeId={selectedNodeId}
                onSelectNode={onSelectNode}
                onFocusNode={onFocusNode}
              />
            </CollapsibleContent>
          </Collapsible>

          {otherItems.length > 0 ? (
            <Section
              title="Other"
              items={otherItems}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
              onFocusNode={onFocusNode}
            />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

function Section({
  title,
  items,
  selectedNodeId,
  onSelectNode,
  onFocusNode,
}: {
  title: string | null;
  items: OutlineItem[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onFocusNode?: (nodeId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="px-1">
        {title ? (
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            {title}
          </div>
        ) : null}
        <div className="mt-2 text-xs text-muted-foreground">Nothing here yet.</div>
      </div>
    );
  }

  return (
    <div className="px-1">
      {title ? (
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          {title}
        </div>
      ) : null}
      <div className={cn("mt-2 space-y-1", !title && "mt-0")}>
        {items.map((item) => {
          const active = item.nodeId === selectedNodeId;
          const Icon = nodeTypeIcon(item.nodeType);
          return (
            <button
              key={item.nodeId}
              type="button"
              onClick={() => {
                onSelectNode(item.nodeId);
                onFocusNode?.(item.nodeId);
              }}
              className={cn(
                "w-full text-left rounded-xl border px-3 py-2 transition-colors",
                "bg-card/40 border-border/60 hover:bg-card/70",
                active && "bg-card border-primary/40 ring-1 ring-primary/40",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground shrink-0" />
                    <div className="text-sm font-medium truncate">{item.label}</div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {item.segment}
                  </div>
                </div>
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {nodeTypeLabel[item.nodeType]}
                </Badge>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
