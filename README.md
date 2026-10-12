# Covenant

A Solana <> Arbitrum OApp on LayerZero v2, where an Arbitrum-based CovenantVerifier reads a GMX trader's position size and derives a passed/failed verdict that is settled on Solana.

## Architecture

- **Solana OApp** (`8mKHUrjDP45py3vPY5DCejT3T7FxSHCpsGBVsSDaNfeG`): manages Store PDA, PeerConfig PDA, processes inbound LZ messages, invokes covenant `receive_verdict`, handles settlement
- **Covenant program** (`Cb5yZqPKS9utNAf6LB3Cb4r36tMHpKtaY8LeNjtkwRAi`): stores verdict (passed/false), bond, compensation cap, deadline. `receive_verdict` CPI updates the verdict
- **CovenantVerifier** (`0xFeB7204dc23609623bF1C0A09fccF3F625d3ACfc`): reads GMX position via `checkPosition`, encodes verdict payload, sends via LZ
- **LayerZero config**: Arbitrum Sepolia (40231) ↔ Solana Devnet (40168) pathway; requiredDVN [`LayerZero Labs`]; confirmations [20, 32]
- **Self-DVN** (`7CSxP32i6LgCQVWeDQxZuW3FWDXTe1DTc6QLXqRfXJRn`): project-controlled DVN key swapped into ReceiveConfig via `endpoint::set_config`; persists on-chain
- **Frontend** (Bun + Tailwind): replays recorded devnet runs; does not support live-wallet signing

## Deployed Addresses

| Component | Address | Explorer |
|---|---|---|
| Covenant (Solana) | `Cb5yZqPKS9utNAf6LB3Cb4r36tMHpKtaY8LeNjtkwRAi` | https://explorer.solana.com/address/Cb5yZqPKS9utNAf6LB3Cb4r36tMHpKtaY8LeNjtkwRAi?cluster=devnet |
| MyOApp (Arbitrum) | `0x5ef4b799CA856Ebd82E5bC84fb2C9a07dBaA37fd` | https://sepolia.arbiscan.io/address/0x5ef4b799CA856Ebd82E5bC84fb2C9a07dBaA37fd |
| CovenantVerifier (Arbitrum) | `0xFeB7204dc23609623bF1C0A09fccF3F625d3ACfc` | https://sepolia.arbiscan.io/address/0xFeB7204dc23609623bF1C0A09fccF3F625d3ACfc |
| Store (Solana) | `Ciq55LhUSLmckazpWRdaTcHHZZNAdQec4Z9aXPc1T3dV` | — |

## Evidence

| Run | Constraint | Nonce | Tx Hashes |
|---|---|---|---|
| **PASS** | `0x09` | 6 | Create: `g5A8pLNm…`, Verdict: `0xf86975ce…`, Settle: `3ydoWZW7…` |
| **FAIL** | `0x08` | 5 | Verdict: `0x38ac2978…`, Settle: `5EkSYJsf…` |
| **Orphan** | `0x06` | 4 | `0x4bd08903…` (stray duplicate for already-Settled covenant) |

## How to Verify

1. `cd covenant/app && bun install && bun run build`
2. `cd bridge-poc && bun run test` (or `forge test && hardhat test`)
3. On-chain: use `cast call 0xFeB7204dc23609623bF1C0A09fccF3F625d3ACfc "checkPosition(address,uint256)(uint256,bool)" <executor> <amount>` to re-read GMX positions
4. Solana: `cd covenant/programs/covenant && anchor test --skip` or `bun test ...`

## Trust Model and Known Limitations

- **DVN trust**: The Solana receive config requires one DVN key (`7CSxP32i6LgCQVWeDQxZuW3FWDXTe1DTc6QLXqRfXJRn`) that is controlled by this project. It replaces the intended `LayerZero Labs` DVN and proves delivery but does not establish decentralized consensus guarantees.
- **Threshold and executor**: `maxNetExposureUsd` (pass/fail threshold) and `executor` address are call arguments to `CovenantVerifier.checkAndSend`. They are not cryptographically bound to the covenant's `constraintHash`; anyone can call `checkAndSend` with any values.
- **Settlement deadline**: The covenant `deadline` field is checked at `create` (> now) and `accept` (<= deadline), but **never** validated in `settle`. A verdicted covenant can settle arbitrarily late; an un-verdicted expired covenant has no on-chain expiry or refund path.
- **Verdict overwrite**: Before settlement, `receive_verdict` only constrains `status == Accepted`. Multiple authenticated verdict messages can overwrite (last-write-wins). After settlement (`status == Settled`), `receive_verdict` reverts, so post-settlement overwrite is impossible.
- **Cap == bond edge case**: When `compensation_cap == bond` (e.g., 500 == 500), the remainder leg after compensation is 0. This was not demonstrated as a partial-split path.
- **Frontend replays**: The UI displays recorded devnet values (`LiveScreen.tsx:28`); it does not support live-wallet signing or new on-chain verdicts.

## Third-Party Code

This project uses the following third-party dependencies (licenses retained per their terms):

- `@layerzerolabs/oapp-evm` (Solidity OApp framework)
- `@coral-xyz/anchor` (Solana framework)
- `@solana/web3.js` (Solana JS SDK)
- `bigint-buffer` (Node.js bigint buffering — caused initial segfault, fixed via `node-gyp` rebuild)
- `class-variance-authority`, `tailwindcss` (UI styling)

## Frontend Replays Recorded Runs

The Colosseum submission UI (`covenant/app/src/`) is a headless CLI-styled web application that displays pre-recorded devnet values. Screens (Create, Live, Result) read from `ScenarioData` objects constructed from artifacts (`artifacts/demo-pass/`, `artifacts/demo-fail/`). No live-wallet signing or on-chain verdict submission is supported from the frontend; it is purely a replay/presentation layer.



---

MIT License

Copyright (c) 2026 Saatvik Madan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
