import { useState } from "react";

type CommitPayload = { hash: string; cap: number; deadline: number };

export function CreateScreen({ onCommit }: { onCommit: (c: CommitPayload) => void }) {
  const [hash, setHash] = useState(
    "0x0909090909090909090909090909090909090909090909090909090909090909",
  );
  const [cap, setCap] = useState(1000);
  const [deadline, setDeadline] = useState(604800);

  return (
    <section className="mx-auto max-w-3xl">
      <p className="mb-1 text-xs uppercase tracking-[0.3em] text-bronze">
        Stage I
      </p>
      <h1 className="font-display text-5xl leading-none md:text-7xl">
        Post a covenant
      </h1>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-soft">
        A covenant names one condition and one compensation cap. No funds move
        here — the executor posts the bond when they accept, and the split only
        happens at settle.
      </p>

      <form
        className="mt-10 space-y-7"
        onSubmit={(e) => {
          e.preventDefault();
          onCommit({ hash, cap, deadline });
        }}
      >
        <label className="block">
          <span className="k text-[0.68rem] uppercase tracking-[0.14em] text-ink-soft">
            Constraint hash — 32 bytes
          </span>
          <input
            className="carved mt-2"
            value={hash}
            onChange={(e) => setHash(e.target.value)}
            pattern="0x[0-9a-fA-F]{64}"
            required
          />
        </label>
        <label className="block">
          <span className="k text-[0.68rem] uppercase tracking-[0.14em] text-ink-soft">
            Compensation cap — tokens
          </span>
          <input
            className="carved mt-2"
            type="number"
            min={100}
            max={5000}
            value={cap}
            onChange={(e) => setCap(Number(e.target.value))}
            required
          />
        </label>
        <label className="block">
          <span className="k text-[0.68rem] uppercase tracking-[0.14em] text-ink-soft">
            Deadline — seconds from now
          </span>
          <input
            className="carved mt-2"
            type="number"
            min={3600}
            max={604800}
            step={3600}
            value={deadline}
            onChange={(e) => setDeadline(Number(e.target.value))}
            required
          />
        </label>
        <button
          type="submit"
          className="w-full border-2 border-ink bg-ink px-6 py-4 font-display text-2xl text-travertine-hi transition-colors duration-150 hover:bg-oxblood hover:border-oxblood cursor-pointer"
        >
          Sign and go live →
        </button>
      </form>
    </section>
  );
}
