"use client";

import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Plus, Search, MoreHorizontal, Pin, PinOff, Copy, Trash2, RotateCcw, FolderOpen, FileText } from "lucide-react";

import { ScreenplayIngestForm } from "@/components/storyboard/ScreenplayIngestForm";

import { mutationRef, queryRef } from "@/lib/convexRefs";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import type {
  StoryboardLibraryItem,
  StoryboardSort,
  StoryboardTemplate,
} from "./types";

type AuthSessionEnvelope = {
  user?: { id?: string | null } | null;
  session?: { id?: string | null } | null;
} | null;

type LibraryMode = "all" | "pinned" | "trash";

const formatRelativeDate = (timestamp: number) => {
  const delta = Date.now() - timestamp;
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (delta < minute) return "just now";
  if (delta < hour) return `${Math.floor(delta / minute)}m ago`;
  if (delta < day) return `${Math.floor(delta / hour)}h ago`;
  return `${Math.floor(delta / day)}d ago`;
};

const sortOptions: Array<{ value: StoryboardSort; label: string }> = [
  { value: "updated_desc", label: "Updated (newest)" },
  { value: "updated_asc", label: "Updated (oldest)" },
  { value: "title_asc", label: "Title (A-Z)" },
  { value: "created_desc", label: "Created (newest)" },
];

export default function StoryboardLibraryPage() {
  const router = useRouter();
  const sessionState = authClient.useSession();
  const sessionData = (sessionState.data as AuthSessionEnvelope | undefined) ?? null;
  const isAuthLoading = sessionState.isPending;
  const isAuthenticated = Boolean(sessionData?.user?.id ?? sessionData?.session?.id);

  const [mode, setMode] = useState<LibraryMode>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<StoryboardSort>("updated_desc");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [screenplayOpen, setScreenplayOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const libraryRows = useQuery(
    queryRef("storyboards:listLibrary"),
    isAuthenticated
      ? {
          status: mode === "trash" ? "trashed" : "active",
          pinnedOnly: mode === "pinned",
          search,
          sort,
          limit: 120,
        }
      : "skip",
  ) as StoryboardLibraryItem[] | undefined;

  const templates = useQuery(
    queryRef("storyboards:listTemplates"),
    isAuthenticated ? {} : "skip",
  ) as StoryboardTemplate[] | undefined;

  const createFromTemplate = useMutation(mutationRef("storyboards:createStoryboardFromTemplate"));
  const renameStoryboard = useMutation(mutationRef("storyboards:renameStoryboard"));
  const setPinned = useMutation(mutationRef("storyboards:setStoryboardPinned"));
  const trashStoryboard = useMutation(mutationRef("storyboards:trashStoryboard"));
  const restoreStoryboard = useMutation(mutationRef("storyboards:restoreStoryboard"));
  const deleteStoryboardPermanently = useMutation(mutationRef("storyboards:deleteStoryboardPermanently"));
  const duplicateStoryboard = useMutation(mutationRef("storyboards:duplicateStoryboard"));
  const backfillStoryboardMetadata = useMutation(mutationRef("storyboards:backfillStoryboardMetadata"));

  useEffect(() => {
    if (!isAuthenticated) return;
    void backfillStoryboardMetadata({ limit: 500 }).catch(() => undefined);
  }, [backfillStoryboardMetadata, isAuthenticated]);

  const rows = useMemo(() => libraryRows ?? [], [libraryRows]);

  const handleCreateFromTemplate = async (template: StoryboardTemplate) => {
    setIsBusy(true);
    try {
      const storyboardId = (await createFromTemplate({
        templateId: template.templateId,
        title: template.name,
      })) as string;
      setTemplateOpen(false);
      router.push(`/storyboard/${storyboardId}`);
    } finally {
      setIsBusy(false);
    }
  };

  const openStoryboard = (storyboardId: string) => {
    router.push(`/storyboard/${storyboardId}`);
  };

  const handleRename = async (storyboard: StoryboardLibraryItem) => {
    const nextTitle = window.prompt("Rename storyboard", storyboard.title);
    if (!nextTitle || nextTitle.trim().length === 0) return;
    await renameStoryboard({ storyboardId: storyboard._id, title: nextTitle.trim() });
  };

  const handleDuplicate = async (storyboard: StoryboardLibraryItem) => {
    const nextTitle = window.prompt("Duplicate as", `Copy of ${storyboard.title}`);
    const duplicatedId = (await duplicateStoryboard({
      storyboardId: storyboard._id,
      title: nextTitle?.trim() || undefined,
    })) as string;
    router.push(`/storyboard/${duplicatedId}`);
  };

  if (isAuthLoading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] w-full items-center justify-center bg-slate-950 text-slate-200">
        Loading storyboards...
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] w-full items-center justify-center bg-slate-950 px-6 text-center text-slate-200">
        <div>
          <h1 className="text-lg font-semibold">Sign in required</h1>
          <p className="mt-2 text-sm text-slate-400">
            Storyboard library is protected by Better Auth.
          </p>
          <div className="mt-4">
            <Button asChild>
              <Link href="/auth?redirect=%2Fstoryboard">Go to sign in</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-background text-foreground">
      <div className="mx-auto h-full max-w-[1400px] px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Storyboard Library</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Organize projects, resume past work, and create from film-ready templates.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Dialog open={screenplayOpen} onOpenChange={setScreenplayOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <FileText className="size-4" />
                  From Screenplay
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Ingest a screenplay</DialogTitle>
                  <DialogDescription>
                    Paste a scene — we&apos;ll extract characters, generate
                    portraits, and build a shot list with structured metadata.
                  </DialogDescription>
                </DialogHeader>
                <ScreenplayIngestForm
                  onIngested={() => setScreenplayOpen(false)}
                />
              </DialogContent>
            </Dialog>

            <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="size-4" />
                  New Storyboard
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Choose a template</DialogTitle>
                <DialogDescription>
                  Start with a built-in storyboard scaffold. You can customize every node after creation.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                {(templates ?? []).map((template) => (
                  <button
                    key={template.templateId}
                    type="button"
                    onClick={() => void handleCreateFromTemplate(template)}
                    disabled={isBusy}
                    className="rounded-xl border border-border/70 bg-card/40 p-4 text-left transition-colors hover:bg-card/70"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">{template.name}</div>
                      <Badge variant="secondary" className="text-[10px]">{template.mode}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">{template.description}</div>
                  </button>
                ))}
              </div>
            </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search storyboards"
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button variant={mode === "all" ? "secondary" : "outline"} size="sm" onClick={() => setMode("all")}>All</Button>
            <Button variant={mode === "pinned" ? "secondary" : "outline"} size="sm" onClick={() => setMode("pinned")}>Pinned</Button>
            <Button variant={mode === "trash" ? "secondary" : "outline"} size="sm" onClick={() => setMode("trash")}>Trash</Button>
          </div>

          <div className="ml-auto w-52">
            <Select value={sort} onValueChange={(value) => setSort(value as StoryboardSort)}>
              <SelectTrigger>
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-5 h-[calc(100%-9rem)] overflow-y-auto pr-1 storyboard-scroll">
          {rows.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/20">
              <div className="text-center">
                <div className="text-lg font-semibold">{mode === "trash" ? "Trash is empty" : "No storyboards yet"}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {mode === "trash"
                    ? "Deleted projects will appear here for 30 days before purge."
                    : "Create your first storyboard from a template to get started."}
                </div>
                {mode !== "trash" ? (
                  <Button className="mt-4" onClick={() => setTemplateOpen(true)}>Create from template</Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((storyboard) => (
                <article key={storyboard._id} className="overflow-hidden rounded-2xl border border-border/70 bg-card/40">
                  <button
                    type="button"
                    onClick={() => openStoryboard(storyboard._id)}
                    className="block w-full text-left"
                  >
                    <div className="h-36 w-full bg-[radial-gradient(circle_at_25%_20%,rgba(163,230,53,0.25),transparent_36%),linear-gradient(180deg,rgba(31,41,55,0.82),rgba(15,23,42,0.95))]">
                      {storyboard.coverImageUrl ? (
                        <img src={storyboard.coverImageUrl} alt={storyboard.title} className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                  </button>

                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openStoryboard(storyboard._id)}
                        className="text-left"
                      >
                        <h3 className="text-sm font-semibold leading-tight">{storyboard.title}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Updated {formatRelativeDate(storyboard.updatedAt)}
                        </p>
                      </button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openStoryboard(storyboard._id)}>
                            <FolderOpen className="mr-2 size-4" /> Open
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void handleRename(storyboard)}>Rename</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void handleDuplicate(storyboard)}>
                            <Copy className="mr-2 size-4" /> Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void setPinned({ storyboardId: storyboard._id, isPinned: !Boolean(storyboard.isPinned) })}>
                            {storyboard.isPinned ? <PinOff className="mr-2 size-4" /> : <Pin className="mr-2 size-4" />}
                            {storyboard.isPinned ? "Unpin" : "Pin"}
                          </DropdownMenuItem>
                          {mode === "trash" ? (
                            <>
                              <DropdownMenuItem onClick={() => void restoreStoryboard({ storyboardId: storyboard._id })}>
                                <RotateCcw className="mr-2 size-4" /> Restore
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => void deleteStoryboardPermanently({ storyboardId: storyboard._id })}
                                className="text-rose-400"
                              >
                                <Trash2 className="mr-2 size-4" /> Delete permanently
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <DropdownMenuItem onClick={() => void trashStoryboard({ storyboardId: storyboard._id })}>
                              <Trash2 className="mr-2 size-4" /> Move to trash
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <Badge variant="secondary">{storyboard.nodeCount ?? 0} nodes</Badge>
                      <Badge variant="secondary">{storyboard.imageCount ?? 0} images</Badge>
                      <Badge variant="secondary">{storyboard.videoCount ?? 0} videos</Badge>
                      {storyboard.isPinned ? <Badge className="bg-lime-500/20 text-lime-300">Pinned</Badge> : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
