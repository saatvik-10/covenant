import { THRESHOLD_USD } from "./config";
import { Covenant, Position } from "./watcher";

export type HedgeState = "HEDGED" | "UNDER-HEDGED";

export type Assessment = {
  /** what checkPosition would demand if it were called right now. */
  requiredUsd: bigint;
  /** what checkPosition reports the executor currently holds. */
  currentUsd: bigint;
  deficitUsd: bigint;
  hedge: HedgeState;
  /** covenants awaiting a verdict — the ones an under-hedge would betray. */
  openCovenants: Covenant[];
  expired: Covenant[];
  settled: number;
};

/**
 * Read-only sizing. A covenant carries no notional of its own: the exposure
 * is whatever threshold the verifier is called with, so the watcher uses
 * THRESHOLD_USD and reports the gap. Nothing here places an order.
 */
export function assess(position: Position, covenants: Covenant[]): Assessment {
  const now = Date.now();
  const openCovenants = covenants.filter(
    (c) => c.status === "Accepted" && c.verdict === null
  );
  const expired = openCovenants.filter((c) => c.deadline.getTime() <= now);
  const settled = covenants.filter((c) => c.status === "Settled").length;

  const requiredUsd = openCovenants.length > 0 ? THRESHOLD_USD : 0n;
  const currentUsd = position.shortSizeUsd;
  const deficitUsd =
    requiredUsd > currentUsd ? requiredUsd - currentUsd : 0n;

  return {
    requiredUsd,
    currentUsd,
    deficitUsd,
    hedge: currentUsd >= requiredUsd ? "HEDGED" : "UNDER-HEDGED",
    openCovenants,
    expired,
    settled,
  };
}

export function usd30(value: bigint): string {
  const whole = value / 10n ** 30n;
  const frac = (value % 10n ** 30n)
    .toString()
    .padStart(30, "0")
    .replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : whole.toString();
}
