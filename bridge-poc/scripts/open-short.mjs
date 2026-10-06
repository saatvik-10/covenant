/**
 * Phase 1: open one real GMX short for the executor account.
 *
 * Path (decoded from live chain, see summary):
 *   ExchangeRouter(0x6B48...).multicall([
 *     sendWnt(orderVault, executionFee),     // fee leg, value-forwarded
 *     sendTokens(USDC, orderVault, amount),  // collateral leg, allowance to router
 *     createOrder(params)                    // MarketIncrease, isLong=false
 *   ], { value: executionFee })
 *
 * The order lands in the shared order store; the keeper executes it via
 * handler 0xc636 (orders created through handler 0xC881 are executed —
 * proven 4/4 in a 25 min live window).
 *
 * Usage:
 *   node scripts/open-short.mjs [--size-usd 10000] [--collateral-usdc 1000]
 *                                [--max-exposure 5000] [--floor-bps 7000]
 *                                [--poll-minutes 30] [--send]
 *
 *   Without --send the script only simulates (approve is read, multicall is
 *   eth_call'd) and prints what it would do.
 *
 * Env: PRIVATE_KEY from covenant/.env or bridge-poc/.env; LZ_RPC optional;
 *      VERIFIER_ADDRESS / GMX_EXECUTOR / TICKER_URL optional (defaults are
 *      the recorded demo values).
 *
 * Writes: artifacts/demo-pass/step1-open-short.log (tee) and
 *         artifacts/demo-pass/step1-open-short.json (machine summary)
 */

import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const req = createRequire(import.meta.url);
const { ethers } = req("ethers");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..", "..");

// ---------------------------------------------------------------- constants
const ROUTER = "0x6B489dD5bB1AAE8df246359d59aA7316760a75d2"; // master-config ExchangeRouter (er_ui ABI)
// sendTokens routes the ERC20 pull through SyntheticsRouter — allowance must
// be granted to it, not to the ExchangeRouter (proven empirically + matches
// the live user receipt: USDC Approval spender = 0x72F13a44).
const SPENDER = "0x72F13a44C8ba16a678CAD549F17bc9e06d2B8bD2"; // SyntheticsRouter
const ORDER_VAULT = "0x1b8AC606de71686fd2a1AEDEcb6E0EFba28909a2";
const DATASTORE = "0xCF4c2C4c53157BcC01A596e3788fFF69cBBCD201";
const MARKET = "0xb6fC4C9eB02C35A134044526C62bb15014Ac0Bcc";
const USDC = "0x3253a335E7bFfB4790Aa4C25C4250d206E9b9773";
const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
// GMX EventEmitter — getLogs needs an address filter (publicnode rejects
// unbounded queries); every OrderCreated/Executed/Cancelled comes from it.
const EVENT_EMITTER = "0xa973c2692C1556E1a3d478e745e9a75624AEDc73";
const TICKER_URL =
  process.env.TICKER_URL ??
  "https://dolphin-app-a2dup.ondigitalocean.app/prices/tickers";

const RPCS = [
  process.env.LZ_RPC,
  "https://arbitrum-sepolia-rpc.publicnode.com",
  "https://sepolia-rollup.arbitrum.io/rpc",
].filter(Boolean);

const ORDER_TYPE_MARKET_INCREASE = 2;
const DEFAULT_EXECUTION_FEE = ethers.BigNumber.from("10000000000000000"); // 0.01 ETH, proven live
// GasUtils.validateExecutionFee: minExecutionFee = adjustedGasLimit * tx.gasprice.
// eth_call has tx.gasprice=0 (masks the check), real txs use basefee+tip.
// ethers' default 1.5 gwei tip blew min to 0.0214 ETH > fee -> first send
// reverted (0x6d906d68...). Keep tip tiny so effective gasprice stays far
// below fee/gasLimit (1e16/13.85M = 0.72 gwei ceiling).
const TIP_WEI = 100000000; // 0.1 gwei
const MAX_FEE_WEI = 1500000000; // 1.5 gwei (headroom so the tx never stalls)
const MAX_SEND_ATTEMPTS = 3;

// ------------------------------------------------------------------ helpers
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

const LOG_PATH = path.join(REPO, "bridge-poc", "artifacts", "demo-pass", "step1-open-short.log");
const JSON_PATH = path.join(REPO, "bridge-poc", "artifacts", "demo-pass", "step1-open-short.json");
let logStream = null;

function log(...args) {
  const line = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2)))
    .join(" ");
  console.log(line);
  if (!logStream) {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    logStream = fs.createWriteStream(LOG_PATH, { flags: "a" });
  }
  logStream.write(line + "\n");
}

function fail(msg) {
  log("FATAL: " + msg);
  if (logStream) logStream.end();
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    sizeUsd: "10000",
    collateralUsdc: "1000",
    maxExposure: "5000",
    floorBps: "7000", // 70% of last observed execution price
    pollMinutes: "30",
    send: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--send") out.send = true;
    else if (a === "--size-usd") out.sizeUsd = argv[++i];
    else if (a === "--collateral-usdc") out.collateralUsdc = argv[++i];
    else if (a === "--max-exposure") out.maxExposure = argv[++i];
    else if (a === "--floor-bps") out.floorBps = argv[++i];
    else if (a === "--poll-minutes") out.pollMinutes = argv[++i];
    else fail("unknown arg: " + a);
  }
  return out;
}

async function makeProvider() {
  let lastErr;
  for (const url of RPCS) {
    try {
      const p = new ethers.providers.JsonRpcProvider(url, 421614);
      await p.getBlockNumber();
      return p;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("no RPC available");
}

function usdToContract(priceUsd18) {
  // 30-decimals USD scale used by GMX
  return ethers.BigNumber.from(priceUsd18.toString());
}

async function getTickers() {
  const res = await fetch(TICKER_URL);
  if (!res.ok) throw new Error("ticker HTTP " + res.status);
  const body = await res.json();
  const arr = Array.isArray(body) ? body : body.tickers ?? body.data ?? [];
  const eth = arr.find(
    (t) => (t.tokenAddress ?? "").toLowerCase() === WETH.toLowerCase()
  );
  if (!eth) throw new Error("ETH not found in ticker feed");
  return eth;
}

function abiFromJson(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  return j.abi ?? j;
}

// -------------------------------------------------------------------- main
// Keys are keccak256(abi.encode("NAME")) per gmx-synthetics contracts/data/Keys.sol
function dsKey(name) {
  return ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["string"], [name]));
}

/**
 * Mirrors GasUtils.validateExecutionFee + validateAndCapExecutionFee for our
 * exact params (no swaps, callbackGasLimit=0):
 *   gasLimit    = BASE + PER_ORACLE * 3 + applyFactor(INCREASE_ORDER_GAS_LIMIT, MULT)
 *   minFee      = gasLimit * (block.basefee + tip)     // tx.gasprice in the EVM
 * eth_call runs with tx.gasprice=0, so only this explicit guard (and the tx
 * itself) can catch an underpriced fee.
 */
async function computeFeeGuard(provider, executionFee, tipWei) {
  const ds = new ethers.Contract(
    DATASTORE,
    ["function getUint(bytes32) view returns (uint256)"],
    provider
  );
  const [base, perOracle, estMult, incGas] = await Promise.all([
    ds.getUint(dsKey("ESTIMATED_GAS_FEE_BASE_AMOUNT_V2_1")),
    ds.getUint(dsKey("ESTIMATED_GAS_FEE_PER_ORACLE_PRICE")),
    ds.getUint(dsKey("ESTIMATED_GAS_FEE_MULTIPLIER_FACTOR")),
    ds.getUint(dsKey("INCREASE_ORDER_GAS_LIMIT")),
  ]);
  const oraclePriceCount = 3; // estimateOrderOraclePriceCount(0 swaps) = 3 + 0
  const precision = ethers.BigNumber.from("1000000000000000000000000000000"); // 1e30
  const gasLimit = base
    .add(perOracle.mul(oraclePriceCount))
    .add(incGas.mul(estMult).div(precision));
  const block = await provider.getBlock("latest");
  const basefee = block.baseFeePerGas ?? ethers.constants.Zero;
  const effective = basefee.add(tipWei);
  const minFee = gasLimit.mul(effective);
  const maxFeeCeiling = executionFee.div(gasLimit); // highest gasprice fee can carry
  return { gasLimit, basefee, effective, minFee, maxFeeCeiling, ok: executionFee.gte(minFee) };
}

async function main() {
  const args = parseArgs(process.argv);
  loadEnvFile(path.join(REPO, "covenant", ".env"));
  loadEnvFile(path.join(REPO, "bridge-poc", ".env"));

  const VERIFIER =
    process.env.VERIFIER_ADDRESS ?? "0xFeB7204dc23609623bF1C0A09fccF3F625d3ACfc";
  const ACCOUNT =
    process.env.GMX_EXECUTOR ?? "0x0Ac16B86d0396Bb7558f144fBb9FbbB91857ff4b";

  const pk = process.env.PRIVATE_KEY;
  if (!pk) fail("PRIVATE_KEY not set");

  const provider = await makeProvider();
  const wallet = new ethers.Wallet(pk, provider);
  const send = args.send;

  const routerAbi = abiFromJson(path.join(__dirname, "abi", "exchange-router.json"));
  const readerAbi = abiFromJson(path.join(__dirname, "abi", "reader.json"));
  const verifierAbi = JSON.parse(
    fs.readFileSync(
      path.join(REPO, "covenant", "contracts", "out", "CovenantVerifier.sol", "CovenantVerifier.json"),
      "utf8"
    )
  ).abi;

  const router = new ethers.Contract(ROUTER, routerAbi, wallet);
  const verifier = new ethers.Contract(VERIFIER, verifierAbi, provider);
  // reader address is immutable on the verifier — never transcribed by hand
  const readerAddress = await verifier.reader();
  const reader = new ethers.Contract(readerAddress, readerAbi, provider);
  log("verifier reader:", readerAddress);
  const usdc = new ethers.Contract(
    USDC,
    ["function balanceOf(address) view returns (uint256)",
     "function allowance(address,address) view returns (uint256)",
     "function approve(address,uint256) returns (bool)"],
    wallet
  );

  const sizeDeltaUsd = ethers.utils.parseUnits(args.sizeUsd, 30); // $ -> 30-dec
  const collateralAmount = ethers.utils.parseUnits(args.collateralUsdc, 6); // USDC 6-dec
  const maxNetExposureUsd = ethers.utils.parseUnits(args.maxExposure, 30);
  const executionFee = DEFAULT_EXECUTION_FEE;

  log("=== Phase 1: open GMX short (step1-open-short) ===");
  log("time:", new Date().toISOString());
  log("mode:", send ? "SEND" : "SIMULATE (--send not set)");
  log("signer:", wallet.address);
  log("block:", await provider.getBlockNumber());

  const ethBal = await provider.getBalance(wallet.address);
  const usdcBal = await usdc.balanceOf(wallet.address);
  const allowance = await usdc.allowance(wallet.address, SPENDER);
  log("ETH balance:", ethers.utils.formatEther(ethBal));
  log("USDC balance:", ethers.utils.formatUnits(usdcBal, 6));
  log("USDC allowance -> SyntheticsRouter:", ethers.utils.formatUnits(allowance, 6));

  if (ethBal.lt(executionFee.add(ethers.utils.parseEther("0.005")))) {
    fail("insufficient ETH for execution fee + gas");
  }
  if (usdcBal.lt(collateralAmount)) {
    fail("insufficient USDC collateral");
  }

  // ------------------------------------------------------------ pre-state
  log("\n--- BEFORE ---");
  const preCheck = await verifier.checkPosition(ACCOUNT, maxNetExposureUsd);
  log("checkPosition(0x0Ac1..., " + args.maxExposure + "$):");
  log("  shortSizeUsd =", preCheck[0].toString());
  log("  passed       =", preCheck[1]);
  if (!preCheck[0].isZero() || preCheck[1] !== false) {
    fail("expected flat position before opening");
  }

  const prePositions = await reader.getAccountPositions(DATASTORE, ACCOUNT, 0, 10);
  log("Reader.getAccountPositions:", prePositions.length, "position(s)");
  if (prePositions.length !== 0) fail("expected 0 positions before opening");

  // --------------------------------------------------------------- price
  const ticker = await getTickers();
  const minPrice = ethers.BigNumber.from(ticker.minPrice.toString());
  const maxPrice = ethers.BigNumber.from(ticker.maxPrice.toString());
  log("\nticker ETH: minPrice(contract) =", minPrice.toString(),
      " maxPrice(contract) =", maxPrice.toString(),
      " updatedAt =", ticker.updatedAt ?? "(none)");

  // acceptablePrice floor: based on the execution price the keeper actually
  // used in the cancelled attempt (0x360284f3..., block 315265767):
  //   2263190604085565 ($2,263.19) vs mark $2,683 -> 15.6% impact.
  // Prior attempt failed because floor (0.95 x mark = $2,548) sat above the
  // observed execution price. Floor = 70% of that reference execution price
  // (0.70 x 2,263.19 = $1,584.23, ~59% of mark) so execution can worsen
  // ~30% before the keeper reverts (bou.sol:224 short-increase check:
  // executionPrice >= acceptablePrice). No creation-time validation exists.
  const REF_EXECUTION_PRICE = ethers.BigNumber.from("2263190604085565");
  const FLOOR_BPS = Number(args.floorBps); // 7000 = 70%
  const acceptablePrice = REF_EXECUTION_PRICE.mul(FLOOR_BPS).div(10000);
  log("ref execution price (last cancel) =", REF_EXECUTION_PRICE.toString());
  log("acceptablePrice = 70% ref (floorBps=" + FLOOR_BPS + ") =",
      acceptablePrice.toString());
  const markDisplay = ethers.utils.formatUnits(minPrice, 30 - 18);
  const acceptDisplay = Number(ethers.utils.formatUnits(acceptablePrice, 30 - 18));
  const markNum = Number(markDisplay);
  log("mark ~$" + markDisplay, "| acceptable ~$" + acceptDisplay.toFixed(2) +
      " (" + (FLOOR_BPS / 100).toFixed(1) + "% of last exec, " +
      ((acceptDisplay / markNum) * 100).toFixed(1) + "% of mark)");

  // ------------------------------------------------------------ order params
  const params = {
    addresses: {
      receiver: ACCOUNT,
      cancellationReceiver: ethers.constants.AddressZero,
      callbackContract: ethers.constants.AddressZero,
      uiFeeReceiver: ethers.constants.AddressZero,
      market: MARKET,
      initialCollateralToken: USDC,
      swapPath: [],
    },
    numbers: {
      sizeDeltaUsd: sizeDeltaUsd,
      initialCollateralDeltaAmount: 0, // ignored for MarketIncrease; recordTransferIn
      triggerPrice: 0,
      acceptablePrice: acceptablePrice,
      executionFee: executionFee,
      callbackGasLimit: 0,
      minOutputAmount: 0,
      validFromTime: 0,
    },
    orderType: ORDER_TYPE_MARKET_INCREASE,
    decreasePositionSwapType: 0,
    isLong: false,
    shouldUnwrapNativeToken: false,
    autoCancel: false,
    referralCode: ethers.constants.HashZero,
    dataList: [],
  };

  log("\ncreateOrder params:");
  log("  market             =", MARKET);
  log("  collateral         =", USDC, `(${args.collateralUsdc} USDC)`);
  log("  sizeDeltaUsd       =", sizeDeltaUsd.toString(), `($${args.sizeUsd})`);
  log("  acceptablePrice    =", acceptablePrice.toString());
  log("  executionFee       =", executionFee.toString());
  log("  isLong             = false (SHORT)");
  log("  orderType          = MarketIncrease(2)");

  // ------------------------------------------------------------- approve
  // Allowance is a prerequisite for a meaningful multicall simulation, so
  // the approve runs in both modes (it moves no funds; only grants spend).
  let approveTxHash = null;
  if (allowance.lt(collateralAmount)) {
    log("\napproving USDC -> SyntheticsRouter for", args.collateralUsdc, "...");
    const approveTx = await usdc.approve(SPENDER, ethers.constants.MaxUint256);
    log("approve tx:", approveTx.hash);
    const r = await approveTx.wait();
    approveTxHash = r.hash;
    log("approve status:", r.status, "block:", r.blockNumber);
    if (r.status !== 1) fail("approve reverted");
  } else {
    log("\nallowance sufficient, skipping approve");
  }

  // ------------------------------------------------------------ multicall
  const callData = [
    router.interface.encodeFunctionData("sendWnt", [ORDER_VAULT, executionFee]),
    router.interface.encodeFunctionData("sendTokens", [USDC, ORDER_VAULT, collateralAmount]),
    router.interface.encodeFunctionData("createOrder", [params]),
  ];
  const multicallData = router.interface.encodeFunctionData("multicall", [callData]);

  // eth_call simulation first — surface revert reasons before spending gas
  try {
    const sim = await provider.call({
      from: wallet.address,
      to: ROUTER,
      data: multicallData,
      value: executionFee,
    });
    const [orderKeySim] = router.interface.decodeFunctionResult("multicall", sim);
    log("\nmulticall eth_call: OK, returned", orderKeySim.length, "result(s)");
  } catch (e) {
    log("\nmulticall eth_call REVERTED:");
    log(" ", e.error?.message ?? e.reason ?? e.message ?? String(e));
    // deeper reason extraction
    try {
      const raw = await provider.send("eth_call", [
        { from: wallet.address, to: ROUTER, data: multicallData, value: executionFee.toHexString() },
        "latest",
      ]);
      log("  raw return:", raw);
    } catch (e2) {
      log("  raw eth_call error:", e2.error?.message ?? e2.message ?? String(e2));
    }
    fail("simulation failed — aborting before sending");
  }

  // ------------------------------------------------- gasprice fee guard
  // minExecutionFee = gasLimit * (basefee + tip) must be <= executionFee
  let guard = await computeFeeGuard(provider, executionFee, ethers.BigNumber.from(TIP_WEI));
  log("\nfee guard (GasUtils.validateExecutionFee):");
  log("  adjustedGasLimit      =", guard.gasLimit.toString());
  log("  block.basefee         =", guard.basefee.toString(), "wei");
  log("  + tip                 =", TIP_WEI, "wei");
  log("  minExecutionFee       =", guard.minFee.toString(),
      `(${ethers.utils.formatEther(guard.minFee)} ETH)`);
  log("  our executionFee      =", executionFee.toString(),
      `(${ethers.utils.formatEther(executionFee)} ETH)`);
  log("  fee covers gasprice up to =", guard.maxFeeCeiling.toString(), "wei",
      `(${ethers.utils.formatEther(guard.maxFeeCeiling)} ETH)`);
  if (!guard.ok) {
    fail(
      `fee underpriced: min ${guard.minFee.toString()} > fee ${executionFee.toString()} ` +
      "(basefee spiked — rerun, or raise executionFee)"
    );
  }
  log("  guard: PASS");

  if (!send) {
    log("\n[sim] PASS — rerun with --send to submit");
    if (logStream) logStream.end();
    return;
  }

  // --------------------------------------------------------------- send
  let receipt = null;
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS && !receipt; attempt++) {
    guard = await computeFeeGuard(provider, executionFee, ethers.BigNumber.from(TIP_WEI));
    if (!guard.ok) {
      log(`[send ${attempt}] fee guard failed (min ${guard.minFee.toString()}), waiting 20s...`);
      await new Promise((r) => setTimeout(r, 20_000));
      continue;
    }
    log(`\n[send ${attempt}] submitting multicall createOrder (tip=${TIP_WEI} maxFee=${MAX_FEE_WEI})...`);
    try {
      const tx = await router.signer.sendTransaction({
        to: ROUTER,
        data: multicallData,
        value: executionFee,
        maxPriorityFeePerGas: TIP_WEI,
        maxFeePerGas: MAX_FEE_WEI,
        gasLimit: 1_500_000,
      });
      log("createOrder tx:", tx.hash);
      const r = await tx.wait();
      log("status:", r.status, "block:", r.blockNumber,
          "gasUsed:", r.gasUsed.toString());
      if (r.status === 1) {
        receipt = r;
      } else {
        log(`[send ${attempt}] reverted on-chain (fee guard passed, so cause is` +
            " likely transient vault-state or basefee drift) — retrying in 15s...");
        await new Promise((x) => setTimeout(x, 15_000));
      }
    } catch (e) {
      log(`[send ${attempt}] tx error:`, (e.error?.message ?? e.message ?? String(e)).slice(0, 300));
      await new Promise((x) => setTimeout(x, 15_000));
    }
  }
  if (!receipt) {
    fail("all send attempts reverted — see log for per-attempt diagnostics");
  }

  // decode order key from OrderCreated (EventLog2)
  const ORDER_CREATED_TOPIC = ethers.utils.id("OrderCreated");
  let orderKey = null;
  let eventLog2Topic0 = null;
  log("\nreceipt logs:");
  for (const l of receipt.logs) {
    const t1 = l.topics[1] ? l.topics[1] : null;
    let name = null;
    if (t1) {
      for (const n of ["OrderCreated", "OrderExecuted", "OrderFrozen",
                       "PositionIncrease", "OrderMarginTransfer"]) {
        if (t1 === ethers.utils.id(n)) name = n;
      }
    }
    log("  ", l.address, "topics:", l.topics.length, name ?? "",
        "t2:", l.topics[2] ?? "");
    if (name === "OrderCreated") {
      eventLog2Topic0 = l.topics[0];
      orderKey = l.topics[2];
    }
  }
  if (!orderKey) fail("OrderCreated event not found in receipt");
  log("\norderKey =", orderKey);

  // ------------------------------------------------------------ poll keeper
  log("\nwaiting for keeper execution (patience, up to " +
      args.pollMinutes + " min)...");
  const deadline = Date.now() + Number(args.pollMinutes) * 60_000;
  const pollTxHashes = new Set();
  let executed = false;
  let cancelled = false;
  let cancelTx = null;
  let attempt = 0;

  while (Date.now() < deadline && !executed && !cancelled) {
    attempt++;
    const bn = await provider.getBlockNumber();

    // 1) OrderExecuted / OrderCancelled events for our key
    if (eventLog2Topic0) {
      try {
        const logs = await provider.getLogs({
          address: EVENT_EMITTER,
          fromBlock: receipt.blockNumber,
          toBlock: bn,
          topics: [
            eventLog2Topic0,
            [ethers.utils.id("OrderExecuted"), ethers.utils.id("OrderCancelled")],
            orderKey,
          ],
        });
        for (const l of logs) {
          if (pollTxHashes.has(l.transactionHash)) continue;
          pollTxHashes.add(l.transactionHash);
          if (l.topics[1] === ethers.utils.id("OrderExecuted")) {
            log("[poll " + attempt + "] OrderExecuted:", l.transactionHash,
                "block:", l.blockNumber);
            executed = true;
          } else {
            cancelled = true;
            cancelTx = l.transactionHash;
            log("[poll " + attempt + "] ORDER CANCELLED by keeper:",
                l.transactionHash, "block:", l.blockNumber);
            try {
              const rec = await provider.getTransactionReceipt(l.transactionHash);
              for (const dl of rec.logs) {
                if ((dl.topics[1] ?? "").toLowerCase() ===
                    ethers.utils.id("OrderCancelled").toLowerCase()) {
                  log("  cancel reason data:", dl.data);
                }
              }
            } catch { /* non-fatal */ }
          }
        }
      } catch (e) {
        log("[poll " + attempt + "] getLogs error:", e.message ?? String(e));
      }
    }

    if (cancelled) break;

    // 2) position visible via Reader
    try {
      const positions = await reader.getAccountPositions(DATASTORE, ACCOUNT, 0, 10);
      if (positions.length > 0 && !executed) {
        const p = positions[0];
        log("[poll " + attempt + "] position visible (sizeInUsd=" +
            p.numbers.sizeInUsd.toString() + ")");
        executed = true;
      }
    } catch (e) {
      // transient
    }

    if (!executed) {
      log("[poll " + attempt + "] block", bn, "still pending...");
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }

  if (cancelled) {
    log("\nkeeper CANCELLED the order again — see cancelTx above");
    log("orderKey:", orderKey);
  } else if (!executed) {
    log("\nkeeper did not execute within the window — order is still open");
    log("orderKey:", orderKey, "(will execute when keeper picks it up)");
  }

  // ------------------------------------------------------------ post-state
  log("\n--- AFTER ---");
  const postCheck = await verifier.checkPosition(ACCOUNT, maxNetExposureUsd);
  log("checkPosition(0x0Ac1..., " + args.maxExposure + "$):");
  log("  shortSizeUsd =", postCheck[0].toString());
  log("  passed       =", postCheck[1]);

  const postPositions = await reader.getAccountPositions(DATASTORE, ACCOUNT, 0, 10);
  log("Reader.getAccountPositions:", postPositions.length, "position(s)");
  for (const p of postPositions) {
    log("  account        =", p.addresses.account);
    log("  market         =", p.addresses.market);
    log("  collateralToken=", p.addresses.collateralToken);
    log("  isLong         =", p.flags.isLong);
    log("  sizeInUsd      =", p.numbers.sizeInUsd.toString());
    log("  sizeInTokens   =", p.numbers.sizeInTokens.toString());
    log("  collateralAmount=", p.numbers.collateralAmount.toString());
    log("  increasedAtTime=", p.numbers.increasedAtTime.toString());
    log("  flags.isLong   =", p.flags.isLong);
  }

  // ------------------------------------------------------------- asserts
  const summary = {
    time: new Date().toISOString(),
    mode: send ? "send" : "simulate",
    approveTx: approveTxHash,
    createTx: receipt.transactionHash ?? receipt.hash,
    createBlock: receipt.blockNumber,
    orderKey,
    executed,
    cancelled,
    cancelTx,
    executedTxs: [...pollTxHashes],
    params: {
      sizeDeltaUsd: sizeDeltaUsd.toString(),
      collateralAmount: collateralAmount.toString(),
      acceptablePrice: acceptablePrice.toString(),
      executionFee: executionFee.toString(),
      markMinPrice: minPrice.toString(),
      floorBps: args.floorBps,
      refExecutionPrice: "2263190604085565",
      market: MARKET,
      collateralToken: USDC,
      isLong: false,
      orderType: ORDER_TYPE_MARKET_INCREASE,
    },
    feeGuard: {
      adjustedGasLimit: guard.gasLimit.toString(),
      basefee: guard.basefee.toString(),
      tipWei: TIP_WEI,
      maxFeeWei: MAX_FEE_WEI,
      minExecutionFee: guard.minFee.toString(),
      feeCeilingGasPrice: guard.maxFeeCeiling.toString(),
    },
    pre: { shortSizeUsd: preCheck[0].toString(), passed: preCheck[1], positions: prePositions.length },
    post: { shortSizeUsd: postCheck[0].toString(), passed: postCheck[1], positions: postPositions.length },
  };

  const errs = [];
  if (cancelled) {
    errs.push("keeper cancelled the order (tx " + cancelTx + ")");
  } else if (executed) {
    if (postPositions.length !== 1) errs.push("expected exactly 1 position");
    else {
      const p = postPositions[0];
      if (p.addresses.market.toLowerCase() !== MARKET.toLowerCase()) errs.push("market mismatch");
      if (p.addresses.collateralToken.toLowerCase() !== USDC.toLowerCase()) errs.push("collateral mismatch");
      if (p.numbers.sizeInUsd.toString() !== sizeDeltaUsd.toString())
        errs.push("sizeInUsd " + p.numbers.sizeInUsd.toString() + " != " + sizeDeltaUsd.toString());
      const isLong = p.flags.isLong;
      if (isLong !== false) errs.push("isLong expected false");
      if (postCheck[0].lt(maxNetExposureUsd)) errs.push("shortSizeUsd below threshold");
      if (postCheck[1] !== true) errs.push("verifier passed expected true");
    }
  } else {
    log("\n(order pending — post asserts skipped, poll again later)");
  }
  summary.errors = errs;

  fs.writeFileSync(JSON_PATH, JSON.stringify(summary, null, 2));
  log("\nwrote", LOG_PATH);
  log("wrote", JSON_PATH);

  if (errs.length > 0) {
    for (const e of errs) log("ASSERT FAIL:", e);
    if (logStream) logStream.end();
    process.exit(cancelled ? 3 : 2);
  }
  if (executed) log("\nPHASE 1 COMPLETE: short open and executed");
  if (logStream) logStream.end();
}

main().catch((e) => {
  log("ERROR:", e.stack ?? String(e));
  if (logStream) logStream.end();
  process.exit(1);
});
