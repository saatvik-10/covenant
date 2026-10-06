import {
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  connect,
  covenantPda,
  discriminator,
  fail,
  fetchCovenant,
  formatUnits,
  loadKeypair,
  mintDecimals,
  parseConstraintHash,
  printCovenant,
  PROGRAM_ID,
  toRaw,
} from "./covenant-lib";

// Max the user can claw back if the oracle verdict comes back false. Must stay
// <= the executor's bonded collateral, otherwise a failed verdict would return
// the whole bond and the cap would be meaningless.
const COMPENSATION_CAP_TOKENS = 500n;
// Only settle() enforces the deadline, but LZ delivery can stall for a long time
// before the verdict CPI arrives — a short deadline silently turns a delayed
// delivery into DeadlinePassed at settle. 7 days gives a stalled test room to
// recover. Override with COVENANT_DEADLINE_SECONDS=<seconds>.
const DEADLINE_SECONDS = Number(
  process.env.COVENANT_DEADLINE_SECONDS ?? String(7 * 24 * 60 * 60)
);

async function main() {
  const connection = connect();
  const user = loadKeypair(process.env.COVENANT_USER_KEYPAIR ?? "~/.config/solana/id.json");

  // Fixed, known constraint hash — reuse this exact value on the Arbitrum side
  const constraintHash = parseConstraintHash(
    process.argv[2] ?? process.env.COVENANT_HASH
  );

  const decimals = await mintDecimals(connection);
  const capRaw = toRaw(COMPENSATION_CAP_TOKENS, decimals);
  const pda = covenantPda(user.publicKey, constraintHash);

  console.log("User pubkey:", user.publicKey.toBase58());
  console.log("Constraint hash (hex):", constraintHash.toString("hex"));
  console.log("Covenant PDA:", pda.toBase58());
  console.log(
    "Compensation cap:",
    `${COMPENSATION_CAP_TOKENS} tokens`,
    `(${formatUnits(capRaw, decimals)} @ ${decimals} decimals, ${capRaw} raw)`
  );

  const existing = await fetchCovenant(connection, pda);
  if (existing) {
    console.log(
      "\nCovenant already exists for this (user, constraint hash) pair."
    );
    console.log("Reuse this exact constraint hash on the Arbitrum side:\n");
    printCovenant(existing, decimals);
    console.log(
      "\nTo create another one, pass a different byte: npx tsx scripts/create-test-covenant.ts 2"
    );
    return;
  }

  const compensationCap = Buffer.alloc(8);
  compensationCap.writeBigUInt64LE(capRaw);

  const deadline = Buffer.alloc(8);
  const deadlineUnix = Math.floor(Date.now() / 1000) + DEADLINE_SECONDS;
  deadline.writeBigInt64LE(BigInt(deadlineUnix));

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
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  console.log(
    "Deadline:",
    new Date(deadlineUnix * 1000).toISOString(),
    `(+${DEADLINE_SECONDS}s)`
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [user]);

  const created = await fetchCovenant(connection, pda);
  console.log("\nCovenant created! Tx:", sig);
  if (created) printCovenant(created, decimals);
  else console.log("  (account not visible yet — re-run to inspect)");
}

main().catch(fail);
