import { EXECUTOR, POLL_MS, THRESHOLD_USD, userPublicKey } from "./config";
import { assess, HedgeState, usd30 } from "./strategy";
import { getCovenants, getPosition, Position, Covenant } from "./watcher";

const once = process.argv.includes("--once");

type Line = {
  ts: string;
  hedge: HedgeState;
  position: Position;
  covenants: Covenant[];
};

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s.padEnd(n);
}

function render(cycle: number, l: Line, prev: HedgeState | null): string {
  const open = l.covenants.filter(
    (c) => c.status === "Accepted" && c.verdict === null
  );
  const rows = l.covenants
    .map(
      (c) =>
        `  ${c.constraintHash.slice(0, 8)}  ${pad(c.status, 9)}  verdict=${
          c.verdict === null ? "None" : c.verdict
        }  collateral=${c.collateralAmount / 10n ** 9n}  deadline=${c.deadline.toISOString()}`
    )
    .join("\n");

  const alert =
    prev !== null && prev !== l.hedge
      ? `\n  !! STATE CHANGE: ${prev} -> ${l.hedge}\n`
      : "";
  const underHedge = l.hedge === "UNDER-HEDGED" && open.length > 0
    ? `  !! UNDER-HEDGED: verifier would REJECT right now (deficit vs ${usd30(THRESHOLD_USD)} USD)\n`
    : "";
  const now = Date.now();
  const expired = open.filter((c) => c.deadline.getTime() <= now);
  const soon = open.filter((c) => {
    const left = c.deadline.getTime() - now;
    return left > 0 && left < 3_600_000;
  });
  const expiredLine = expired.length
    ? `  !! deadline passed, verdict still pending: ${expired
        .map((c) => c.constraintHash.slice(0, 8))
        .join(", ")}`
    : "";
  const soonLine = soon.length
    ? `  !! deadline within 1h: ${soon
        .map((c) => c.constraintHash.slice(0, 8))
        .join(", ")}`
    : "";

  return [
    `[#${cycle}] ${l.ts}  ${l.hedge}${l.position.error ? `  (position read failed: ${l.position.error})` : ""}`,
    `  position.shortSizeUsd = ${l.position.shortSizeUsd} (${usd30(l.position.shortSizeUsd)} USD)`,
    `  checkPosition.passed   = ${l.position.passed}`,
    `  covenant accounts      = ${l.covenants.length} (open=${open.length})`,
    rows ? `  constraint          status      verdict        other\n${rows}` : "  (no covenants for this user)",
    alert,
    underHedge,
    expiredLine,
    soonLine,
  ]
    .filter((s) => s !== "")
    .join("\n");
}

async function main() {
  const user = userPublicKey();
  console.log("executor watcher (monitor-only — it never places an order)");
  console.log(`  position account : ${EXECUTOR}`);
  console.log(`  user (Solana)    : ${user.toBase58()}`);
  console.log(`  threshold        : ${usd30(THRESHOLD_USD)} USD`);
  console.log(`  poll             : ${POLL_MS}ms${once ? " (--once)" : ""}\n`);

  let cycle = 0;
  let prev: HedgeState | null = null;

  const tick = async (): Promise<boolean> => {
    cycle++;
    const [position, covenants] = await Promise.all([
      getPosition(),
      getCovenants(user),
    ]);
    const a = assess(position, covenants);
    const line: Line = {
      ts: new Date().toISOString(),
      hedge: a.hedge,
      position,
      covenants,
    };
    console.log(render(cycle, line, prev));
    const underHedged = a.hedge === "UNDER-HEDGED" && a.openCovenants.length > 0;
    prev = a.hedge;
    if (once) console.log(underHedged ? "\nRESULT: UNDER-HEDGED" : "\nRESULT: OK");
    return underHedged;
  };

  if (once) {
    process.exit((await tick()) ? 1 : 0);
  }

  const timer = setInterval(() => {
    tick().catch((e) => console.error("cycle failed:", (e as Error).message));
  }, POLL_MS);
  process.on("SIGINT", () => {
    clearInterval(timer);
    console.log("\nstopped");
    process.exit(0);
  });
  await tick();
}

main().catch((e) => {
  console.error("watcher failed:", (e as Error).message);
  process.exit(1);
});
