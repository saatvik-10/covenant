import type { ScenarioData } from "../../helpers/types";

export function Exposure({ s }: { s: ScenarioData }) {
  const wholeUsd = BigInt(s.positionUsd) / 10n ** 30n;
  const formattedUsd = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(wholeUsd);

  return (
    <div className="mb-8 min-w-0">
      <div className="mb-2 min-w-0">
        <span className="block break-words font-display text-5xl md:text-6xl">
          ${formattedUsd}
        </span>
      </div>
      <div className="mt-2 text-xs text-ink-soft/60">
        Approx. GMX short notional · 30-decimal USD · sampled at verdict
      </div>
    </div>
  );
}
