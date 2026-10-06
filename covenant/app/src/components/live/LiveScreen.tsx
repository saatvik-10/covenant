import type { ScenarioData } from "../../helpers/types";
import { Exposure } from "../exposure/Exposure";
import { Leader } from "../leader/Leader";

export function LiveScreen({ s }: { s: ScenarioData }) {
  return (
    <section className="mx-auto max-w-3xl">
      <p className="mb-1 text-xs uppercase tracking-[0.3em] text-bronze">
        Stage II · {s.rail}
      </p>
      <h1 className="font-display text-5xl leading-none md:text-7xl">
        {s.title}
      </h1>

      <div className="mt-10">
        <Exposure s={s} />
        <Leader k="Covenant" v={s.constraint} />
        <Leader k="Bond in vault" v={`${s.bond.toLocaleString()}.000`} />
        <Leader k="Awaiting verdict" v="delivered" />
        {s.ledger.map((row) => (
          <Leader key={row.k} k={row.k} v={row.v} />
        ))}
      </div>

      <div className="mt-8 border-l-4 border-bronze pl-4 text-sm text-ink-soft">
        The verdict is read from <code>checkPosition</code> on Arbitrum Sepolia
        and delivered to Solana through LayerZero. Nothing on this screen is a
        simulation: these are the recorded devnet values.
      </div>
    </section>
  );
}
