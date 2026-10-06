import { getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";

export const PROGRAM_ID = new PublicKey(
  "Cb5yZqPKS9utNAf6LB3Cb4r36tMHpKtaY8LeNjtkwRAi"
);
export const RPC_URL =
  process.env.RPC_URL ?? "";
export const COLLATERAL_MINT = new PublicKey(
  "FdGq4HNQNC8bgWmp54dPitDcCLA6kfz17dDCRgWngEmK"
);

const COVENANT_SEED = "covenant";
const STATUS = ["Open", "Accepted", "Settled"] as const;

export function connect(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

// Anchor's instruction discriminator: first 8 bytes of sha256("global:<ix_name>")
export function discriminator(ixName: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`global:${ixName}`)
    .digest()
    .subarray(0, 8);
}

export function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(
    fs.readFileSync(path.replace("~", os.homedir()), "utf8")
  );
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function parseConstraintHash(arg: string | undefined): Buffer {
  if (!arg) return Buffer.alloc(32, 1);
  const hex = arg.startsWith("0x") || arg.startsWith("0X") ? arg.slice(2) : arg;
  if (/^[0-9a-fA-F]{1,2}$/.test(hex))
    return Buffer.alloc(32, parseInt(hex, 16));
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  throw new Error(
    `Invalid constraint hash "${arg}". Pass a single byte 0-255 (e.g. 2), ` +
      `or a 32-byte hex string with an optional 0x prefix.`
  );
}

export function covenantPda(
  user: PublicKey,
  constraintHash: Buffer
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(COVENANT_SEED), user.toBuffer(), constraintHash],
    PROGRAM_ID
  );
  return pda;
}

export async function mintDecimals(
  connection: Connection,
  mint: PublicKey = COLLATERAL_MINT
): Promise<number> {
  const { decimals } = await getMint(
    connection,
    mint,
    "confirmed",
    TOKEN_PROGRAM_ID
  );
  return decimals;
}

export function toRaw(whole: bigint, decimals: number): bigint {
  return whole * 10n ** BigInt(decimals);
}

export function formatUnits(raw: bigint, decimals: number): string {
  if (decimals <= 0) return raw.toString();
  const base = 10n ** BigInt(decimals);
  const frac = (raw % base)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return frac.length > 0 ? `${raw / base}.${frac}` : (raw / base).toString();
}

export function decodeCovenant(data: Buffer) {
  return {
    user: new PublicKey(data.subarray(8, 40)).toBase58(),
    executor: new PublicKey(data.subarray(40, 72)).toBase58(),
    collateralAmount: data.readBigUInt64LE(72),
    compensationCap: data.readBigUInt64LE(80),
    constraintHash: data.subarray(88, 120).toString("hex"),
    deadline: new Date(Number(data.readBigInt64LE(120)) * 1000),
    status: (STATUS[data[128]] ?? `Unknown(${data[128]})`) as string,
    verdict: data[129] === 0 ? null : data[130] === 1,
    bump: data[131],
  };
}

export type DecodedCovenant = ReturnType<typeof decodeCovenant>;

export async function fetchCovenant(
  connection: Connection,
  pda: PublicKey
): Promise<DecodedCovenant | null> {
  const account = await connection.getAccountInfo(pda, "confirmed");
  return account ? decodeCovenant(account.data) : null;
}

export function printCovenant(c: DecodedCovenant, decimals: number): void {
  console.log("  status           :", c.status);
  console.log("  user             :", c.user);
  console.log("  executor         :", c.executor);
  console.log(
    "  collateral       :",
    `${formatUnits(c.collateralAmount, decimals)} tokens`,
    `(${c.collateralAmount} raw)`
  );
  console.log(
    "  compensation cap :",
    `${formatUnits(c.compensationCap, decimals)} tokens`,
    `(${c.compensationCap} raw)`
  );
  console.log("  constraint hash  :", c.constraintHash);
  console.log("  deadline         :", c.deadline.toISOString());
  console.log("  verdict          :", c.verdict === null ? "None" : c.verdict);
  console.log("  bump             :", c.bump);
}

export function fail(err: unknown): void {
  const e = err as { message?: string; transactionLogs?: string[] };
  console.error("Failed:", e?.message ?? err);
  if (e?.transactionLogs?.length) {
    console.error("\nLogs:");
    for (const line of e.transactionLogs) console.error("  " + line);
  }
  process.exitCode = 1;
}
