import { PublicKey } from "@solana/web3.js";
import fs from "fs";
import os from "os";

export const ARB_RPC =
  process.env.LZ_RPC ?? "https://sepolia-rollup.arbitrum.io/rpc";
export const RPC_URL =
  process.env.RPC_URL ??
  "";

/** CovenantVerifier on Arbitrum Sepolia — holds checkPosition(). */
export const VERIFIER =
  process.env.VERIFIER_ADDRESS ?? "0xFeB7204dc23609623bF1C0A09fccF3F625d3ACfc";
/** The account whose GMX position is being watched. */
export const EXECUTOR =
  process.env.GMX_EXECUTOR ?? "0x0Ac16B86d0396Bb7558f144fBb9FbbB91857ff4b";
export const COVENANT_PROGRAM = new PublicKey(
  "Cb5yZqPKS9utNAf6LB3Cb4r36tMHpKtaY8LeNjtkwRAi"
);

/** 5e33 in 30-decimals USD. A position must reach this to pass. */
export const THRESHOLD_USD = BigInt(
  process.env.THRESHOLD_USD ?? (5_000n * 10n ** 30n).toString()
);
export const POLL_MS = Number(process.env.POLL_MS ?? 20_000);

const USER_KEYPAIR =
  process.env.COVENANT_USER_KEYPAIR ?? `${os.homedir()}/.config/solana/id.json`;

/** wallet1 — the user a watched covenant was created by. */
export function userPublicKey(): PublicKey {
  const secret: number[] = JSON.parse(fs.readFileSync(USER_KEYPAIR, "utf8"));
  const bytes = Uint8Array.from(secret);
  return new PublicKey(bytes.slice(32));
}
