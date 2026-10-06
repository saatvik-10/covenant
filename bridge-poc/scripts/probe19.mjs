import { ethers } from "ethers";

const RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const provider = new ethers.providers.JsonRpcProvider(RPC);

const EVENTLOG2 = "0x468a25a7ba624ceea6e540ad6f49171b52495b648417ae91bca21676d8a24dc5";
const EVENTLOG = "0x137a44067c8961cd7e1d876f4754a5a3a75989b4552f1843fc69c3b372def160";

const eventDataAbi =
  "tuple(" +
  "tuple(tuple(string key,address value)[] items, tuple(string key,address[] value)[] arrayItems)," +
  "tuple(tuple(string key,uint256 value)[] items, tuple(string key,uint256[] value)[] arrayItems)," +
  "tuple(tuple(string key,int256 value)[] items, tuple(string key,int256[] value)[] arrayItems)," +
  "tuple(tuple(string key,bool value)[] items, tuple(string key,bool[] value)[] arrayItems)," +
  "tuple(tuple(string key,bytes32 value)[] items, tuple(string key,bytes32[] value)[] arrayItems)," +
  "tuple(tuple(string key,bytes value)[] items, tuple(string key,bytes[] value)[] arrayItems)," +
  "tuple(tuple(string key,string value)[] items, tuple(string key,string[] value)[] arrayItems)" +
  ")";

const coder = new ethers.utils.AbiCoder();

function decodeEventLogData(dataBytes) {
  const [sender, name, ed] = coder.decode(["address", "string", eventDataAbi], dataBytes);
  const out = { name, sender, items: {}, arrayItems: {} };
  const sections = ["address", "uint", "int", "bool", "bytes32", "bytes", "string"];
  ed.forEach((sec, i) => {
    for (const kv of sec.items) out.items[kv.key] = kv.value.toString();
    for (const kv of sec.arrayItems) out.arrayItems[kv.key] = kv.value.map((v) => (typeof v === "bigint" ? v.toString() : v));
  });
  return out;
}

const NAMES = {};
for (const n of ["OrderCreated", "OrderExecuted", "PositionCreated", "PositionIncreased", "PositionDecreased", "PositionClosed", "PaidLiquidationFee", "PositionFeesCollected", "OrderUpdated"]) {
  NAMES[ethers.utils.id(n)] = n;
}

async function show(txHash) {
  console.log(`\n######## ${txHash}`);
  const r = await provider.getTransactionReceipt(txHash);
  for (const l of r.logs) {
    const ts = l.topics.map((t, i) => (i === 0 ? t.slice(0, 14) : t));
    const topicName = NAMES[l.topics[1]] || "";
    if (l.topics[0] === EVENTLOG2 || l.topics[0] === EVENTLOG) {
      try {
        const dec = decodeEventLogData(l.data);
        console.log(`\n[EVENT] ${dec.name} from ${dec.sender} topics=${ts.join(",")}`);
        console.log("  items:", JSON.stringify(dec.items));
        if (Object.keys(dec.arrayItems).length) console.log("  arrays:", JSON.stringify(dec.arrayItems));
      } catch (e) {
        console.log(`[EVENT?] decode fail ${e.message.slice(0, 80)} topics=${ts.join(",")}`);
      }
    } else {
      const topic1 = l.topics[1] || "0x";
      console.log(`\n[LOG] ${l.address} t0=${l.topics[0].slice(0, 14)} t1=${topic1.slice(0, 14)} t2=${(l.topics[2] || "0x").slice(0, 20)}`);
      // erc20 transfer/approval decode
      if (l.topics[0].startsWith("0xddf252ad") || l.topics[0].startsWith("0x8c5be1e5")) {
        console.log(`   ERC20: from=${ethers.utils.getAddress(l.topics[1].slice(26))} to=${l.topics[2] ? ethers.utils.getAddress(l.topics[2].slice(26)) : "-"} amount=${BigInt(l.data).toString()}`);
      } else {
        console.log(`   data: ${l.data.slice(0, 200)}`);
        // print data as words
        for (let i = 0; i * 64 + 64 <= l.data.length - 2; i += 1) {
          const w = l.data.slice(2 + i * 64, 2 + (i + 1) * 64);
          if (w.replace(/0/g, "").length > 0) console.log(`   w${i}: 0x${w}`);
        }
      }
    }
  }
}

(async () => {
  await show("0x61a656e98854d078fe89e60b1004c390a1ca29fa2143afb4b5efd6013060d89a"); // creation
  await show("0xb3918ceb40146d53680c8cfd2b33ff5e0775bbe232128936effe7ecbcc734fc4"); // execution
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
