import { ethers } from "ethers";
import fs from "fs";

const RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const provider = new ethers.providers.JsonRpcProvider(RPC);
const EMITTER = "0xa973c2692C1556E1a3d478e745e9a75624AEDc73";
const LIVE_ROUTER = "0x604c922c98cd007ccff34021f45f1be0dfd1fd32";
const KEEPER = "0xb38302e27bae8932536a84ab362c3d1013420cb4";

const EVENTLOG2 = "0x468a25a7ba624ceea6e540ad6f49171b52495b648417ae91bca21676d8a24dc5";
const EVENTLOG = "0x137a44067c8961cd7e1d876f4754a5a3a75989b4552f1843fc69c3b372def160";

const NAMES = [
  "OrderCreated","OrderExecuted","OrderUpdated","OrderCancelled","OrderMinExecutionFeeUpdated",
  "PositionCreated","PositionIncreased","PositionDecreased","PositionClosed","PositionLiquidated",
  "PositionFeesCollected","PositionImpactPoolAmountUpdated","PaidLiquidationFee","Liquidation",
  "ClaimablePositionFundingAmountUpdated","ClaimablePositionFeeAmountUpdated",
  "DepositCreated","DepositExecuted","DepositCancelled","WithdrawalCreated","WithdrawalExecuted","WithdrawalCancelled",
  "ShiftCreated","ShiftExecuted","SwapExecuted","SwapPriceUpdated","PaidSwapFee",
  "FeeWithdrawn","OrderFeeWithdrawn","AffiliateRewardUpdated","ReferralStorageUpdated",
  "ConfigSet","UintSet","IntSet","AddressSet","BoolSet","Bytes32Set","BytesSet","StringSet","Int256Set",
  "PriceChange","MarketCreated","MarketReservedAmountUpdated","OpenInterestIncreased","OpenInterestDecreased",
  "ClaimFundingFee","TransferAsset","TokenTransferReverted","ExecuteOrder","OrderState",
  "GlvDepositCreated","GlvDepositExecuted","GlvWithdrawalCreated","GlvWithdrawalExecuted","GlvShiftCreated","GlvShiftExecuted",
  "ContributionTokenWithdrawn","ContributorUpdated","GovernanceTokenWithdrawn",
  "CollateralTransfer","MaxPricingDivisorUpdated","PositionImpactEffectSet","ShouldValidateWithdrawalSet",
  "GasFeeUpdated","SwapDepositLimitUpdated","AtomicTransfer","Transfer",
];
const NAME_TO_TOPIC = {};
for (const n of NAMES) NAME_TO_TOPIC[ethers.utils.id(n)] = n;

const erUi = JSON.parse(fs.readFileSync("/tmp/opencode/er_ui.json", "utf8"));
const iface = new ethers.utils.Interface(erUi);
const oldRouterAbi = (() => { try { const j = JSON.parse(fs.readFileSync("/tmp/opencode/gmx2/ExchangeRouter.json", "utf8")); return j.abi; } catch { return null; } })();

(async () => {
  const cur = await provider.getBlockNumber();
  const from = cur - 6000;

  const [el2, el1] = await Promise.all([
    provider.getLogs({ address: EMITTER, fromBlock: from, toBlock: cur, topics: [EVENTLOG2] }),
    provider.getLogs({ address: EMITTER, fromBlock: from, toBlock: cur, topics: [EVENTLOG] }),
  ]);

  const txCache = {};
  const getTx = async (h) => (txCache[h] = txCache[h] || (await provider.getTransaction(h)));

  const groups = {}; // name|to|fromKind
  const createdOrders = []; // {key, block, tx, to}
  const executedOrders = []; // {key, block, tx, to}
  for (const l of [...el2, ...el1]) {
    const name = NAME_TO_TOPIC[l.topics[1]] || l.topics[1].slice(0, 12);
    const t = await getTx(l.transactionHash);
    const fromKind = t.from.toLowerCase() === KEEPER ? "keeper" : "user";
    const g = `${name} | to=${t.to} | ${fromKind}`;
    groups[g] = (groups[g] || 0) + 1;
    if (name === "OrderCreated") createdOrders.push({ key: l.topics[2], block: l.blockNumber, tx: l.transactionHash, to: (t.to || "").toLowerCase(), from: t.from });
    if (name === "OrderExecuted") executedOrders.push({ key: l.topics[2], block: l.blockNumber, tx: l.transactionHash, to: (t.to || "").toLowerCase() });
  }
  console.log("## groups (name | tx.to | who) xN");
  for (const [k, v] of Object.entries(groups).sort()) console.log(`  ${k} x${v}`);

  // correlation: created via LIVE_ROUTER -> executed where?
  const execByKey = {};
  for (const e of executedOrders) (execByKey[e.key] = execByKey[e.key] || []).push(e);
  console.log("\n## orders created via live router 0x604c — execution status");
  const viaRouter = createdOrders.filter((c) => c.to === LIVE_ROUTER.toLowerCase());
  for (const c of viaRouter.slice(-6)) {
    const ex = execByKey[c.key];
    console.log(JSON.stringify({ key: c.key.slice(0, 18), block: c.block, tx: c.tx.slice(0, 18), executed: ex ? ex.map((e) => ({ to: e.to, block: e.block, tx: e.tx.slice(0, 18) })) : null }));
  }
  console.log(`via-router created=${viaRouter.length} executedKeys=${viaRouter.filter((c) => execByKey[c.key]).length}`);

  console.log("\n## orders created direct-to-handler 0xc636");
  const viaH = createdOrders.filter((c) => c.to === "0xc63632d7ad3f506081d270a4c3e084f9e76cee64");
  for (const c of viaH.slice(-4)) {
    const ex = execByKey[c.key];
    console.log(JSON.stringify({ key: c.key.slice(0, 18), block: c.block, from: c.from.slice(0, 12), executed: ex ? ex.map((e) => ({ to: e.to, block: e.block })) : null }));
  }

  // mystery fn 0x98961bb9: full data words + selector hunt
  const mysteryTx = await provider.getTransaction("0x61a656e98854d078fe89e60b1004c390a1ca29fa2143afb4b5efd6013060d89a");
  console.log("\n## mystery tx data words (selector 0x98961bb9)");
  const d = mysteryTx.data.slice(10);
  for (let i = 0; i * 64 < d.length; i++) console.log(`  w${i}: 0x${d.slice(i * 64, (i + 1) * 64)}`);

  // selectors present in live router bytecode
  const code = await provider.getCode(LIVE_ROUTER);
  const push4 = new Set([...code.matchAll(/63([0-9a-f]{8})/g)].map((m) => "0x" + m[1]));
  console.log(`\nlive router has PUSH4 selectors: ${push4.size}`);
  const known = {};
  for (const f of erUi.filter((x) => x.type === "function")) {
    try { known[iface.getSighash(f.name)] = f.name; } catch {}
  }
  if (oldRouterAbi) {
    const oi = new ethers.utils.Interface(oldRouterAbi);
    for (const f of oldRouterAbi.filter((x) => x.type === "function")) {
      try { known[oi.getSighash(f.name)] = known[oi.getSighash(f.name)] || "OLD:" + f.name; } catch {}
    }
  }
  // also common candidates
  for (const sig of ["multicall(bytes[])", "multicall(bytes32[],bytes[])", "sendTokens(address,address,uint256)", "createOrder(bytes32,(address,address,address,address,address,address,address[],uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint8,bool,bool,bool,bytes32,bytes32[]),bool)"]) {
    known[ethers.utils.id(sig).slice(0, 10)] = "CAND:" + sig;
  }
  const matched = [...push4].filter((s) => known[s]).map((s) => `${s}=${known[s]}`);
  console.log("matched known:", matched.join(", "));
  console.log("mystery 0x98961bb9 in router PUSH4:", push4.has("0x98961bb9"), "known-as:", known["0x98961bb9"] || "?");
  const unmatched = [...push4].filter((s) => !known[s]);
  console.log("unmatched PUSH4 (first 40):", unmatched.slice(0, 40).join(","));

  // decode unmatched selectors against er_ui + old ABIs by trying parseTransaction? need fns; instead try name candidates
  const candNames = ["createOrderWithFees","createOrderAndSend","createOrderBatch","batchCreateOrder","placeOrder","submitOrder","openOrder","createIncreaseOrder","createOrders","multicallWithValue","multicall2","multicall3","execute","relay","sponsoredCreateOrder","createOrderFromVault","createOrderWithCollateral","createOrderWithDeposit","createOrderWithTransfer","createOrderWithSend","createOrderWithPayment"];
  for (const nm of candNames) {
    const sel = ethers.utils.id(nm + "(bytes32,uint256,uint256,bytes32)").slice(0, 10);
    if (sel === "0x98961bb9") console.log("MATCH template guess A:", nm);
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
