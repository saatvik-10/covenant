export type Stage = "create" | "live" | "result";

export type Scenario = "pass" | "fail";

export type Row = { k: string; v: string };

export type ScenarioData = {
  id: Scenario;
  rail: string;
  title: string;
  constraint: string;
  bond: number;
  cap: number;
  positionUsd: number;
  thresholdUsd: number;
  positionNote: string;
  verdict: boolean;
  splitNote: string;
  split: Row[];
  ledger: Row[];
  txs: Row[];
};

export type StageNavItem = {
  id: Stage;
  numeral: string;
  label: string;
};

export const STAGES: StageNavItem[] = [
  { id: "create", numeral: "I", label: "Create" },
  { id: "live", numeral: "II", label: "Live" },
  { id: "result", numeral: "III", label: "Result" },
];

export const PASS: ScenarioData = {
  id: "pass",
  rail: "A · HEDGED",
  title: "Position held above the floor",
  constraint: "0909…0909",
  bond: 1000,
  cap: 1000,
  positionUsd: 10000,
  thresholdUsd: 5000,
  positionNote: "GMX short opened before the verdict — fill $2,684.33, no impact vs mark",
  verdict: true,
  splitNote: "Bond released to the executor in full. The user's covenant cost nothing to keep.",
  split: [
    { k: "Executor", v: "+1,000.000" },
    { k: "User", v: "+0.000" },
    { k: "Vault", v: "0.000  (drained)" },
  ],
  ledger: [
    { k: "Status", v: "Settled" },
    { k: "Verdict", v: "true (1e34 ≤ 1e34)" },
    { k: "Wire flag", v: "0x01" },
    { k: "Bond posted at accept", v: "1,000.000" },
    { k: "Compensation cap", v: "1,000.000" },
    { k: "Deadline", v: "2026-10-10 17:51 UTC" },
    { k: "LZ path", v: "outbound nonce 6 → commit 6 → delivered 13s" },
  ],
  txs: [
    { k: "create (Solana)", v: "g5A8pLNm…JRHNx3" },
    { k: "accept (Solana)", v: "3aVqeeZD…L36u1fU" },
    { k: "verdict (Arbitrum)", v: "0xf86975ce…48f0e7" },
    { k: "settle (Solana)", v: "3ydoWZW7…UFY9Hw" },
  ],
};

export const FAIL: ScenarioData = {
  id: "fail",
  rail: "B · UNDER-HEDGED",
  title: "No hedge was ever placed",
  constraint: "0808…0808",
  bond: 500,
  cap: 500,
  positionUsd: 0,
  thresholdUsd: 5000,
  positionNote: "No GMX order was ever submitted — key(GMX_EXECUTOR,0) = 0",
  verdict: false,
  splitNote:
    "Cap equals the bond, so the whole bond pays the user and the remainder leg is 0 (documented flaw).",
  split: [
    { k: "User", v: "+500.000  (compensation)" },
    { k: "Executor", v: "+0.000" },
    { k: "Vault", v: "0.000  (drained)" },
  ],
  ledger: [
    { k: "Status", v: "Settled" },
    { k: "Verdict", v: "false (position below floor)" },
    { k: "Wire flag", v: "0x00" },
    { k: "Bond posted at accept", v: "500.000" },
    { k: "Compensation cap", v: "500.000" },
    { k: "Deadline", v: "2026-10-09 15:19 UTC" },
    { k: "LZ path", v: "nonce 4 orphan noted, not replayed" },
  ],
  txs: [
    { k: "create (Solana)", v: "3GmcWDqA…vocfRNtn4Z7" },
    { k: "verdict (Arbitrum)", v: "0x38ac2978…0b09f67" },
    { k: "settle (Solana)", v: "5EkSYJsfs…f9vTbiW" },
  ],
};
