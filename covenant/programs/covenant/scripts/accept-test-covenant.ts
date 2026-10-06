import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  COLLATERAL_MINT,
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

// The executor's bond. Stays >= the compensation cap (set at create time) so a
// failed verdict returns at most the cap and the executor keeps the remainder.
// Override with COVENANT_COLLATERAL=<whole tokens> if the executor holds more.
const COLLATERAL_TOKENS = BigInt(process.env.COVENANT_COLLATERAL ?? "1000");

// The user is always wallet1 (~/.config/solana/id.json). The executor is the
// separate bond wallet — defaulting both to wallet1 makes a FAIL settle return
// the remainder to the user, which silently hides the split we are testing.
const USER_KEYPAIR =
  process.env.COVENANT_USER_KEYPAIR ?? "~/.config/solana/id.json";
const EXECUTOR_KEYPAIR =
  process.env.COVENANT_EXECUTOR_KEYPAIR ?? "~/.config/solana/id.json";

async function main() {
  const connection = connect();
  // The user is always wallet1. The executor is the bond wallet, which must be
  // a different keypair — otherwise the executor and the user are the same actor
  // and the FAIL path's remainder transfer becomes a self-payment.
  const executor = loadKeypair(EXECUTOR_KEYPAIR);
  const user = loadKeypair(USER_KEYPAIR);

  if (executor.publicKey.equals(user.publicKey)) {
    throw new Error(
      "Executor and user are the same wallet — a FAIL settle would return the\n" +
        "  remainder to the user instead of the executor, so the collateral\n" +
        "  split is never exercised.\n" +
        "  Set COVENANT_EXECUTOR_KEYPAIR to a different keypair file\n" +
        "  (e.g. scripts/.wallet2.json)."
    );
  }

  const constraintHash = parseConstraintHash(
    process.argv[2] ?? process.env.COVENANT_HASH
  );
  const pda = covenantPda(user.publicKey, constraintHash);

  const decimals = await mintDecimals(connection);
  const collateralRaw = toRaw(COLLATERAL_TOKENS, decimals);

  if (collateralRaw <= 0n) throw new Error("COVENANT_COLLATERAL must be > 0");

  const executorTokenAccount = getAssociatedTokenAddressSync(
    COLLATERAL_MINT,
    executor.publicKey
  );
  const collateralVault = getAssociatedTokenAddressSync(
    COLLATERAL_MINT,
    pda,
    true
  ); // allowOwnerOffCurve for PDA

  console.log("User:", user.publicKey.toBase58());
  console.log("Executor:", executor.publicKey.toBase58());
  console.log("Covenant PDA:", pda.toBase58());
  console.log("Executor token account:", executorTokenAccount.toBase58());
  console.log(
    "Collateral vault (ATA owned by covenant):",
    collateralVault.toBase58()
  );
  console.log(
    "Collateral:",
    `${COLLATERAL_TOKENS} tokens`,
    `(${formatUnits(
      collateralRaw,
      decimals
    )} @ ${decimals} decimals, ${collateralRaw} raw)`
  );

  const existing = await fetchCovenant(connection, pda);
  if (!existing) {
    throw new Error(
      `No covenant at ${pda.toBase58()}. Create it first:\n` +
        `  npx tsx scripts/create-test-covenant.ts ${process.argv[2] ?? ""}`
    );
  }

  if (existing.status !== "Open") {
    throw new Error(
      `Covenant status is "${existing.status}", not "Open" — cannot accept.\n` +
        `  (A covenant can only be accepted once, and only before it settles.)`
    );
  }

  if (existing.deadline.getTime() <= Date.now()) {
    console.warn(
      `  ! warning: deadline already passed (${existing.deadline.toISOString()})`
    );
  }

  const balance = await connection.getTokenAccountBalance(
    executorTokenAccount,
    "confirmed"
  );
  const available = BigInt(balance.value.amount);
  if (available < collateralRaw) {
    throw new Error(
      `Insufficient collateral: have ${formatUnits(available, decimals)}, ` +
        `need ${formatUnits(collateralRaw, decimals)} tokens.\n` +
        `  ATA ${executorTokenAccount.toBase58()}\n` +
        `  Lower it with COVENANT_COLLATERAL=<whole tokens>.`
    );
  }
  console.log(
    "  available balance:",
    `${formatUnits(available, decimals)} tokens`
  );

  if (await connection.getAccountInfo(collateralVault, "confirmed")) {
    console.warn(
      `  ! vault ${collateralVault.toBase58()} already exists — this covenant ` +
        `was accepted before, and the transfer has likely already happened.`
    );
  }

  const data = Buffer.concat([
    discriminator("accept_covenant"),
    (() => {
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(collateralRaw);
      return b;
    })(),
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: executor.publicKey, isSigner: true, isWritable: true },
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: COLLATERAL_MINT, isSigner: false, isWritable: false },
      { pubkey: executorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      {
        pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [executor]);

  const accepted = await fetchCovenant(connection, pda);
  console.log("\nCovenant accepted! Tx:", sig);
  if (accepted) printCovenant(accepted, decimals);
  else console.log("  (account not visible yet — re-run to inspect)");

  const vaultBalance = await connection.getTokenAccountBalance(collateralVault);
  console.log(
    "  vault now holds:",
    `${formatUnits(BigInt(vaultBalance.value.amount), decimals)} tokens`
  );
}

main().catch(fail);
