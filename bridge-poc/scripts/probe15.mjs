import { ethers } from "ethers";
import fs from "fs";

const RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const provider = new ethers.providers.JsonRpcProvider(RPC);
const EMITTER = "0xa973c2692C1556E1a3d478e745e9a75624AEDc73";
const KEEPERS = ["0xb38302e27bAe8932536A84ab362c3d1013420Cb4"];
const WATCHED = {
  "0xc63632d7ad3f506081d270a4c3e084f9e76cee64": "handler_c636",
  "0xc881c2391611829d7bc81c12a285cb0201f08f8c": "handler_C881",
  "0x6b489dd5bb1aae8df246359d59aa7316760a75d2": "router_6B48",
  "0x70971d34b3ec574464706aa7eebea4644baaa687": "smartacct_7097",
  "0xea30c4b8b44078bbfa8a6ef5b9f1ec1626c7848d9": "proxy_eA30",
  "0xf95044f0d9890767f2dec599873534ed70bee48a": "exec_F950_c636",
  "0x10811c567cc044c7183590147ce7c339930dd06d": "exec_1081_C881",
  "0xed50b2a1ef0c35daaf08da6486971180237909c3": "router_OLD",
};

const n = (x) => x.toLowerCase();

(async () => {
  const cur = await provider.getBlockNumber();
  const from = cur - 6000;
  console.log(`# blocks ${from}..${cur}`);

  // 1. all EventEmitter logs in window
  const logs = await provider.getLogs({ address: EMITTER, fromBlock: from, toBlock: cur });
  console.log(`# emitter logs: ${logs.length}`);

  // unique txs, resolve from/to
  const txHashes = [...new Set(logs.map((l) => l.transactionHash))];
  const txs = {};
  await Promise.all(
    txHashes.map(async (h) => {
      const t = await provider.getTransaction(h);
      txs[h] = { from: n(t.from), to: n(t.to || "0x"), block: t.blockNumber };
    })
  );

  // topic0 histogram with entry context
  const byTopic = {};
  for (const l of logs) {
    const key = l.topics[0];
    byTopic[key] = byTopic[key] || { count: 0, entries: new Set() };
    byTopic[key].count++;
    const t = txs[l.transactionHash];
    const entry = WATCHED[t.to] || t.to.slice(0, 10);
    byTopic[key].entries.add(entry);
  }
  console.log("\n## topic0 histogram (entry contract of creating tx)");
  for (const [k, v] of Object.entries(byTopic)) {
    console.log(`${k} n=${v.count} via [${[...v.entries].join(", ")}]`);
  }

  // entries + from-address histogram for every topic
  console.log("\n## topic0 -> creator entry (full) / executor from histogram");
  for (const [k, v] of Object.entries(byTopic)) {
    const entries = {};
    for (const l of logs.filter((x) => x.topics[0] === k)) {
      const t = txs[l.transactionHash];
      entries[`${WATCHED[t.to] || t.to}|${t.from}`] = (entries[`${WATCHED[t.to] || t.to}|${t.from}`] || 0) + 1;
    }
    console.log(`${k.slice(0, 14)} n=${v.count}`);
    for (const [ek, ev] of Object.entries(entries)) console.log(`   ${ek} x${ev}`);
  }

  // OrderCreated logs detail: which entry, which market, execution outcome
  const ORDER_CREATED = logs
    .filter((l) => l.topics[0].startsWith("0x468a25a7"))
    .slice(-6);
  console.log("\n## recent OrderCreated detail");
  for (const l of ORDER_CREATED) {
    const t = txs[l.transactionHash];
    const blk = await provider.getBlock(l.blockNumber);
    const w = (i) => ethers.BigNumber.from("0x" + l.data.slice(2 + i * 64, 2 + (i + 1) * 64));
    console.log(
      JSON.stringify({
        block: l.blockNumber,
        ts: blk.timestamp,
        tx: l.transactionHash,
        entry: WATCHED[t.to] || t.to,
        from: t.from,
        words: { w11: w(11).toString(), w15: w(15).toString(), w18: w(18).toString(), w39: w(39).toString() },
      })
    );
  }

  // 2. find keeper txs in window: scan logs whose tx.from is keeper
  const keeperSet = new Set(KEEPERS.map(n));
  const keeperTxs = [...new Set(Object.entries(txs).filter(([, t]) => keeperSet.has(t.from)).map(([h]) => h))];
  console.log(`\n## keeper txs in window: ${keeperTxs.length}`);
  for (const h of keeperTxs.slice(-8)) {
    const r = await provider.getTransactionReceipt(h);
    const t = txs[h];
    const blk = await provider.getBlock(t.block);
    const addrs = [...new Set(r.logs.map((l) => WATCHED[n(l.address)] || n(l.address).slice(0, 10)))];
    const topics = [...new Set(r.logs.map((l) => l.topics[0].slice(0, 10)))];
    console.log(JSON.stringify({ tx: h, block: t.block, ts: blk.timestamp, to: WATCHED[t.to] || t.to, logAddrs: addrs, topics }));
  }

  // 3. positions of the recent real order receiver + ours via OLD reader (shared DS)
  const readerAbi = JSON.parse(fs.readFileSync("/tmp/opencode/gmx/Reader.json", "utf8"));
  const reader = new ethers.Contract(
    "0x4750376b9378294138Cf7B7D69a2d243f4940f71",
    Array.isArray(readerAbi) ? readerAbi : readerAbi.abi,
    provider
  );
  const DS = "0xCF4c2C4c53157BcC01A596e3788fFF69cBBCD201";
  for (const acct of ["0x6bfA2EEF89B10C042089Ba70F15d1af2B93E2624", process.env.GMX_EXECUTOR ?? "0x0Ac16B86d0396Bb7558f144fBb9FbbB91857ff4b"]) {
    try {
      const ps = await reader.getAccountPositions(DS, acct, 0, 10);
      console.log(`\n## positions(${acct}): ${ps.length}`);
      for (const p of ps) {
        console.log(JSON.stringify({
          market: p.addresses.market,
          collateral: p.addresses.collateralToken,
          account: p.addresses.account,
          sizeInUsd: p.numbers.sizeInUsd.toString(),
          sizeInTokens: p.numbers.sizeInTokens.toString(),
          lastIncreasedTime: p.numbers.lastIncreasedTime?.toString?.() ?? p.numbers[7]?.toString(),
          isLong: p.isLong,
        }));
      }
    } catch (e) {
      console.log(`positions(${acct}) ERR ${e.message.slice(0, 200)}`);
    }
  }

  // 4. ETH ticker
  const tick = await (await fetch("https://dolphin-app-a2dup.ondigitalocean.app/prices/tickers")).json();
  const eth = tick.find((x) => n(x.tokenAddress) === "0x980b62da83eff3d4576c647993b0c1d7faf17c73");
  console.log("\n## ETH ticker", JSON.stringify(eth));
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
