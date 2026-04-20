"use client";

/**
 * M5 — "Regenerate flagged" — re-renders only the shots whose active
 * image the producer marked NG in the Review tab's Take-Status pill row.
 * Uses the same `useShotBatchStream` hook as the image batch but with
 * `flaggedOnly: true` so the route filters server-side.
 */

import React from "react";
import { useQuery } from "convex/react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShotBatchStream } from "@/lib/sse-ingest";
import { queryRef } from "@/lib/convexRefs";

interface RegenerateFlaggedButtonProps {
  storyboardId: string;
  disabled?: boolean;
}

interface FlaggedShotsResponse {
  flaggedNodeIds?: string[];
}

export function RegenerateFlaggedButton({
  storyboardId,
  disabled,
}: RegenerateFlaggedButtonProps) {
  const { state, start } = useShotBatchStream();

  // Reactive — as producers toggle NG status in the Review tab, the
  // badge on this button updates without a refetch.
  const flagged = useQuery(
    queryRef("mediaAssets:listShotsWithFlaggedMedia"),
    storyboardId ? { storyboardId: storyboardId as never } : "skip",
  ) as FlaggedShotsResponse | undefined;
  const flaggedCount = flagged?.flaggedNodeIds?.length ?? 0;

  const isBusy = state.kind === "running";
  const isDisabled = disabled || !storyboardId || isBusy || flaggedCount === 0;
  const elapsedSec = Math.floor(state.elapsedMs / 1000);

  const run = async () => {
    if (!storyboardId || flaggedCount === 0) return;
    // `flaggedOnly: true` makes the server route filter + ignore
    // skipExisting (the whole point is to re-render flagged shots).
    await start({
      storyboardId,
      flaggedOnly: true,
      concurrency: 3,
      mode: "image",
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isDisabled}
      onClick={() => void run()}
      className="h-7 gap-1.5 px-2 text-[11px]"
      aria-label="Regenerate all shots flagged NG"
      title={
        flaggedCount === 0
          ? "No shots flagged NG — mark a take with the Review tab's NG button first"
          : isBusy
            ? `Re-rendering… ${elapsedSec}s elapsed`
            : `Re-render ${flaggedCount} shot${flaggedCount === 1 ? "" : "s"} flagged NG`
      }
    >
      {isBusy ? (
        <>
          <span className="size-3 animate-spin rounded-full border-2 border-current/30 border-t-current" />
          Regenerating… {elapsedSec}s
        </>
      ) : (
        <>
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Regenerate flagged
          {flaggedCount > 0 ? (
            <span className="ml-0.5 rounded-full bg-rose-500/30 px-1.5 py-[1px] text-[9px] font-semibold text-rose-200">
              {flaggedCount}
            </span>
          ) : null}
        </>
      )}
    </Button>
  );
}
