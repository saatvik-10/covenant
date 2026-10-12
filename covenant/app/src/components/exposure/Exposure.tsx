import type { ScenarioData } from "../../helpers/types";

export function Exposure({ s }: { s: ScenarioData }) {
  return (
    <div className="mb-8">
      <div className="mb-2 flex items-end justify-between gap-4">
        <span className="font-display text-5xl md:text-6xl">
          ${s.positionUsd.toLocaleString()}
        </span>
        <span className="text-xs uppercase tracking-[0.18em] text-ink-soft">
          floor
        </span>
      </div>
      <div className="mt-2 text-xs text-ink-soft/60">
        Track represents position size vs floor threshold
      </div>
    </div>
  );
}
