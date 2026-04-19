"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { queryRef } from "@/lib/convexRefs";
import { summarizeCherryPick } from "@/lib/cherry-pick";
import type {
  NarrativeBranchRecord,
  NarrativeCommitRecord,
} from "@/app/storyboard/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface CherryPickDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storyboardId: string;
  branches: NarrativeBranchRecord[];
  /** Returns a promise that resolves when the cherry-pick completes. */
  onCherryPick: (sourceCommitId: string, targetBranchId: string) => Promise<void>;
}

const formatBranchLabel = (branch: NarrativeBranchRecord): string => {
  const suffix = branch.isDefault ? " (default)" : "";
  return `${branch.name}${suffix}`;
};

const formatTimestamp = (ts: number): string => {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
};

export function CherryPickDialog(props: CherryPickDialogProps) {
  // Only mount the body (and its Convex useQuery) while the dialog is open so
  // the surrounding panel can render without a ConvexProvider in the tree.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <CherryPickDialogBody {...props} /> : null}
    </Dialog>
  );
}

function CherryPickDialogBody({
  onOpenChange,
  storyboardId,
  branches,
  onCherryPick,
}: CherryPickDialogProps) {
  const [sourceBranchId, setSourceBranchId] = useState<string>(() => {
    if (branches.length === 0) return "";
    const nonDefault = branches.find((b) => !b.isDefault);
    return (nonDefault ?? branches[0]).branchId;
  });
  const [sourceCommitId, setSourceCommitId] = useState<string>("");
  const [targetBranchId, setTargetBranchId] = useState<string>("");
  const [isApplying, setIsApplying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset commit selection when the source branch changes.
  useEffect(() => {
    setSourceCommitId("");
  }, [sourceBranchId]);

  const shouldQueryCommits = storyboardId.length > 0 && sourceBranchId.length > 0;
  const commitsQuery = useQuery(
    queryRef("narrativeGit:listBranchCommits"),
    shouldQueryCommits
      ? { storyboardId, branchId: sourceBranchId, limit: 50 }
      : "skip",
  ) as NarrativeCommitRecord[] | undefined;
  const isLoadingCommits = shouldQueryCommits && commitsQuery === undefined;

  const selectedCommit = useMemo(
    () => commitsQuery?.find((c) => c.commitId === sourceCommitId) ?? null,
    [commitsQuery, sourceCommitId],
  );

  const targetBranch = useMemo(
    () => branches.find((b) => b.branchId === targetBranchId) ?? null,
    [branches, targetBranchId],
  );

  const summary = useMemo(() => {
    if (!selectedCommit?.operationsJson) return null;
    return summarizeCherryPick(selectedCommit.operationsJson);
  }, [selectedCommit]);

  const canApply =
    !isApplying &&
    sourceBranchId.length > 0 &&
    sourceCommitId.length > 0 &&
    targetBranchId.length > 0 &&
    sourceBranchId !== targetBranchId &&
    summary !== null &&
    !summary.invalid;

  const handleApply = async () => {
    if (!canApply) return;
    setIsApplying(true);
    setErrorMessage(null);
    try {
      await onCherryPick(sourceCommitId, targetBranchId);
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to cherry-pick commit");
    } finally {
      setIsApplying(false);
    }
  };

  const opCountEntries = summary ? Object.entries(summary.opCounts) : [];
  const previewNodeIds = summary ? summary.touchedNodeIds.slice(0, 6) : [];
  const additionalNodeCount = summary ? Math.max(summary.touchedNodeIds.length - previewNodeIds.length, 0) : 0;

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Cherry-pick a commit</DialogTitle>
        <DialogDescription>
          Replay a commit from one branch onto another. The selected commit&apos;s operations are reapplied on top of the target branch.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="cherry-pick-source-branch">
            Source branch
          </label>
          <select
            id="cherry-pick-source-branch"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={sourceBranchId}
            onChange={(event) => setSourceBranchId(event.target.value)}
            disabled={branches.length === 0}
          >
            {branches.length === 0 ? <option value="">No branches available</option> : null}
            {branches.map((branch) => (
              <option key={branch.branchId} value={branch.branchId}>
                {formatBranchLabel(branch)}
              </option>
            ))}
          </select>
        </div>

        {sourceBranchId ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Source commit</p>
            <div className="max-h-[200px] overflow-y-auto rounded-md border border-border">
              {isLoadingCommits ? (
                <p className="p-3 text-xs text-muted-foreground">Loading commits...</p>
              ) : !commitsQuery || commitsQuery.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">No commits on this branch.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {commitsQuery.map((commit) => {
                    const isSelected = commit.commitId === sourceCommitId;
                    return (
                      <li key={commit._id}>
                        <button
                          type="button"
                          onClick={() => setSourceCommitId(commit.commitId)}
                          className={`flex w-full flex-col gap-1 p-2 text-left text-xs hover:bg-accent ${
                            isSelected ? "bg-accent" : ""
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block size-2 rounded-full border ${
                                isSelected ? "border-primary bg-primary" : "border-muted-foreground"
                              }`}
                              aria-hidden="true"
                            />
                            <span className="font-medium">{commit.summary}</span>
                            {typeof commit.reviewRound === "number" ? (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                round {commit.reviewRound}
                              </span>
                            ) : null}
                          </div>
                          <div className="ml-4 text-[11px] text-muted-foreground">
                            {commit.operationCount} ops - {formatTimestamp(commit.createdAt)}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="cherry-pick-target-branch">
            Target branch
          </label>
          <select
            id="cherry-pick-target-branch"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={targetBranchId}
            onChange={(event) => setTargetBranchId(event.target.value)}
            disabled={branches.length === 0}
          >
            <option value="">Select a target branch...</option>
            {branches.map((branch) => (
              <option
                key={branch.branchId}
                value={branch.branchId}
                disabled={branch.branchId === sourceBranchId}
              >
                {formatBranchLabel(branch)}
                {branch.branchId === sourceBranchId ? " - same as source" : ""}
              </option>
            ))}
          </select>
        </div>

        {summary ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
            {summary.invalid ? (
              <p className="text-destructive">Operations payload is malformed: {summary.invalid}</p>
            ) : (
              <>
                <p className="font-medium">
                  {summary.totalOps} operation{summary.totalOps === 1 ? "" : "s"} will be replayed onto{" "}
                  {targetBranch ? targetBranch.name : "-"}
                </p>
                {opCountEntries.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-muted-foreground">
                    {opCountEntries.map(([op, count]) => (
                      <li key={op}>
                        - {count} {op}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {previewNodeIds.length > 0 ? (
                  <p className="mt-2 text-muted-foreground">
                    Touches nodes: {previewNodeIds.join(", ")}
                    {additionalNodeCount > 0 ? ` + ${additionalNodeCount} more` : ""}
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {errorMessage ? (
          <p className="text-xs text-destructive">{errorMessage}</p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isApplying}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void handleApply()} disabled={!canApply}>
          {isApplying ? "Applying..." : "Apply cherry-pick"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
