"use client";

import type { ConstraintBundle } from "@/app/storyboard/types";

type ContinuityOSPanelProps = {
  bundle: ConstraintBundle | null;
  onDetectContradictions: () => Promise<void>;
};

export function ContinuityOSPanel({ bundle, onDetectContradictions }: ContinuityOSPanelProps) {
  const violations = bundle?.continuityViolations ?? [];
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/95 text-zinc-100 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Continuity OS</p>
          <h3 className="mt-1 text-sm font-semibold">DNA + Constraints</h3>
        </div>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 text-xs"
          onClick={() => void onDetectContradictions()}
        >
          Detect
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <Stat label="Identity Packs" value={String(bundle?.identityPacks.length ?? 0)} />
        <Stat label="Constraints" value={String(bundle?.globalConstraints.length ?? 0)} />
        <Stat label="Open Violations" value={String(violations.length)} />
      </div>
      <div className="mt-3 max-h-56 overflow-y-auto space-y-2">
        {violations.length === 0 ? (
          <p className="text-[11px] text-zinc-500">No open contradictions.</p>
        ) : (
          violations.slice(0, 6).map((row, index) => (
            <div key={`vio_${index}`} className="rounded border border-zinc-800 p-2">
              <p className="text-xs font-medium">{String(row.code ?? "VIOLATION")}</p>
              <p className="text-[11px] text-zinc-400">
                {String(row.severity ?? "medium")} • {String(row.status ?? "open")}
              </p>
              <p className="text-[11px] text-zinc-500">{String(row.message ?? "")}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 p-2">
      <p className="text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className="text-zinc-100 font-medium">{value}</p>
    </div>
  );
}

