import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// repo root, derived — scripts/ → covenant/programs/covenant → colosseum/
const ROOT = path.resolve(__dirname, "../../../..");
const CONSTS = `${ROOT}/covenant/programs/covenant/src/constants.rs`;
const OAPP_JSON = `${ROOT}/bridge-poc/deployments/solana-testnet/OApp.json`;
const VAULT = "53ocFZnSae5WLcr38FQNoeAXx5PV4iKoMAyRQdjMcgkk";
const COV_04 = "AqqzLA4rgzirYZNgD2w4X19ZGW2eAimdjJiGaDLB12Eb";
const CLI_WALLET = "5Y3bBmXAzY8ZsCWPNHfvoR5KvXQhDa8xyyzbzxa9N6gE";

async function read(c: Connection, key: PublicKey, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const a = await c.getAccountInfo(key);
    if (a) return a;
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return null;
}

(async () => {
  const c = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const j = JSON.parse(fs.readFileSync(OAPP_JSON, "utf8"));

  const oapp = new PublicKey(j.programId);
  const [derivedStore, bump] = PublicKey.findProgramAddressSync([Buffer.from("Store")], oapp);
  if (derivedStore.toBase58() !== j.oapp) throw new Error("store derivation disagrees with OApp.json");

  const vault = await read(c, new PublicKey(VAULT));
  if (!vault) throw new Error("could not read vault");
  const mint = new PublicKey(vault.data.subarray(0, 32));

  const ata = getAssociatedTokenAddressSync(mint, new PublicKey(COV_04), true).toBase58();
  if (ata !== VAULT) throw new Error(`mint does not derive the covenant vault (${ata})`);

  const mintAcct = await read(c, mint);
  if (!mintAcct) throw new Error("could not read mint");
  if (mintAcct.space !== 82) throw new Error(`mint is ${mintAcct.space}B, expected 82`);
  if (mintAcct.data.readBigUInt64LE(36) < 1000000000000n) throw new Error(`mint supply below initial 1e12: ${mintAcct.data.readBigUInt64LE(36)}`);
  const authTag = mintAcct.data.readUInt32LE(0);
  const auth = authTag === 1 ? new PublicKey(mintAcct.data.subarray(4, 36)).toBase58() : "REVOKED";

  console.log("derived from chain (no hand-typing):");
  console.log(`  MY_OAPP_ID      = ${oapp.toBase58()}`);
  console.log(`  COLLATERAL_MINT = ${mint.toBase58()}`);
  console.log(`  STORE_PDA       = ${derivedStore.toBase58()}  (bump ${bump})`);
  console.log(`  mint authority  = ${auth}`);
  console.log(`  ATA(mint, user) = ${getAssociatedTokenAddressSync(mint, new PublicKey(CLI_WALLET), true).toBase58()}`);

  let src = fs.readFileSync(CONSTS, "utf8");
  const set = (name: string, val: string) => {
    const re = new RegExp(`^pub const ${name}:.*$`, "m");
    const cur = src.match(re);
    if (!cur) throw new Error(`pattern for ${name} not found`);
    let line = cur[0];
    if (cur[0].includes("pubkey!")) line = `pub const ${name}: Pubkey = pubkey!("${val}");`;
    else if (cur[0].includes(": u8")) line = `pub const ${name}: u8 = ${val};`;
    src = src.replace(re, line);
    console.log(`  set ${name} = ${val}`);
  };
  set("MY_OAPP_ID", oapp.toBase58());
  set("COLLATERAL_MINT", mint.toBase58());
  set("STORE_PDA", derivedStore.toBase58());
  set("STORE_BUMP", String(bump));

  fs.writeFileSync(CONSTS, src);
  console.log("\nrewrote src/constants.rs");
})();
