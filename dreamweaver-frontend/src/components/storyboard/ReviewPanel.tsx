"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { queryRef } from "@/lib/convexRefs";
import {
  TAKE_STATUS_OPTIONS,
  type StoryNode,
  type TakeStatus,
  type UserIdentity,
} from "@/app/storyboard/types";
import { formatTimecode, groupComments } from "@/lib/review";
import { cn } from "@/lib/utils";

export interface ReviewCallbacks {
  addComment: (input: {
    mediaAssetId: string;
    body: string;
    timecodeMs?: number;
    parentCommentId?: string;
    authorName?: string;
    authorEmail?: string;
  }) => Promise<string | void>;
  editComment: (input: { commentId: string; body: string }) => Promise<void>;
  deleteComment: (input: { commentId: string }) => Promise<void>;
  resolveComment: (input: { commentId: string; resolved: boolean }) => Promise<void>;
  setTakeStatus: (input: { mediaAssetId: string; takeStatus?: TakeStatus }) => Promise<void>;
}

interface ReviewPanelProps {
  storyboardId?: string;
  selectedNode: StoryNode | null;
  userIdentity?: UserIdentity | null;
  callbacks?: ReviewCallbacks;
}

// Shape of a row coming back from `listMediaComments`. We don't import the
// generated Convex types here to keep this file loosely-coupled; the fields
// mirror the mediaComments validator in convex/schema.ts.
type MediaCommentRow = {
  _id: string;
  storyboardId: string;
  mediaAssetId: string;
  userId: string;
  authorName?: string;
  authorEmail?: string;
  parentCommentId?: string;
  timecodeMs?: number;
  body: string;
  status: "open" | "resolved" | "deleted";
  resolvedAt?: number;
  resolvedByUserId?: string;
  createdAt: number;
  updatedAt: number;
};

// Shape of a row from listNodeMedia — we need `takeStatus` to reflect what's
// persisted (the storyboard snapshot doesn't thread the field through).
type MediaAssetRow = {
  _id: string;
  kind: "image" | "video";
  takeStatus?: TakeStatus;
};

const TONE_CLASSES: Record<"success" | "info" | "warn" | "muted", string> = {
  success: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  info: "bg-sky-500/20 text-sky-200 border-sky-500/40",
  warn: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  muted: "bg-zinc-500/20 text-zinc-200 border-zinc-500/40",
};

export default function ReviewPanel({
  storyboardId,
  selectedNode,
  userIdentity,
  callbacks,
}: ReviewPanelProps) {
  const activeImageId = selectedNode?.data.media?.activeImageId;
  const activeVideoId = selectedNode?.data.media?.activeVideoId;
  const imageEntry = selectedNode && activeImageId
    ? selectedNode.data.media?.images?.find((m) => m.id === activeImageId)
    : undefined;
  const videoEntry = selectedNode && activeVideoId
    ? selectedNode.data.media?.videos?.find((m) => m.id === activeVideoId)
    : undefined;

  const hasVideo = Boolean(activeVideoId);
  const hasImage = Boolean(activeImageId);
  const hasMedia = hasVideo || hasImage;

  // Start on the video master if present — video is the primary review
  // surface for a motion storyboard. Fall back to image-only nodes.
  const [masterKind, setMasterKind] = useState<"image" | "video">(hasVideo ? "video" : "image");
  useEffect(() => {
    if (hasVideo) setMasterKind("video");
    else if (hasImage) setMasterKind("image");
  }, [hasVideo, hasImage, activeImageId, activeVideoId]);

  const activeMasterId = masterKind === "video" ? activeVideoId : activeImageId;
  const activeMasterUrl = masterKind === "video" ? videoEntry?.url : imageEntry?.url;

  if (!selectedNode || !hasMedia || !storyboardId) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card/30 p-4 text-xs text-muted-foreground">
        <div className="font-semibold text-foreground/80 mb-1">Review</div>
        <div>Select a node with generated media to review.</div>
      </div>
    );
  }

  return (
    <ReviewPanelWithMedia
      storyboardId={storyboardId}
      selectedNode={selectedNode}
      userIdentity={userIdentity}
      callbacks={callbacks}
      masterKind={masterKind}
      setMasterKind={setMasterKind}
      hasVideo={hasVideo}
      hasImage={hasImage}
      activeMasterId={activeMasterId ?? undefined}
      activeMasterUrl={activeMasterUrl}
    />
  );
}

interface ReviewPanelWithMediaProps {
  storyboardId: string;
  selectedNode: StoryNode;
  userIdentity?: UserIdentity | null;
  callbacks?: ReviewCallbacks;
  masterKind: "image" | "video";
  setMasterKind: (kind: "image" | "video") => void;
  hasVideo: boolean;
  hasImage: boolean;
  activeMasterId?: string;
  activeMasterUrl?: string;
}

function ReviewPanelWithMedia({
  storyboardId,
  selectedNode,
  userIdentity,
  callbacks,
  masterKind,
  setMasterKind,
  hasVideo,
  hasImage,
  activeMasterId,
  activeMasterUrl,
}: ReviewPanelWithMediaProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  // Defaults ON once the video has been played past 0 — the user is
  // scrubbing with intent and we assume they want pinned comments. The
  // toggle is rendered but defaults reset when the master changes.
  const [pinAtCurrent, setPinAtCurrent] = useState(false);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<MediaCommentRow | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset transient state when the active master changes — otherwise the
  // composer / reply context carries stale data across masters.
  useEffect(() => {
    setCurrentTimeMs(0);
    setDurationMs(0);
    setPinAtCurrent(false);
    setBody("");
    setReplyTo(null);
    setSubmitError(null);
  }, [activeMasterId]);

  const commentsRaw = useQuery(
    queryRef("mediaComments:listMediaComments"),
    activeMasterId
      ? { mediaAssetId: activeMasterId }
      : "skip",
  ) as MediaCommentRow[] | undefined;

  // Load the master asset row just to read `takeStatus`. Uses listNodeMedia
  // rather than a dedicated `get` because the former already has an index
  // for this node + storyboard combination and we only need one row.
  const nodeMedia = useQuery(
    queryRef("mediaAssets:listNodeMedia"),
    activeMasterId
      ? {
          storyboardId,
          nodeId: selectedNode.id,
          kind: masterKind,
          limit: 50,
        }
      : "skip",
  ) as MediaAssetRow[] | undefined;

  const currentTakeStatus = useMemo(() => {
    if (!nodeMedia || !activeMasterId) return undefined;
    const row = nodeMedia.find((r) => r._id === activeMasterId);
    return row?.takeStatus;
  }, [nodeMedia, activeMasterId]);

  const grouped = useMemo(() => groupComments(commentsRaw ?? []), [commentsRaw]);
  const openCommentsWithTimecode = useMemo(
    () => grouped.topLevel.filter((c) => c.status === "open" && typeof c.timecodeMs === "number"),
    [grouped.topLevel],
  );

  const handleVideoTimeUpdate = () => {
    if (!videoRef.current) return;
    const ms = Math.round(videoRef.current.currentTime * 1000);
    setCurrentTimeMs(ms);
    if (ms > 0 && !pinAtCurrent && replyTo === null) {
      // First non-zero scrub since mount — assume the user wants pinned
      // comments by default (matches Frame.io review convention).
      setPinAtCurrent(true);
    }
    if (ms === 0 && pinAtCurrent && replyTo === null) {
      setPinAtCurrent(false);
    }
  };

  const handleVideoLoadedMetadata = () => {
    if (!videoRef.current) return;
    if (Number.isFinite(videoRef.current.duration)) {
      setDurationMs(Math.round(videoRef.current.duration * 1000));
    }
  };

  const handleSeekToMs = (ms: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, ms / 1000);
    setCurrentTimeMs(ms);
  };

  const handleSetTakeStatus = async (next?: TakeStatus) => {
    if (!callbacks || !activeMasterId) return;
    try {
      await callbacks.setTakeStatus({ mediaAssetId: activeMasterId, takeStatus: next });
    } catch {
      // Silent — the UI re-reads from Convex and the stale state will
      // resolve on the next query tick. A future enhancement can surface a
      // toast here.
    }
  };

  const handlePost = async () => {
    if (!callbacks || !activeMasterId) return;
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const timecodeMs = replyTo
        ? replyTo.timecodeMs
        : (masterKind === "video" && pinAtCurrent ? currentTimeMs : undefined);
      const input: Parameters<ReviewCallbacks["addComment"]>[0] = {
        mediaAssetId: activeMasterId,
        body: trimmed,
      };
      if (timecodeMs !== undefined) input.timecodeMs = timecodeMs;
      if (replyTo) input.parentCommentId = replyTo._id;
      if (userIdentity?.name) input.authorName = userIdentity.name;
      else input.authorName = "You";
      if (userIdentity?.email) input.authorEmail = userIdentity.email;
      await callbacks.addComment(input);
      setBody("");
      setReplyTo(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to post comment";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const composerTimecodeLabel = replyTo
    ? formatTimecode(replyTo.timecodeMs)
    : formatTimecode(currentTimeMs);

  return (
    <div className="space-y-4">
      {/* Header / master toggle */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Review master
          </div>
          {hasImage && hasVideo ? (
            <div className="inline-flex rounded-md border border-border/60 bg-background/60 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setMasterKind("video")}
                className={cn(
                  "px-2 py-0.5 rounded",
                  masterKind === "video" ? "bg-primary/20 text-foreground" : "text-muted-foreground",
                )}
              >
                Video
              </button>
              <button
                type="button"
                onClick={() => setMasterKind("image")}
                className={cn(
                  "px-2 py-0.5 rounded",
                  masterKind === "image" ? "bg-primary/20 text-foreground" : "text-muted-foreground",
                )}
              >
                Image
              </button>
            </div>
          ) : null}
        </div>

        {activeMasterUrl ? (
          <div className="mt-3">
            {masterKind === "video" ? (
              <video
                ref={videoRef}
                src={activeMasterUrl}
                controls
                className="w-full rounded"
                onTimeUpdate={handleVideoTimeUpdate}
                onLoadedMetadata={handleVideoLoadedMetadata}
              />
            ) : (
              <img src={activeMasterUrl} alt="Review master" className="w-full rounded" />
            )}
          </div>
        ) : (
          <div className="mt-3 text-xs text-muted-foreground">
            Master URL unavailable. The asset may still be rendering.
          </div>
        )}

        {/* Timeline pin strip (video only) */}
        {masterKind === "video" && durationMs > 0 ? (
          <TimelinePinStrip
            openComments={openCommentsWithTimecode}
            durationMs={durationMs}
            onSeekMs={handleSeekToMs}
          />
        ) : null}
      </div>

      {/* Take-status pill row */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Take status
        </div>
        <div className="flex flex-wrap gap-2">
          {TAKE_STATUS_OPTIONS.map((opt) => {
            const active = currentTakeStatus === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={!callbacks}
                onClick={() => handleSetTakeStatus(active ? undefined : opt.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  "border-border/60 bg-background/60 hover:bg-background/80",
                  active && TONE_CLASSES[opt.tone],
                  !callbacks && "opacity-50 cursor-not-allowed",
                )}
              >
                {opt.label}
              </button>
            );
          })}
          {currentTakeStatus ? (
            <button
              type="button"
              disabled={!callbacks}
              onClick={() => handleSetTakeStatus(undefined)}
              className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs text-muted-foreground hover:bg-background/80"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {/* Comment list */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Comments
        </div>
        {commentsRaw === undefined ? (
          <CommentSkeletons />
        ) : grouped.topLevel.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">
            No comments yet. Share the first note.
          </div>
        ) : (
          <div className="space-y-3">
            {grouped.topLevel.map((c) => (
              <CommentBlock
                key={c._id}
                comment={c}
                replies={grouped.repliesByParent.get(c._id) ?? []}
                currentUserId={userIdentity?.userId}
                callbacks={callbacks}
                onReply={() => {
                  setReplyTo(c);
                  setSubmitError(null);
                }}
                onSeek={
                  masterKind === "video" && typeof c.timecodeMs === "number"
                    ? () => handleSeekToMs(c.timecodeMs as number)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* New-comment composer */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-2">
        {replyTo ? (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5">
              Replying to {replyTo.authorName ?? "Anonymous"}
              {typeof replyTo.timecodeMs === "number" ? ` · ${formatTimecode(replyTo.timecodeMs)}` : ""}
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="text-muted-foreground/80 hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : null}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={replyTo ? "Write a reply..." : "Add a review note..."}
          rows={3}
          className="w-full rounded-md border border-border/60 bg-background/60 p-2 text-xs outline-none focus:ring-1 focus:ring-primary/40"
          disabled={submitting || !callbacks}
        />
        <div className="flex items-center justify-between gap-2">
          {masterKind === "video" && !replyTo ? (
            <button
              type="button"
              onClick={() => setPinAtCurrent((v) => !v)}
              className={cn(
                "rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[11px]",
                pinAtCurrent && "border-primary/50 bg-primary/15",
              )}
            >
              {pinAtCurrent
                ? `Pin at ${composerTimecodeLabel}`
                : "No pin — whole asset"}
            </button>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {replyTo
                ? typeof replyTo.timecodeMs === "number"
                  ? `Reply will inherit ${formatTimecode(replyTo.timecodeMs)}`
                  : "Reply on whole asset"
                : "Whole-asset comment"}
            </span>
          )}
          <button
            type="button"
            onClick={handlePost}
            disabled={submitting || body.trim().length === 0 || !callbacks}
            className={cn(
              "rounded-md border px-3 py-1 text-xs font-semibold",
              "border-primary/40 bg-primary/20 text-foreground hover:bg-primary/30",
              (submitting || body.trim().length === 0 || !callbacks) && "opacity-50 cursor-not-allowed",
            )}
          >
            {submitting ? "Posting..." : "Post"}
          </button>
        </div>
        {submitError ? (
          <div className="text-[11px] text-rose-300">{submitError}</div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TimelinePinStrip({
  openComments,
  durationMs,
  onSeekMs,
}: {
  openComments: MediaCommentRow[];
  durationMs: number;
  onSeekMs: (ms: number) => void;
}) {
  return (
    <div className="mt-2">
      <div className="relative h-4 w-full rounded bg-background/60 border border-border/60">
        {openComments.map((c) => {
          const tc = c.timecodeMs ?? 0;
          const pct = Math.min(100, Math.max(0, (tc / durationMs) * 100));
          const tooltip = `${(c.authorName ?? "Anonymous")} · ${formatTimecode(tc)} — ${c.body.slice(0, 40)}${c.body.length > 40 ? "…" : ""}`;
          return (
            <button
              key={c._id}
              type="button"
              title={tooltip}
              onClick={() => {
                onSeekMs(tc);
                const el = document.getElementById(`review-comment-${c._id}`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-sky-400 ring-1 ring-sky-200/60 hover:bg-sky-300"
              style={{ left: `${pct}%` }}
              aria-label={`Jump to comment at ${formatTimecode(tc)}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function CommentSkeletons() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-md bg-background/60 border border-border/60 p-2">
          <div className="h-3 w-24 rounded bg-muted/40 animate-pulse" />
          <div className="mt-2 h-3 w-full rounded bg-muted/30 animate-pulse" />
          <div className="mt-1 h-3 w-3/4 rounded bg-muted/30 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function MentionText({ body }: { body: string }) {
  // Split on @mentions. Decorative only — no lookup / notification.
  const parts = body.split(/(@\w+)/g);
  return (
    <span className="text-xs whitespace-pre-wrap text-foreground/90">
      {parts.map((part, i) =>
        /^@\w+$/.test(part) ? (
          <span key={i} className="text-sky-300">{part}</span>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </span>
  );
}

function CommentBlock({
  comment,
  replies,
  currentUserId,
  callbacks,
  onReply,
  onSeek,
}: {
  comment: MediaCommentRow;
  replies: MediaCommentRow[];
  currentUserId?: string;
  callbacks?: ReviewCallbacks;
  onReply: () => void;
  onSeek?: () => void;
}) {
  return (
    <div
      id={`review-comment-${comment._id}`}
      className={cn(
        "rounded-md border border-border/60 bg-background/60 p-2",
        comment.status === "resolved" && "opacity-60",
      )}
    >
      <CommentRow
        comment={comment}
        currentUserId={currentUserId}
        callbacks={callbacks}
        canReply={comment.status !== "deleted"}
        canResolve={true}
        onReply={onReply}
        onSeek={onSeek}
      />
      {replies.length > 0 ? (
        <div className="mt-2 space-y-2 border-l-2 border-border/40 pl-3">
          {replies.map((r) => (
            <CommentRow
              key={r._id}
              comment={r}
              currentUserId={currentUserId}
              callbacks={callbacks}
              canReply={false}
              canResolve={false}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CommentRow({
  comment,
  currentUserId,
  callbacks,
  canReply,
  canResolve,
  onReply,
  onSeek,
}: {
  comment: MediaCommentRow;
  currentUserId?: string;
  callbacks?: ReviewCallbacks;
  canReply: boolean;
  canResolve: boolean;
  onReply?: () => void;
  onSeek?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  if (comment.status === "deleted") {
    return (
      <div className="text-xs italic text-muted-foreground">[deleted]</div>
    );
  }

  const isAuthor = Boolean(currentUserId) && comment.userId === currentUserId;
  const hasTimecode = typeof comment.timecodeMs === "number";

  const commitEdit = async () => {
    if (!callbacks) return;
    const next = draft.trim();
    if (next.length === 0) return;
    try {
      await callbacks.editComment({ commentId: comment._id, body: next });
      setEditing(false);
    } catch {
      // fall through; leave in edit mode
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold truncate">
            {comment.authorName ?? "Anonymous"}
          </span>
          {hasTimecode ? (
            <button
              type="button"
              onClick={onSeek}
              disabled={!onSeek}
              className={cn(
                "rounded-full border border-border/60 bg-card/70 px-2 py-0.5 text-[10px] font-mono",
                onSeek ? "hover:bg-card/90" : "cursor-default",
              )}
            >
              {formatTimecode(comment.timecodeMs)}
            </button>
          ) : null}
          {comment.status === "resolved" ? (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200">
              Resolved
            </span>
          ) : (
            <span className="rounded-full border border-border/60 bg-background/80 px-2 py-0.5 text-[10px] text-muted-foreground">
              Open
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {canReply && callbacks ? (
            <button
              type="button"
              onClick={onReply}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Reply
            </button>
          ) : null}
          {isAuthor && callbacks ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraft(comment.body);
                  setEditing((v) => !v);
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                {editing ? "Cancel" : "Edit"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void callbacks.deleteComment({ commentId: comment._id });
                }}
                className="text-[10px] text-muted-foreground hover:text-rose-300"
              >
                Delete
              </button>
            </>
          ) : null}
          {canResolve && callbacks ? (
            <button
              type="button"
              onClick={() => {
                void callbacks.resolveComment({
                  commentId: comment._id,
                  resolved: comment.status !== "resolved",
                });
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              {comment.status === "resolved" ? "Reopen" : "Resolve"}
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-1">
        {editing ? (
          <div className="space-y-1">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border/60 bg-background/60 p-2 text-xs outline-none focus:ring-1 focus:ring-primary/40"
            />
            <div className="flex gap-1">
              <button
                type="button"
                onClick={commitEdit}
                className="rounded-md border border-primary/40 bg-primary/20 px-2 py-0.5 text-[11px] font-semibold hover:bg-primary/30"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <MentionText body={comment.body} />
        )}
      </div>
    </div>
  );
}
