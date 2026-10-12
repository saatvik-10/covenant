# Demo-PASS artifacts — constraint byte 0x09 — 2026-10-03

Claim under test: executor holds a real GMX short (sizeInUsd=1e34 >= 5e24
threshold) -> verdict PASS -> settlement returns the whole bond to the executor.

## Step 1 — open the real GMX short (logs: step1-open-short-final.log, .json)

- acceptablePrice floor was changed before this attempt. Prior attempt
  (tx `0xbedfa011...`, keeper cancel `0x360284f3...`, block 315265767) was
  rejected: keeper execution price **$2,263.19** vs mark **$2,682.89** (15.6%
  thin-pool impact) vs our floor $2,548.75 (0.95 x mark).
  New floor = 70% of that observed execution price:
  `2263190604085565 * 7000 / 10000 = 1584233422859895` (**$1,584.23**, 59% of
  mark). acceptablePrice is only an execution-time floor (bou.sol:224); it does
  not change the fill price.
- `node scripts/open-short.mjs --send --poll-minutes 25`
  - create: `0xdbb9f7622e42fcf2975d015bb29959d8017aac790b6c88b552d0e7ebafe525ee`
    block 315403034, status 1, gasUsed 884158
  - orderKey: `0xd6a699de8775f72d7b3a4820ca454da4fd0fa52dc544ecd4fda62dcdf16418c7`
  - keeper executed in ~30s: `0xe7a64ce2536e2b1347ad4d87bb175c4eb0f87d7190bd6eb17d05f676f2d1aa8c`
    block 315403046, gasUsed 3315776, from keeper `0xb38302e27bAe8932536A84ab362c3d1013420Cb4`
  - fill: sizeInTokens `3725320805276754276` for $10,000 -> implied execution
    price **$2,684.33** vs mark $2,684.27 — no adverse impact this time.

### Raw verifier output (the record the plan requires)

Before (step1-open-short-final.log, `--- BEFORE ---`):
```
checkPosition(0x0Ac1..., 5000$):
  shortSizeUsd = 0
  passed       = false
Reader.getAccountPositions: 0 position(s)
```

After (same log, `--- AFTER ---`):
```
checkPosition(0x0Ac1..., 5000$):
  shortSizeUsd = 10000000000000000000000000000000000
  passed       = true
Reader.getAccountPositions: 1 position(s)
  account        = 0x0Ac16B86d0396Bb7558f144fBb9FbbB91857ff4b
  market         = 0xb6fC4C9eB02C35A134044526C62bb15014Ac0Bcc
  collateralToken= 0x3253a335E7bFfB4790Aa4C25C4250d206E9b9773
  isLong         = false
  sizeInUsd      = 10000000000000000000000000000000000
  sizeInTokens   = 3725320805276754276
  collateralAmount= 993999688
  increasedAtTime= 1791049449
```

Independent re-read after the run (cast):
```
cast call 0xFeB7204dc23609623bF1C0A09fccF3F625d3ACfc \
  "checkPosition(address,uint256)(uint256,bool)" \
  0x0Ac16B86d0396Bb7558f144fBb9FbbB91857ff4b 5000000000000000000000000 \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc
-> 10000000000000000000000000000000000 [1e34] / true
```

## Step 2-3 — Solana covenant (logs: demopass-2/3)

- create (byte 9, wallet1): `g5A8pLNmLCjrpAEqAPrquNtZMVjjCZV7GWoP39FwuATVch9NC3M5jwHQ8Z8XcggVRYLMWFPFmdNLMyPQKJRHNx3`
- accept (executor = wallet2, bond 1000e9): `3aVqeeZDJ2CwqWpktTHNpaS8JnWYhyArXLuDyMUZ9UJar7vR7Bqv8CB5V3bpRM67kertoL36u1fUkkdKhUd2rpy`
- PDA: `6EwCwGA7o9p9SSQkqKy1ZebMDJjgxoJer55aHG5D7g89`
- constraint hash: `090909...09`, compensation cap 500, deadline 2026-10-10T17:51:54Z
- state before verdict: Accepted, verdict None

## Step 4 — verdict send on Arbitrum (log: demopass-4)

`npx ts-node scripts/send-verdict.ts 9 --max-exposure 5000000000000000000000000 --expect-pass`

- GMX read: shortSizeUsd = 1e34, **passed = true**
- tx `0xf86975cef4b7109618a283fa4167f04abf0e73f0274398dd880626dae748f0e7`
- wire message: user `4362ae3e...8c3f`, hash `090909...09`, **passed flag `01`**
- LZ outbound **nonce 6**, guid `4156e6f4aac06520bb52aaf1a72d2e57f2a4e8172f0f8b29816bf157678d9efd`

## Step 5 — self-DVN verification (log: demopass-5)

Packet for nonce 6 decoded from PayloadSent (header 81B, payload 97B) and added
to `scripts/self-dvn.mjs` BACKFILL.

- dvn-verify#6: `MBtb6p5zKZ15ccTcSpy3n8pTFDmvBcrjtWfrh5rrNbjZqNWKxyuzZFAkNDYzrxByjnPUd34rFWWHTx4UDM9ybTM`
- commit#6: `38CJG6JPhKHaoYP6Asv4bNubySmJRZUR9BNi5iJmRJfhWJybiN5FjhzaQ4a9vzQwhE3UyZu3jb6nD1bPFcPmHatQ`
- `Nonce.inbound_nonce` 5 -> 6

## Step 6 — delivery by the REAL LayerZero executor

- tx `2fDb1koR7fhbBxFbSaRUX6Bv4oE6FCZ6iiMy5NLUMLiqyohpwWkZYXJ9sVM1ZjpvnbcN77ewDbHoCA8XPzuA3nvE`
  2026-10-03T17:55:46Z, fee payer `3HSGGUXKRtmAXpktCajhm4c7RAv8NFGpXmgRW53uUAKx` (LZ testnet executor)
- `PreExecute -> LzReceive -> Clear -> ReceiveVerdict -> Verdict received: passed=true`
- covenant account: status Accepted, **verdict = Some(true)**

## Step 7 — settle (log: demopass-7)

- tx `3ydoWZW7oZra5k3LYKhgjbEENY7ajYtFNkRtEeAFZLcvsCBMszwM6MyND3UVQXyMFfHFbKhcAujLqTPVA5UFY9Hw`
- vault 1000 -> 0 ; user 1000 -> 1000 ; executor 0 -> 1000
- status = Settled, verdict = true; "OK: split matches expectation, vault drained."

## Notes / known limitations carried forward

- eth_call simulation cannot catch either failure mode seen so far: the gas
  price=0 masking of GasUtils.validateExecutionFee, and the keeper-side
  acceptable-price check (both are invisible to a static call).
- The nonce-4 orphan from demo-fail is untouched; the LZ executor still
  retries it. It does not block delivery of nonce 6.
- `send-verdict.ts` now takes `--expect-pass`; without it, the original
  FAIL assertions (passed=false, wire flag 00) still apply.
- No video: headless CLI environment; these logs are the record.
