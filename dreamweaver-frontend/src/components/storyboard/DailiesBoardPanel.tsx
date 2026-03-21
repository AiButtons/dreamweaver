"use client";

import type { AutonomousDailiesRecord } from "@/app/storyboard/types";

type DailiesBoardPanelProps = {
  dailies: AutonomousDailiesRecord[];
  onGenerateDailies: () => Promise<void>;
  onUpdateStatus: (reelId: string, status: "approved" | "rejected" | "applied") => Promise<void>;
};

export function DailiesBoardPanel({
  dailies,
  onGenerateDailies,
  onUpdateStatus,
}: DailiesBoardPanelProps) {
  const rows = dailies.slice(0, 6);
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/95 text-zinc-100 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Dailies Board</p>
          <h3 className="mt-1 text-sm font-semibold">Candidate Reels</h3>
        </div>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 text-xs"
          onClick={() => void onGenerateDailies()}
        >
          Generate
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-[11px] text-zinc-400">No reels generated yet.</p>
      ) : (
        <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
          {rows.map((row) => (
            <div key={row._id} className="rounded border border-zinc-800 p-2">
              <p className="text-xs font-medium">{row.title}</p>
              <p className="text-[11px] text-zinc-400">
                {row.continuityRiskLevel.toUpperCase()} • {row.status}
              </p>
              <p className="text-[11px] text-zinc-500">{row.summary}</p>
              <div className="mt-2 flex gap-2">
                <button
                  className="rounded bg-emerald-700 px-2 py-1 text-[10px]"
                  onClick={() => void onUpdateStatus(row.reelId, "approved")}
                >
                  Approve
                </button>
                <button
                  className="rounded bg-blue-700 px-2 py-1 text-[10px]"
                  onClick={() => void onUpdateStatus(row.reelId, "applied")}
                >
                  Mark Applied
                </button>
                <button
                  className="rounded bg-rose-700 px-2 py-1 text-[10px]"
                  onClick={() => void onUpdateStatus(row.reelId, "rejected")}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

