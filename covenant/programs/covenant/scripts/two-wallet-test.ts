import {
  Connection, PublicKey, Transaction, TransactionInstruction, Keypair, SystemProgram, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction, createMintToInstruction, getMint, getAccount,
} from "@solana/spl-token";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

const RPC = process.env.RPC_URL ?? "";
const COVENANT_PROGRAM = new PublicKey("Cb5yZqPKS9utNAf6LB3Cb4r36tMHpKtaY8LeNjtkwRAi");
const COV_04_VAULT = new PublicKey("53ocFZnSae5WLcr38FQNoeAXx5PV4iKoMAyRQdjMcgkk");
const WALLET2_PATH = path.join(__dirname, ".wallet2.json");

const ACCEPT_NAMES = ["executor", "covenant", "collateral_mint", "executor_token_account", "collateral_vault", "token_program", "associated_token_program", "system_program"];
const disc = (n: string) => createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);

const NAMES: Record<number, string> = {
  2015: "ConstraintTokenOwner", 2014: "ConstraintTokenMint", 2009: "ConstraintAssociated",
  3012: "AccountNotInitialized", 3014: "AccountNotAssociatedTokenAccount",
  6000: "NotOpen", 6001: "NotAccepted", 6002: "DeadlinePassed", 6003: "DeadlineNotReached",
  6004: "NotExecutor", 6005: "VerdictNotReceived", 6006: "AlreadySettled", 6007: "ConstraintHashMismatch",
  6008: "UnauthorizedOapp", 6009: "WrongMint",
};

let pass = 0, fail = 0;
const expect = (name: string, ok: boolean, got: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}  ->  ${got}`);
  ok ? pass++ : fail++;
};
const hdr = (t: string) => console.log("\n" + "=".repeat(74) + "\n" + t + "\n" + "=".repeat(74));

(async () => {
  const c = new Connection(RPC, "confirmed");
  const user = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8")))
  );

  // Derive the canonical mint from the funded vault (never transcribe it by hand).
  const vaultAcct = await c.getAccountInfo(COV_04_VAULT, "confirmed");
  if (!vaultAcct || vaultAcct.data.length !== 165) throw new Error("covenant 0x04 vault missing");
  const MINT = new PublicKey(vaultAcct.data.subarray(0, 32));
  const srcRs = fs.readFileSync(path.join(__dirname, "../src/constants.rs"), "utf8");
  const literal = srcRs.match(/COLLATERAL_MINT: Pubkey = pubkey!\("([^"]+)"\)/)![1];
  if (!new PublicKey(literal).equals(MINT)) throw new Error(`constants.rs mint != on-chain mint`);
  console.log(`mint (from vault, ${MINT.toBase58().length} chars): ${MINT.toBase58()}`);

  // --- executor wallet #2 ---
  let w2: Keypair;
  if (fs.existsSync(WALLET2_PATH)) {
    w2 = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET2_PATH, "utf8"))));
  } else {
    w2 = Keypair.generate();
    fs.writeFileSync(WALLET2_PATH, JSON.stringify([...w2.secretKey]));
  }
  console.log(`executor #2: ${w2.publicKey.toBase58()}`);
  if (w2.publicKey.equals(user.publicKey)) throw new Error("wallet2 must differ from wallet1");

  const DEC = 10n ** 9n;

  async function send(ixs: TransactionInstruction[], signers: Keypair[], label: string) {
    const tx = new Transaction().add(...ixs);
    const bh = await c.getLatestBlockhash("confirmed");
    tx.recentBlockhash = bh.blockhash;
    tx.feePayer = signers[0].publicKey;
    tx.sign(...signers);
    const sig = await c.sendRawTransaction(tx.serialize());
    await c.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    console.log(`  tx ${label}: ${sig}`);
    return sig;
  }

  async function sim(ix: TransactionInstruction, signers: Keypair[]) {
    for (let attempt = 1; attempt <= 6; attempt++) {
      const tx = new Transaction().add(ix);
      tx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
      tx.feePayer = signers[0].publicKey;
      tx.sign(...signers);
      const s = await c.simulateTransaction(tx);
      const logs = s.value.logs ?? [];
      const stale = logs.some((l) => /AccountNotInitialized|AccountDiscriminatorNotFound/.test(l));
      if (!stale || attempt === 6) {
        let code: number | undefined;
        for (const l of logs) {
          const m = l.match(/custom program error: (0x[0-9a-fA-F]+)/);
          if (m) { code = parseInt(m[1], 16); break; }
        }
        return { code, named: code !== undefined ? (NAMES[code] ?? `code ${code}`) : s.value.err ? `reverted ${JSON.stringify(s.value.err)}` : "NO ERROR", logs, err: s.value.err };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // --- fund executor #2 ---
  const w2Bal = await c.getBalance(w2.publicKey, "confirmed");
  if (w2Bal < 0.2 * LAMPORTS_PER_SOL) {
    await send([SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: w2.publicKey, lamports: 0.5 * LAMPORTS_PER_SOL })], [user], "fund wallet2");
  }
  const w2Ata = getAssociatedTokenAddressSync(MINT, w2.publicKey, true);
  if (!(await c.getAccountInfo(w2Ata, "confirmed"))) {
    await send([createAssociatedTokenAccountInstruction(user.publicKey, w2Ata, w2.publicKey, MINT)], [user], "create wallet2 ATA");
  }

  // --- mint collateral to executor #2 (our wallet is still the mint authority) ---
  const mintState = await getMint(c, MINT, "confirmed");
  const w2Tok = await getAccount(c, w2Ata, "confirmed");
  if (w2Tok.amount < 700n * DEC) {
    if (!mintState.mintAuthority) throw new Error("mint authority revoked; cannot fund executor #2");
    const need = 1000n * DEC - w2Tok.amount;
    await send([createMintToInstruction(MINT, w2Ata, mintState.mintAuthority, need)], [user], `mint ${need / DEC} to wallet2`);
  } else {
    console.log(`  wallet2 already holds ${w2Tok.amount / DEC} tokens; skipping mint`);
  }

  // --- covenant owned by wallet #1, executed by wallet #2 ---
  const HASH = Buffer.alloc(32, 0xb2);
  const [cov] = PublicKey.findProgramAddressSync([Buffer.from("covenant"), user.publicKey.toBuffer(), HASH], COVENANT_PROGRAM);
  const CAP = 500n * DEC;
  const deadline = Math.floor(Date.now() / 1000) + 86400;

  hdr("TWO-WALLET FLOW  (user = wallet #1, executor = wallet #2)");
  console.log(`  covenant: ${cov.toBase58()}`);

  if (!(await c.getAccountInfo(cov, "confirmed"))) {
    const d = Buffer.alloc(72);
    disc("create_covenant").copy(d, 0);
    HASH.copy(d, 8);
    d.writeBigUInt64LE(CAP, 40);
    d.writeBigInt64LE(BigInt(deadline), 48);
    await send([new TransactionInstruction({
      programId: COVENANT_PROGRAM,
      keys: [
        { pubkey: user.publicKey, isSigner: true, isWritable: true },
        { pubkey: cov, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: d,
    })], [user], "create_covenant (user = wallet1)");
  } else {
    console.log("  reusing existing covenant");
  }

  const mkAccept = (executor: Keypair, amount: bigint) => {
    const d = Buffer.alloc(16);
    disc("accept_covenant").copy(d, 0);
    d.writeBigUInt64LE(amount, 8);
    return new TransactionInstruction({
      programId: COVENANT_PROGRAM,
      keys: [
        { pubkey: executor.publicKey, isSigner: true, isWritable: true },
        { pubkey: cov, isSigner: false, isWritable: true },
        { pubkey: MINT, isSigner: false, isWritable: false },
        { pubkey: getAssociatedTokenAddressSync(MINT, executor.publicKey, true), isSigner: false, isWritable: true },
        { pubkey: getAssociatedTokenAddressSync(MINT, cov, true), isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: d,
    });
  };

  hdr("TEST A  executor #2 posts collateral at exactly the cap (500) -- REAL TX");
  {
    const st0 = (await c.getAccountInfo(cov, "confirmed"))!;
    if (new DataView(st0.data.buffer, st0.data.byteOffset, st0.data.byteLength).getUint8(128) === 0) {
      await send([mkAccept(w2, CAP)], [w2], "accept_covenant (executor = wallet2, 500)");
    } else {
      console.log("  covenant already past Open; skipping accept");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  hdr("TEST A2  a third party cannot re-accept an already-accepted covenant");
  {
    // wallet #1 is funded but is not the executor that already accepted this covenant.
    // accept() is not re-entrant: collateral_vault uses `init`, so an existing vault makes
    // the second attempt fail with IllegalOwner before the NotOpen check is even reached.
    const r = await sim(mkAccept(user, CAP), [user]);

    if(!r) {
      throw new Error("const r is undefined in two-test-wallet")
    }

    expect("re-accept is impossible (NotOpen or IllegalOwner)",
      r.code === 6000 || /IllegalOwner|AccountInUse/.test(r.named),
      `${r.named} (${r.code})`);
  }

  hdr("TEST B  settle before any verdict is delivered");
  {
    const ix = new TransactionInstruction({
      programId: COVENANT_PROGRAM,
      keys: [
        { pubkey: cov, isSigner: false, isWritable: true },
        { pubkey: MINT, isSigner: false, isWritable: false },
        { pubkey: getAssociatedTokenAddressSync(MINT, cov, true), isSigner: false, isWritable: true },
        { pubkey: getAssociatedTokenAddressSync(MINT, w2.publicKey, true), isSigner: false, isWritable: true },
        { pubkey: getAssociatedTokenAddressSync(MINT, user.publicKey, true), isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: disc("settle"),
    });
    const r = await sim(ix, [user]);

    if(!r) {
      throw new Error("const r is undefined in two-test-wallet")
    }

    expect("refuses to pay out without a verdict from my_oapp", r.code === 6005, `${r.named} (${r.code})`);
  }

  hdr("STATE");
  {
    // Anchor account layout: [0..8] discriminator, then the fields of `Covenant`.
    const acct = await c.getAccountInfo(cov, "confirmed");
    const raw = acct!.data;
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const b = raw;
    const user_of = new PublicKey(b.subarray(8, 40));
    const executor = new PublicKey(b.subarray(40, 72));
    const collateral = dv.getBigUint64(72, true);
    const cap = dv.getBigUint64(80, true);
    const status = dv.getUint8(128);
    const verdictTag = dv.getUint8(129);
    const bump = dv.getUint8(131);
    console.log(`  user=${user_of.toBase58()}`);
    console.log(`  executor=${executor.toBase58()}`);
    console.log(`  status=${status} (0=Open 1=Accepted 2=Settled)  verdict=${verdictTag === 0 ? "None" : "Some"}  bump=${bump}`);
    console.log(`  collateral=${collateral / DEC}  cap=${cap / DEC}`);
    const v = await getAccount(c, getAssociatedTokenAddressSync(MINT, cov, true), "confirmed");
    console.log(`  vault balance=${v.amount / DEC}`);
    expect("covenant is Accepted by wallet #2 with 500 collateral",
      status === 1 && executor.equals(w2.publicKey) && collateral === CAP && user_of.equals(user.publicKey) && verdictTag === 0,
      `status=${status} executor=${executor.toBase58().slice(0, 8)}.. collateral=${collateral / DEC} verdict=${verdictTag}`);
  }

  console.log("\n" + "=".repeat(74));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  console.log("=".repeat(74));
  process.exit(fail === 0 ? 0 : 1);
})();
