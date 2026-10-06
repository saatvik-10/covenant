import { ethers } from "ethers";
import fs from "fs";

const RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const provider = new ethers.providers.JsonRpcProvider(RPC);
const EMITTER = "0xa973c2692C1556E1a3d478e745e9a75624AEDc73";
const LIVE_ROUTER = "0x604c922c98cd007ccff34021f45f1be0dfd1fd32";
const EVENTLOG2 = "0x468a25a7ba624ceea6e540ad6f49171b52495b648417ae91bca21676d8a24dc5";

const abiJson = JSON.parse(fs.readFileSync("/tmp/opencode/er_ui.json", "utf8"));
const iface = new ethers.utils.Interface(abiJson);

(async () => {
  const cur = await provider.getBlockNumber();

  // getters of live router
  for (const f of ["dataStore", "roleStore", "router", "orderHandler", "orderVault"]) {
    try {
      const v = await new ethers.Contract(LIVE_ROUTER, ["function " + f + "() view returns (address)"], provider)[f]();
      console.log(`router604c.${f} = ${v}`);
    } catch (e) {
      console.log(`router604c.${f} ERR ${e.message.slice(0, 80)}`);
    }
  }

  // selector check vs er_ui abi
  const selectors = {};
  for (const f of ["multicall", "createOrder", "sendTokens", "sendWnt", "sendNativeToken"]) {
    try {
      selectors[f] = iface.getSighash(f);
    } catch (e) {}
  }
  console.log("er_ui selectors:", JSON.stringify(selectors));
  const code = await provider.getCode(LIVE_ROUTER);
  for (const [f, s] of Object.entries(selectors)) {
    console.log(`router604c has ${f} (${s}): ${code.includes(s.slice(2))}`);
  }

  // find real user creation txs via live router (EventLog2 in tx.to==router, from != keeper)
  const KEEP = "0xb38302e27bae8932536a84ab362c3d1013420cb4";
  const logs = await provider.getLogs({ address: EMITTER, fromBlock: cur - 6000, toBlock: cur, topics: [EVENTLOG2] });
  const seen = new Set();
  for (const l of logs) {
    if (seen.has(l.transactionHash)) continue;
    seen.add(l.transactionHash);
    const t = await provider.getTransaction(l.transactionHash);
    if ((t.to || "").toLowerCase() !== LIVE_ROUTER || t.from.toLowerCase() === KEEP) continue;
    console.log(`\n### USER TX ${t.hash} from ${t.from} value=${t.value.toString()}`);
    try {
      const parsed = iface.parseTransaction({ data: t.data, value: t.value });
      console.log("method:", parsed.name);
      const fmt = (a) => (typeof a === "string" && a.startsWith("0x") && a.length === 66 ? a : typeof a === "bigint" ? a.toString() : a);
      if (parsed.name === "multicall") {
        for (const inner of parsed.args[0]) {
          try {
            const p2 = iface.parseTransaction({ data: inner, value: 0 });
            console.log("  inner:", p2.name, JSON.stringify(p2.args, (k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 1500));
          } catch (e) {
            console.log("  inner raw:", inner.slice(0, 80), e.message.slice(0, 60));
          }
        }
      } else {
        console.log(JSON.stringify(parsed.args, (k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 2000));
      }
    } catch (e) {
      console.log("parse fail:", e.message.slice(0, 120), "data:", t.data.slice(0, 200));
    }
    break; // one is enough; also try a second below
  }

  // decode EventLog2 data: extract event NAME string from first bytes
  const sample = logs[logs.length - 1];
  if (sample) {
    const p = new ethers.utils.AbiCoder();
    // EventLog2(event name is somewhere in data as string) - try offsets: data = (string name, bytes32 key, bytes32 account, bytes items...)
    try {
      const decoded = p.decode(["string", "bytes32", "bytes32", "bytes", "bytes", "bytes"], sample.data);
      console.log("\nEventLog2 decoded name:", decoded[0], "key:", decoded[1]);
    } catch (e) {
      // maybe no string at offset0; print first 4 words
      console.log("\nEventLog2 raw head:", sample.data.slice(0, 200));
      try {
        const s = ethers.utils.toUtf8String("0x" + sample.data.slice(sample.data.indexOf("4f72646572") > -1 ? sample.data.indexOf("4f72646572") : 2, 0 + (sample.data.indexOf("4f72646572") + 200)));
        console.log("name sniff:", s.slice(0, 40));
      } catch {}
    }
  }
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
