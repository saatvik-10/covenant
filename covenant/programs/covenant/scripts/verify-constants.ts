import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// repo root, derived — scripts/ → covenant/programs/covenant → colosseum/
const ROOT = path.resolve(__dirname, "../../../..");
const src = fs.readFileSync(`${ROOT}/covenant/programs/covenant/src/constants.rs`, "utf8");

function lit(name: string): string {
  const re = new RegExp(name + '\\s*:\\s*Pubkey\\s*=\\s*pubkey!\\("([^"]+)"\\)');
  const m = src.match(re);
  if (!m) throw new Error(`could not parse ${name} from constants.rs`);
  return m[1];
}

const CLI_WALLET = "5Y3bBmXAzY8ZsCWPNHfvoR5KvXQhDa8xyyzbzxa9N6gE";
const COV_04 = "AqqzLA4rgzirYZNgD2w4X19ZGW2eAimdjJiGaDLB12Eb";

let fail = 0;
function chk(name: string, ok: boolean, extra = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  [" + extra + "]" : ""}`);
  if (!ok) fail++;
}

async function read(c: Connection, key: PublicKey, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const a = await c.getAccountInfo(key);
    if (a) return a;
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return null;
}

(async () => {
  const c = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const oapp = lit("MY_OAPP_ID");
  const mint = lit("COLLATERAL_MINT");
  const store = lit("STORE_PDA");

  console.log("literals parsed from src/constants.rs:");
  for (const [k, v] of [["MY_OAPP_ID", oapp], ["COLLATERAL_MINT", mint], ["STORE_PDA", store]] as [string, string][]) {
    console.log(`  ${k.padEnd(15)} ${v}   (len ${v.length})`);
  }
  console.log("");

  const toml = fs.readFileSync(`${ROOT}/bridge-poc/Anchor.toml`, "utf8").match(/my_oapp = "([^"]+)"/)![1];
  const oj = fs.readFileSync(`${ROOT}/bridge-poc/deployments/solana-testnet/OApp.json`, "utf8");
  const oJson = JSON.parse(oj);
  chk("MY_OAPP_ID == bridge-poc/Anchor.toml", oapp === toml);
  chk("MY_OAPP_ID == deployments/solana-testnet/OApp.json", oapp === oJson.programId);
  chk("STORE_PDA == OApp.json .oapp", store === oJson.oapp);

  const [derived, bump] = PublicKey.findProgramAddressSync([Buffer.from("Store")], new PublicKey(oapp));
  chk('STORE_PDA == findProgram_address(b"Store", MY_OAPP_ID)', derived.toBase58() === store, `bump=${bump}`);

  const sa = await read(c, new PublicKey(store));
  chk("Store exists, owned by MY_OAPP_ID, 360B", !!sa && sa.owner.toBase58() === oapp && sa.space === 360, sa ? `space=${sa.space}` : "null");

  const ma = await read(c, new PublicKey(mint));
  chk("mint exists, 82B", !!ma && ma.space === 82, ma ? `space=${ma.space}` : "null");
  if (ma) {
    chk("mint supply >= 1e12 (1000 tokens initial)", ma.data.readBigUInt64LE(36) >= 1000000000000n, ma.data.readBigUInt64LE(36).toString());
    chk("mint decimals == 9", ma.data[44] === 9);
    const at = ma.data.readUInt32LE(0);
    chk("mint authority SET (COption tag 1)", at === 1, `tag=${at}`);
    if (at === 1) {
      const auth = new PublicKey(ma.data.subarray(4, 36)).toBase58();
      chk("mint authority == CLI wallet", auth === CLI_WALLET);
    }
  }

  chk(
    "ATA(mint,user) == GJ26eDTskMBkq233qbJpfiTUq9UJyGN4E9ZVeLoFkHe2",
    getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(CLI_WALLET), true).toBase58() === "GJ26eDTskMBkq233qbJpfiTUq9UJyGN4E9ZVeLoFkHe2"
  );
  chk(
    "ATA(mint,covenant 0x04) == 53ocFZnSae5WLcr38FQNoeAXx5PV4iKoMAyRQdjMcgkk",
    getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(COV_04), true).toBase58() === "53ocFZnSae5WLcr38FQNoeAXx5PV4iKoMAyRQdjMcgkk"
  );

  console.log("");
  console.log(fail === 0 ? "ALL CONSTANTS VERIFIED AGAINST DEVNET" : `${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
