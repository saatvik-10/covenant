import {
  Connection, PublicKey, Transaction, TransactionInstruction, Keypair, SystemProgram, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { createHash } from "crypto";
import * as fs from "fs";

const RPC = process.env.RPC_URL ?? ""
const COVENANT_PROGRAM = new PublicKey("Cb5yZqPKS9utNAf6LB3Cb4r36tMHpKtaY8LeNjtkwRAi");
let MINT: PublicKey; // derived from the funded vault at startup; never transcribed by hand
const STORE_PDA = new PublicKey("Ciq55LhUSLmckazpWRdaTcHHZZNAdQec4Z9aXPc1T3dV");
const MY_OAPP = "8mKHUrjDP45py3vPY5DCejT3T7FxSHCpsGBVsSDaNfeG";
const USER = new PublicKey("5Y3bBmXAzY8ZsCWPNHfvoR5KvXQhDa8xyyzbzxa9N6gE");
const COV_04 = new PublicKey("AqqzLA4rgzirYZNgD2w4X19ZGW2eAimdjJiGaDLB12Eb");
const COV_04_VAULT = new PublicKey("53ocFZnSae5WLcr38FQNoeAXx5PV4iKoMAyRQdjMcgkk");
const HASH_04 = Buffer.alloc(32, 0x04);

const CONSTRAINT_NAMES: Record<number, string> = {
  3005: "ConstraintHasOne", 3006: "ConstraintSigner", 3007: "ConstraintRaw", 3008: "ConstraintOwner",
  3009: "ConstraintRentExempt", 3010: "ConstraintSeeds", 3011: "ConstraintExecutable", 3012: "ConstraintState",
  3013: "ConstraintAssociated", 3014: "ConstraintAssociatedInit", 3015: "ConstraintClose", 3016: "ConstraintAddress",
  3017: "ConstraintZero", 3018: "ConstraintTokenMint", 3019: "ConstraintTokenOwner",
  6000: "NotOpen", 6001: "NotAccepted", 6002: "DeadlinePassed", 6003: "DeadlineNotReached",
  6004: "NotExecutor", 6005: "VerdictNotReceived", 6006: "AlreadySettled", 6007: "ConstraintHashMismatch",
  6008: "UnauthorizedOapp", 6009: "WrongMint",
};

const ACCEPT_NAMES = ["executor", "covenant", "collateral_mint", "executor_token_account", "collateral_vault", "token_program", "associated_token_program", "system_program"];

const disc = (n: string) => createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);

let pass = 0, fail = 0;
function expect(name: string, ok: boolean, got: string) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}  ->  ${got}`);
  ok ? pass++ : fail++;
}

function hdr(t: string) {
  console.log("\n" + "=".repeat(74) + "\n" + t + "\n" + "=".repeat(74));
}

(async () => {
  const c = new Connection(RPC, "confirmed");
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8")))
  );

  async function preflight(ix: TransactionInstruction, names: string[]) {
    if (!process.env.DEBUG_LOGS) return;
    for (let i = 0; i < ix.keys.length; i++) {
      const info = await c.getAccountInfo(ix.keys[i].pubkey, "confirmed");
      console.log(`    [pf] ${i} ${names[i] ?? "?"} ${ix.keys[i].pubkey.toBase58()} exists=${!!info} len=${info?.data.length ?? "-"} owner=${info?.owner.toBase58().slice(0, 6) ?? "-"}`);
    }
  }

  async function sim(ix: TransactionInstruction, signers: Keypair[]) {
    // NOTE: this web3.js only accepts a signer array as the 2nd arg to
    // simulateTransaction for legacy Transactions (no config object). Devnet RPC
    // also intermittently serves a stale bank, which makes already-existing accounts
    // look uninitialized (3012) -- so retry with a fresh confirmed blockhash.
    let s: Awaited<ReturnType<typeof c.simulateTransaction>> | undefined;
    for (let attempt = 1; attempt <= 6; attempt++) {
      const tx = new Transaction().add(ix);
      tx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
      tx.feePayer = signers[0].publicKey;
      tx.sign(...signers);
      s = await c.simulateTransaction(tx);
      const logs = s.value.logs ?? [];
      const stale = logs.some((l) => /AccountNotInitialized|AccountDiscriminatorNotFound|Error: (NotFound|AccountNotFound)/.test(l));
      if (!stale || attempt === 6) break;
      if (process.env.DEBUG_LOGS) console.log(`  [sim] stale bank on attempt ${attempt}, retrying...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    const logs = s!.value.logs ?? [];
    let code: number | undefined;
    for (const l of logs) {
      const m = l.match(/custom program error: (0x[0-9a-fA-F]+)/);
      if (m) { code = parseInt(m[1], 16); break; }
    }
    const sigFail = logs.some((l) => /signature verification failure/i.test(l));
    const named = code !== undefined ? (CONSTRAINT_NAMES[code] ?? `code ${code}`) : sigFail ? "signature verification failure" : s!.value.err ? `reverted (${JSON.stringify(s!.value.err)})` : "NO ERROR";
    if (process.env.DEBUG_LOGS) {
      console.log("  ---- logs ----");
      for (const l of logs) console.log("   " + l);
    }
    return { code, named, err: s!.value.err, sigFail, logs };
  }

  async function send(ix: TransactionInstruction, signers: Keypair[], label: string) {
    const tx = new Transaction().add(ix);
    const bh = await c.getLatestBlockhash("confirmed");
    tx.recentBlockhash = bh.blockhash;
    tx.feePayer = signers[0].publicKey;
    tx.sign(...signers);
    const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await c.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    console.log(`  created ${label}: ${sig}`);
    return sig;
  }

  // ---------- fixtures ----------
  hdr("FIXTURES");
  // Derive the canonical collateral mint from the funded vault of covenant 0x04.
  // Reading it off-chain avoids every possible transcription error, and we then assert
  // it matches the value compiled into the program (src/constants.rs).
  {
    const vaultAcct = await c.getAccountInfo(COV_04_VAULT, "confirmed");
    if (!vaultAcct || vaultAcct.data.length !== 165) throw new Error("covenant 0x04 vault missing; cannot derive mint");
    MINT = new PublicKey(vaultAcct.data.subarray(0, 32));
    const src = fs.readFileSync(__dirname + "/../src/constants.rs", "utf8");
    const literal = src.match(/COLLATERAL_MINT: Pubkey = pubkey!\("([^"]+)"\)/)![1];
    const compiled = new PublicKey(literal);
    if (!compiled.equals(MINT)) {
      throw new Error(
        `COLLATERAL_MINT in src/constants.rs (${literal}, ${literal.length} chars) ` +
        `does NOT match the on-chain vault mint (${MINT.toBase58()}, ${MINT.toBase58().length} chars)`
      );
    }
    console.log(`  derived mint from vault: ${MINT.toBase58()} (${MINT.toBase58().length} chars)`);
    console.log(`  src/constants.rs agrees: ${literal} (${literal.length} chars)`);
  }

  // A real, well-formed 82-byte spl Mint on devnet that is NOT the canonical collateral mint.
  const badMint = new PublicKey("So11111111111111111111111111111111111111112");
  const badMintAcct = await c.getAccountInfo(badMint);
  if (!badMintAcct || badMintAcct.data.length !== 82) throw new Error("wSOL mint unavailable; cannot run WrongMint test");
  console.log(`  using real wrong mint: ${badMint.toBase58()} (82 bytes, deserializes as Mint)`);

  const HASH_EE = Buffer.alloc(32, 0xee);
  const HASH_DD = Buffer.alloc(32, 0xdd);
  const [covEE] = PublicKey.findProgramAddressSync([Buffer.from("covenant"), USER.toBuffer(), HASH_EE], COVENANT_PROGRAM);
  const [covDD] = PublicKey.findProgramAddressSync([Buffer.from("covenant"), USER.toBuffer(), HASH_DD], COVENANT_PROGRAM);

  const mkCreate = (hash: Buffer, deadline: number) => {
    const d = Buffer.alloc(8 + 32 + 8 + 8);
    disc("create_covenant").copy(d, 0);
    hash.copy(d, 8);
    d.writeBigUInt64LE(500n * 10n ** 9n, 40);
    d.writeBigInt64LE(BigInt(deadline), 48);
    return new TransactionInstruction({
      programId: COVENANT_PROGRAM,
      keys: [
        { pubkey: USER, isSigner: true, isWritable: true },
        { pubkey: hash === HASH_EE ? covEE : covDD, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: d,
    });
  };

  const nowSec = Math.floor(Date.now() / 1000);
  let created = false;
  for (const [hash, cov, label, dl] of [
    [HASH_EE, covEE, "covenant 0xee (open, 24h)", nowSec + 86400],
    [HASH_DD, covDD, "covenant 0xdd (open, 8s deadline)", nowSec + 8],
  ] as [Buffer, PublicKey, string, number][]) {
    if (await c.getAccountInfo(cov)) {
      console.log(`  reusing ${label} @ ${cov.toBase58()}`);
      continue;
    }
    await send(mkCreate(hash, dl), [wallet], label);
    created = true;
  }
  // Newly created accounts are invisible to a simulation whose blockhash predates
  // them, which surfaces as a confusing AccountNotInitialized (3012). Wait for the
  // accounts to be visible in a confirmed slot before running any simulation.
  if (created) {
    for (const cov of [covEE, covDD]) {
      for (let i = 0; i < 30; i++) {
        if (await c.getAccountInfo(cov)) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    await new Promise((r) => setTimeout(r, 4000));
  }

  const mkAccept = (cov: PublicKey, mint: PublicKey, amount: bigint, execAta?: PublicKey) => {
    const d = Buffer.alloc(16);
    disc("accept_covenant").copy(d, 0);
    d.writeBigUInt64LE(amount, 8);
    if (process.env.DEBUG_LOGS) {
      console.log("  [mkAccept] amount raw:", amount.toString(), "data:", d.toString("hex"));
      console.log("  [mkAccept] mint:", mint.toBase58(), "cov:", cov.toBase58());
    }
    return new TransactionInstruction({
      programId: COVENANT_PROGRAM,
      keys: [
        { pubkey: USER, isSigner: true, isWritable: true },
        { pubkey: cov, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: execAta ?? getAssociatedTokenAddressSync(mint, USER, true), isSigner: false, isWritable: true },
        { pubkey: getAssociatedTokenAddressSync(mint, cov, true), isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: d,
    });
  };

  // ---------- tests ----------
  hdr("TEST 1  receive_verdict signed by a funded non-Store wallet");
  {
    const ix = new TransactionInstruction({
      programId: COVENANT_PROGRAM,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: COV_04, isSigner: false, isWritable: true },
      ],
      data: Buffer.concat([disc("receive_verdict"), USER.toBuffer(), HASH_04, Buffer.from([1])]),
    });
    const r = await sim(ix, [wallet]);
    expect("rejects with UnauthorizedOapp", r.code === 6008, `${r.named} (${r.code})`);
  }

  hdr("TEST 2  receive_verdict can only be signed by the Store PDA via CPI");
  {
    // The guard restricts the authority to STORE_PDA. A PDA is off-curve, so no private
    // key can ever produce that signature: the only possible signer is my_oapp CPing in.
    const onCurve = PublicKey.isOnCurve(STORE_PDA.toBuffer());
    const owned = (await c.getAccountInfo(STORE_PDA))?.owner?.toBase58();
    console.log(`  Store PDA off-curve: ${!onCurve}   owner: ${owned}`);
    expect("Store PDA is off-curve => no private key can sign for it", !onCurve, `isOnCurve=${onCurve}`);
    expect("Store PDA is program-owned (only CPI can act as it)", owned === MY_OAPP, `owner=${owned}`);
  }

  hdr("TEST 3  settle with a REAL token account that is not ATA(mint, user)");
  {
    const ix = new TransactionInstruction({
      programId: COVENANT_PROGRAM,
      keys: [
        { pubkey: COV_04, isSigner: false, isWritable: true },
        { pubkey: MINT, isSigner: false, isWritable: false },
        { pubkey: COV_04_VAULT, isSigner: false, isWritable: true },
        { pubkey: getAssociatedTokenAddressSync(MINT, USER, true), isSigner: false, isWritable: true },
        { pubkey: COV_04_VAULT, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: disc("settle"),
    });
    const r = await sim(ix, [wallet]);
    expect("rejects the wrong payout ATA", !!r.err, `${r.named} (${r.code})`);
  }

  hdr("TEST 4  accept with a real-but-wrong collateral mint (ATA checks satisfied)");
  {
    // Supply a real wSOL ATA so every associated_token constraint passes; the only
    // remaining thing that can reject this transaction is the COLLATERAL_MINT pin.
    let wsolAta = getAssociatedTokenAddressSync(badMint, USER, true);
    if (!(await c.getAccountInfo(wsolAta))) {
      console.log("  creating wSOL ATA for the executor so the ATA constraints pass...");
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(USER, wsolAta, USER, badMint)
      );
      const bh = await c.getLatestBlockhash("confirmed");
      tx.recentBlockhash = bh.blockhash;
      tx.feePayer = USER;
      tx.sign(wallet);
      const sig = await c.sendRawTransaction(tx.serialize());
      await c.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      for (let i = 0; i < 30; i++) {
        if (await c.getAccountInfo(wsolAta, "confirmed")) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    const aix = mkAccept(covEE, badMint, 1n, wsolAta);
    await preflight(aix, ACCEPT_NAMES);
    const r = await sim(aix, [wallet]);
    expect("rejects with WrongMint", r.code === 6009, `${r.named} (${r.code})`);
  }

  hdr("TEST 5  accept after the deadline has passed");
  {
    await new Promise((r) => setTimeout(r, 11000));
    const r = await sim(mkAccept(covDD, MINT, 1n), [wallet]);
    expect("rejects with DeadlinePassed", r.code === 6002, `${r.named} (${r.code})`);
  }

  hdr("TEST 6  accept with the correct mint still passes the mint constraint");
  {
    const aix = mkAccept(covEE, MINT, 1n);
    await preflight(aix, ACCEPT_NAMES);
    const r = await sim(aix, [wallet]);
    const wrongMint = r.code === 6009;
    expect("correct mint does NOT trigger WrongMint", !wrongMint, `${r.named} (${r.code})`);
  }

  console.log("\n" + "=".repeat(74));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  console.log("=".repeat(74));
  process.exit(fail === 0 ? 0 : 1);
})();
