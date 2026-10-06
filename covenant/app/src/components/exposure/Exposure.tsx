import type { ScenarioData } from "../../helpers/types";

export function Exposure({ s }: { s: ScenarioData }) {
  const pct =
    s.thresholdUsd === 0
      ? 0
      : Math.max(0, Math.min(100, (s.positionUsd / s.thresholdUsd) * 100));
  const clear = s.positionUsd >= s.thresholdUsd;
  return (
    <div className="mb-8">
      <div className="mb-2 flex items-end justify-between gap-4">
        <span className="font-display text-5xl md:text-6xl">
          ${s.positionUsd.toLocaleString()}
        </span>
        <span className="text-xs uppercase tracking-[0.18em] text-ink-soft">
          floor ${s.thresholdUsd.toLocaleString()}
        </span>
      </div>
      <div className="mt-2 text-xs text-ink-soft/60">
        Track represents position size vs floor threshold
      </div>
      <div className="relative mt-3 h-5 border-2 border-ink bg-travertine-hi">
        <div
          className={`h-full rounded ${clear ? "bg-verdigris" : "bg-oxblood"}`}
          style={{ width: `${pct}%` }}
        />
        <div className="absolute inset-y-0 left-1/2 w-px bg-ink/60" />
      </div>
      <p className="mt-2 text-xs text-ink-soft">{s.positionNote}</p>
    </div>
  );
}
