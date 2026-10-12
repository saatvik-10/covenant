import { useState } from "react";
import {
  STAGES,
  PASS,
  FAIL,
  type Stage,
  type Scenario,
} from "./helpers/types";
import { Sidebar } from "./components/sidebar/Sidebar";
import { CreateScreen } from "./components/create/CreateScreen";
import { LiveScreen } from "./components/live/LiveScreen";
import { ResultScreen } from "./components/result/ResultScreen";

export default function App() {
  const [stage, setStage] = useState<Stage>("create");
  const [scenario, setScenario] = useState<Scenario>("pass");
  const data = scenario === "pass" ? PASS : FAIL;

  return (
    <div className="flex min-h-screen">
      <Sidebar stage={stage} onPick={setStage} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink px-4 py-3 md:px-8">
          <div className="flex items-center gap-3 md:hidden">
            <img
              src="/covenant-logo.svg"
              alt="Covenant logo"
              className="font-display text-lg h-8 w-auto"
            />
          </div>

          <div
            className="flex min-w-0 flex-wrap items-center gap-2 text-[0.68rem] uppercase tracking-[0.2em]"
            role="group"
            aria-label="Recorded run"
          >
            <span className="text-ink-soft">Recorded run</span>
            {(["pass", "fail"] as Scenario[]).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setScenario(id)}
                aria-pressed={scenario === id}
                className={`border-2 border-ink px-3 py-2 font-semibold transition-colors duration-150 cursor-pointer ${
                  scenario === id
                    ? id === "pass"
                      ? "bg-verdigris/20 text-verdigris border-verdigris outline outline-2 outline-verdigris"
                      : "bg-oxblood/20 text-oxblood border-oxblood outline outline-2 outline-oxblood"
                    : "bg-transparent text-ink hover:bg-travertine-deep/30 outline outline-none"
                }`}
              >
                {id === "pass" ? "Run A · HEDGED" : "Run B · UNHEDGED"}
              </button>
            ))}
          </div>

          <div className="flex gap-2 md:hidden">
            {STAGES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStage(s.id)}
                aria-current={stage === s.id}
                className={`numeral text-3xl ${stage === s.id ? "" : "opacity-60"}`}
                data-live={stage === s.id}
              >
                {s.numeral}
              </button>
            ))}
          </div>
        </header>

        <main className="flex-1 px-4 py-10 md:px-10">
          {stage === "create" && (
            <CreateScreen onCommit={() => setStage("live")} />
          )}
          {stage === "live" && <LiveScreen s={data} />}
          {stage === "result" && <ResultScreen s={data} />}
        </main>

        <footer className="border-t-2 border-ink px-4 py-3 text-[0.65rem] uppercase tracking-[0.2em] text-ink-soft md:px-8">
          Covenant · two states, one promise — no wallet is connected in this
          UI; the runs above were executed from the CLI and recorded in
          artifacts/demo-{data.id}
        </footer>
      </div>
    </div>
  );
}
