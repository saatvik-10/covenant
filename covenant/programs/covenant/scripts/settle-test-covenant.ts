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
} from "./covenant-lib";

// Settling is a user action: the user pays and receives the compensation, so
// the payer is wallet1 — the same wallet that must appear in the payload's
// user field, or the covenant the verdict landed on is not this one.
const USER_KEYPAIR =
  process.env.COVENANT_USER_KEYPAIR ?? "~/.config/solana/id.json";
const EXECUTOR_KEYPAIR =
  process.env.COVENANT_EXECUTOR_KEYPAIR ?? "~/.config/solana/id.json";

async function tokenBalanceRaw(
  connection: ReturnType<typeof connect>,
  mint: Parameters<typeof getAssociatedTokenAddressSync>[0],
  owner: Parameters<typeof getAssociatedTokenAddressSync>[1]
): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  const info = await connection.getTokenAccountBalance(ata, "confirmed");
  return BigInt(info.value.amount);
}

async function main() {
  const connection = connect();
  const user = loadKeypair(USER_KEYPAIR);
  const executor = loadKeypair(EXECUTOR_KEYPAIR);

  const constraintHash = parseConstraintHash(
    process.argv[2] ?? process.env.COVENANT_HASH
  );
  const pda = covenantPda(user.publicKey, constraintHash);

  const decimals = await mintDecimals(connection);
  const covenant = await fetchCovenant(connection, pda);
  if (!covenant) throw new Error(`No covenant at ${pda.toBase58()}.`);

  console.log("User:    ", user.publicKey.toBase58());
  console.log("Executor:", executor.publicKey.toBase58());
  console.log("Covenant PDA:", pda.toBase58());
  printCovenant(covenant, decimals);

  if (covenant.status !== "Accepted") {
    throw new Error(
      `Status is "${covenant.status}", not "Accepted" — nothing to settle.`
    );
  }
  if (covenant.verdict === null) {
    throw new Error(
      "No verdict on chain. The LZ packet either has not been delivered or was\n" +
        "  rejected by lz_receive — check LayerZeroScan and the my_oapp logs."
    );
  }
  if (covenant.deadline.getTime() <= Date.now()) {
    throw new Error(
      `Deadline ${covenant.deadline.toISOString()} has already passed.`
    );
  }

  const vault = getAssociatedTokenAddressSync(
    COLLATERAL_MINT,
    pda,
    true
  ); // allowOwnerOffCurve for PDA
  const userAta = getAssociatedTokenAddressSync(COLLATERAL_MINT, user.publicKey);
  const executorAta = getAssociatedTokenAddressSync(
    COLLATERAL_MINT,
    executor.publicKey
  );

  const [totalRaw, userBefore, executorBefore] = await Promise.all([
    tokenBalanceRaw(connection, COLLATERAL_MINT, pda),
    tokenBalanceRaw(connection, COLLATERAL_MINT, user.publicKey),
    tokenBalanceRaw(connection, COLLATERAL_MINT, executor.publicKey),
  ]);

  // Mirror the on-chain split so the operator can see the expected outcome
  // before signing. settle() does the same arithmetic in settle.rs.
  const cap = BigInt(covenant.compensationCap);
  const expectedUser = covenant.verdict
    ? 0n
    : cap < totalRaw
      ? cap
      : totalRaw;
  const expectedExecutor = covenant.verdict
    ? totalRaw
    : totalRaw - expectedUser;

  console.log("\n--- balances before ---");
  console.log("  vault   :", formatUnits(totalRaw, decimals), "tokens");
  console.log("  user    :", formatUnits(userBefore, decimals), "tokens");
  console.log("  executor:", formatUnits(executorBefore, decimals), "tokens");
  console.log("\nexpected after settle (verdict =", covenant.verdict, ")");
  console.log("  user    :", formatUnits(userBefore + expectedUser, decimals));
  console.log("  executor:", formatUnits(executorBefore + expectedExecutor, decimals));
  console.log("  vault   : 0");

  if (totalRaw === 0n) throw new Error("Vault is empty — nothing to settle.");
  if (executor.publicKey.equals(user.publicKey)) {
    console.warn(
      "\n  ! executor == user: the remainder leg will move tokens between the\n" +
        "    same owner. Set COVENANT_EXECUTOR_KEYPAIR for a real split test."
    );
  }

  const data = Buffer.concat([discriminator("settle")]);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: COLLATERAL_MINT, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: executorAta, isSigner: false, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  // settle is permissionless w.r.t the program, but a transaction still needs
  // a fee payer; keep user as that signer (it is not an account the program reads).
  const sig = await sendAndConfirmTransaction(connection, tx, [user]);
  console.log("\nSettled! Tx:", sig);

  const [totalAfter, userAfter, executorAfter] = await Promise.all([
    tokenBalanceRaw(connection, COLLATERAL_MINT, pda),
    tokenBalanceRaw(connection, COLLATERAL_MINT, user.publicKey),
    tokenBalanceRaw(connection, COLLATERAL_MINT, executor.publicKey),
  ]);

  console.log("\n--- balances after ---");
  console.log("  vault   :", formatUnits(totalAfter, decimals), "tokens");
  console.log("  user    :", formatUnits(userAfter, decimals), "tokens");
  console.log("  executor:", formatUnits(executorAfter, decimals), "tokens");

  const settled = await fetchCovenant(connection, pda);
  console.log("");
  if (settled) printCovenant(settled, decimals);

  const ok =
    userAfter === userBefore + expectedUser &&
    executorAfter === executorBefore + expectedExecutor &&
    totalAfter === 0n;
  console.log(
    ok
      ? "\nOK: split matches expectation, vault drained."
      : "\nWARNING: on-chain balances differ from the predicted split."
  );
  if (!ok) process.exitCode = 1;
}

main().catch(fail);
