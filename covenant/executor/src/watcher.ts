import { createRequire } from "module";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ARB_RPC,
  COVENANT_PROGRAM,
  EXECUTOR,
  RPC_URL,
  VERIFIER,
  THRESHOLD_USD,
} from "./config";

const req = createRequire(import.meta.url);
const { ethers } = req("ethers");

const VERIFIER_ABI = [
  "function checkPosition(address executor, uint256 maxNetExposureUsd) view returns (uint256 shortSizeUsd, bool passed)",
];

export type Position = {
  shortSizeUsd: bigint;
  passed: boolean;
  error?: string;
};

export type Covenant = {
  address: string;
  constraintHash: string;
  status: "Open" | "Accepted" | "Settled" | string;
  verdict: boolean | null;
  collateralAmount: bigint;
  compensationCap: bigint;
  deadline: Date;
  executor: string;
};

export async function getPosition(): Promise<Position> {
  try {
    const provider = new ethers.providers.JsonRpcProvider(ARB_RPC, 421614);
    const verifier = new ethers.Contract(VERIFIER, VERIFIER_ABI, provider);
    const [shortSizeUsd, passed]: [any, boolean] = await verifier.checkPosition(
      EXECUTOR,
      THRESHOLD_USD
    );
    return { shortSizeUsd: BigInt(shortSizeUsd.toString()), passed };
  } catch (e) {
    return { shortSizeUsd: 0n, passed: false, error: (e as Error).message };
  }
}

export function solana(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

function decodeCovenant(address: string, data: Buffer): Covenant | null {
  if (data.length < 132) return null;
  const STATUS = ["Open", "Accepted", "Settled"];
  return {
    address,
    constraintHash: data.subarray(88, 120).toString("hex"),
    status: STATUS[data[128]] ?? `Unknown(${data[128]})`,
    verdict: data[129] === 0 ? null : data[130] === 1,
    collateralAmount: data.readBigUInt64LE(72),
    compensationCap: data.readBigUInt64LE(80),
    deadline: new Date(Number(data.readBigInt64LE(120)) * 1000),
    executor: new PublicKey(data.subarray(40, 72)).toBase58(),
  };
}

/** Every covenant created by the watched user (memcmp on the user field). */
export async function getCovenants(user: PublicKey): Promise<Covenant[]> {
  const conn = solana();
  const accounts = await conn.getProgramAccounts(COVENANT_PROGRAM, {
    filters: [{ memcmp: { offset: 8, bytes: user.toBase58() } }],
    commitment: "confirmed",
  });
  return accounts
    .map((a) => decodeCovenant(a.pubkey.toBase58(), a.account.data as Buffer))
    .filter((c): c is Covenant => c !== null);
}
