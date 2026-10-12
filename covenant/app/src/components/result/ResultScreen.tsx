import type { ScenarioData } from "../../helpers/types";
import { Leader, LeaderJSX } from "../leader/Leader";

function solExplorer(sig: string) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
function arbExplorer(sig: string) {
  return `https://sepolia.arbiscan.io/tx/${sig}`;
}

function txLink(k: string, v: string) {
  if (k.includes("Solana")) return <a href={solExplorer(v)} target="_blank" rel="noopener">{v}</a>;
  if (k.includes("Arbitrum")) return <a href={arbExplorer(v)} target="_blank" rel="noopener">{v}</a>;
  return v;
}

export function ResultScreen({ s }: { s: ScenarioData }) {
  const state = s.verdict ? "pass" : "fail";
  return (
    <section className="mx-auto max-w-3xl">
      <p className="mb-1 text-xs uppercase tracking-[0.3em] text-bronze">
        Stage III · {s.rail}
      </p>

      <div className="band" data-state={state}>
        <p className="text-xs uppercase tracking-[0.35em] opacity-80">
          Verdict {String(s.verdict)}
        </p>
        <h1 className="font-display text-5xl leading-none md:text-7xl">
          {s.verdict ? "HEDGED" : "SLASHED"}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed opacity-90">
          {s.splitNote}
        </p>
      </div>

      <div className="mt-8">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-ink-soft">
          Split at settle
        </p>
        {s.split.map((row) => (
          <Leader key={row.k} k={row.k} v={row.v} />
        ))}
      </div>

      <div className="mt-8">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-ink-soft">
          Transaction record
        </p>
        {s.txs.map((row) => (
          <LeaderJSX key={row.k} k={row.k} vJSX={txLink(row.k, row.v)} />
        ))}
      </div>
    </section>
  );
}
