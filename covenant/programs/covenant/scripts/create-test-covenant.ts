import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as crypto from "crypto";
import * as os from "os";

const PROGRAM_ID = new PublicKey(
  "Cb5yZqPKS9utNAf6LB3Cb4r36tMHpKtaY8LeNjtkwRAi"
);
const RPC_URL =
  "https://devnet.helius-rpc.com/?api-key=a59d300b-8279-4423-a74d-d611f8f721c0";

const STATUS = ["Open", "Accepted", "Settled"] as const;

// Anchor's instruction discriminator: first 8 bytes of sha256("global:<ix_name>")
function discriminator(ixName: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`global:${ixName}`)
    .digest()
    .subarray(0, 8);
}

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(
    fs.readFileSync(path.replace("~", os.homedir()), "utf8")
  );
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function parseConstraintHash(arg: string | undefined): Buffer {
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

function decodeCovenant(data: Buffer) {
  return {
    user: new PublicKey(data.subarray(8, 40)).toBase58(),
    executor: new PublicKey(data.subarray(40, 72)).toBase58(),
    collateralAmount: data.readBigUInt64LE(72),
    compensationCap: data.readBigUInt64LE(80),
    constraintHash: data.subarray(88, 120).toString("hex"),
    deadline: new Date(Number(data.readBigInt64LE(120)) * 1000),
    status: STATUS[data[128]] ?? `Unknown(${data[128]})`,
    verdict: data[129] === 0 ? null : data[130] === 1,
    bump: data[131],
  };
}

function printCovenant(pda: PublicKey, account: { data: Buffer } | null) {
  if (!account) return;
  const c = decodeCovenant(account.data);
  console.log("  status           :", c.status);
  console.log("  user             :", c.user);
  console.log("  executor         :", c.executor);
  console.log("  collateral       :", c.collateralAmount.toString());
  console.log("  compensation cap :", c.compensationCap.toString());
  console.log("  constraint hash  :", c.constraintHash);
  console.log("  deadline         :", c.deadline.toISOString());
  console.log("  verdict          :", c.verdict === null ? "None" : c.verdict);
  console.log("  bump             :", c.bump);
  void pda;
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const user = loadKeypair("~/.config/solana/id.json");

  // Fixed, known constraint hash — reuse this exact value on the Arbitrum side
  const constraintHash = parseConstraintHash(
    process.argv[2] ?? process.env.COVENANT_HASH
  );
  const compensationCapAmount = 500_000_000n;

  const [covenantPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("covenant"), user.publicKey.toBuffer(), constraintHash],
    PROGRAM_ID
  );

  console.log("User pubkey:", user.publicKey.toBase58());
  console.log("Constraint hash (hex):", constraintHash.toString("hex"));
  console.log("Covenant PDA:", covenantPda.toBase58());

  const existing = await connection.getAccountInfo(covenantPda);
  if (existing) {
    console.log(
      "\nCovenant already exists for this (user, constraint hash) pair."
    );
    console.log("Reuse this exact constraint hash on the Arbitrum side:\n");
    printCovenant(covenantPda, existing);
    console.log(
      "\nTo create another one, pass a different byte: npx tsx scripts/create-test-covenant.ts 2"
    );
    return;
  }

  const compensationCap = Buffer.alloc(8);
  compensationCap.writeBigUInt64LE(compensationCapAmount);

  const deadline = Buffer.alloc(8);
  deadline.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000) + 3600));

  const data = Buffer.concat([
    discriminator("create_covenant"),
    constraintHash,
    compensationCap,
    deadline,
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user.publicKey, isSigner: true, isWritable: true },
      { pubkey: covenantPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [user]);

  const created = await connection.getAccountInfo(covenantPda, "confirmed");
  console.log("\nCovenant created! Tx:", sig);
  printCovenant(covenantPda, created);
}

main().catch((err) => {
  const logs = err?.transactionLogs as string[] | undefined;
  console.error("Failed:", err?.message ?? err);
  if (logs?.length) {
    console.error("\nLogs:");
    for (const line of logs) console.error("  " + line);
  }
  process.exitCode = 1;
});
