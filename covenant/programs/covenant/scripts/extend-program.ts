import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, Keypair } from "@solana/web3.js";
import * as fs from "fs";

const RPC = "https://api.devnet.solana.com";
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const PROGRAM = new PublicKey("Cb5yZqPKS9utNAf6LB3Cb4r36tMHpKtaY8LeNjtkwRAi");

const ADDITIONAL = 10240;

function extendProgramIx(tag: number, additional: number) {
  const data = Buffer.alloc(8);
  data.writeUInt32LE(tag, 0);
  data.writeUInt32LE(additional, 4);
  return new TransactionInstruction({
    programId: LOADER,
    keys: [
      { pubkey: PROGRAM, isSigner: false, isWritable: true },
      { pubkey: new PublicKey("5GPKBxMqRwdPiBTidFkxEY8GeACJmwMFxbPhXKCWkm8s"), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

(async () => {
  const c = new Connection(RPC, "confirmed");
  const kp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8")))
  );

  const cur = await c.getAccountInfo(PROGRAM);
  console.log("program data length now:", cur?.space, "| dataLen (on-chain program size):", cur?.space);

  for (const tag of [0,1,2,3,8,9,10]) {
    const tx = new Transaction().add(extendProgramIx(tag, ADDITIONAL));
    tx.recentBlockhash = (await c.getLatestBlockhash()).blockhash;
    tx.feePayer = kp.publicKey;
    tx.sign(kp);
    try {
      const sim = await c.simulateTransaction(tx);
      const logs = sim.value.logs ?? [];
      const interesting = logs.filter((l) => !/^Program \d{32,}/.test(l) && !l.includes("success") && !l.includes("invoke"));
      console.log(`\ntag ${tag}: err=${sim.value.err ? JSON.stringify(sim.value.err) : "NONE"} units=${sim.value.units}`);
      interesting.forEach((l) => console.log("   ", l));
    } catch (e: any) {
      console.log(`\ntag ${tag}: RPC error ${e.message.slice(0, 120)}`);
    }
  }
})();
