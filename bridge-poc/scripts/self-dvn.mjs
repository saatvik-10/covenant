#!/usr/bin/env node
// Self-DVN workaround for the 0x06 covenant E2E.
//
// WHY: LayerZero's testnet DVN/relayer never delivered our Arbitrum-Sepolia(40231)
//      -> Solana(40168) packet to the Store. Source side was correct and complete
//      (packet dispatched, DVN assigned, fee paid, tx 0x9c60cc9e...). Destination
//      side never saw a single init_verify. This script swaps the Store's required
//      DVN for a key we hold so we can run LayerZero's REAL verification path
//      (uln::init_verify -> uln::verify -> endpoint::init_verify ->
//      uln::commit_verification -> endpoint::verify) ourselves.
//
// SCOPE: only writes the Store's ReceiveConfig PDA via endpoint::set_config, plus
//        the normal endpoint/ULN verification PDAs. It does NOT touch the Store
//        layout/seeds, receive_verdict's pinned authority, the covenant program,
//        or CovenantVerifier.sol. No program upgrade.
//
// Usage:  node self-dvn.mjs <step>
//         gen-dvn | set-config | status | derive | init-nonce | dvn-verify | commit | all

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");
const ethers = require("ethers");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RPC = process.env.LZ_SOLANA_RPC || "https://api.devnet.solana.com";
const ENDPOINT = new PublicKey("76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6");
const ULN = new PublicKey("7a4WjyR8VZ7yZz5XJAKm39BUGn5iT9CKcv2pmG9tdXVH");
const SYSTEM = new PublicKey("11111111111111111111111111111111");
const STORE = new PublicKey("Ciq55LhUSLmckazpWRdaTcHHZZNAdQec4Z9aXPc1T3dV");
const OAPP_REGISTRY = new PublicKey("EN1w1hTCh1TRw3hsPpHDHCqNdh8ab8bFiH8MQvqAd4PQ");
const MESSAGE_LIB_INFO = new PublicKey("526PeNZfw8kSnDU4nmzJFVJzJWNhwmZykEyJr5XWz5Fv");
const MESSAGE_LIB = new PublicKey("2XgGZG4oP29U3w5h4nTk1V2LFHL23zKDPJjs3psGzLKQ");
const SEND_CONFIG = new PublicKey("DETbEvtXdEjQXpz5VH49hoz458osQHWVEwMqnP2fCY66");
const RECEIVE_CONFIG = new PublicKey("HSdT1RokgnhVmEtxNViHvSS1zLqoXJcQpwpuQ3s42x3T");
const DEFAULT_SEND_CONFIG = new PublicKey("3y4LwxWFPhMNc4w8P4CfH5WVqwUnAm21PA4Pf7UMoxej");
const DEFAULT_RECEIVE_CONFIG = new PublicKey("BfYtqTpJSw5YztWdjgK8ED8L3dxMqFATApDMLk5YPrCe");
const ULN_EVENT_AUTH = new PublicKey("7n1YeBMVEUCJ4DscKAcpVQd6KXU7VpcEcc15ZuMcL4U3");
const EP_EVENT_AUTH = new PublicKey("F8E8QGhKmHEx2esh5LpVizzcP4cHYhzXdXTwg9w3YYY2");
const RECV_LIB_CFG = new PublicKey("14sWvXsiYZeKtSkEZtR8RCERX1qBEcnTjkbx1nVx7NSA");
const DEF_RECV_LIB_CFG = new PublicKey("HjDEd9BGQnuJFkmhFyWyrcVWwV84cqU8RCST27STjs7H");

const SRC_EID = 40231;
const DST_EID = 40168;
const MSG_NONCE = 3;
const CONFIG_TYPE_RECEIVE_ULN = 3;

const DISC = {
  setConfig: Buffer.from("6c9e9aafd4623442", "hex"),
  initNonce: Buffer.from("ccab10d6b6bf1bc4", "hex"),
  initVerify: Buffer.from("4cf6f47c7311eb5b", "hex"),
  verify: Buffer.from("85a18d3078c65896", "hex"),
  commitVerification: Buffer.from("c2782cfc8cd78b67", "hex"),
};

// ---- the exact packet LayerZero should have relayed (from PacketSent, tx 0x9c60cc9e) ----
const HEADER = Buffer.from(
  "010000000000000003" + // version 1, nonce 3
    "00009d27" + // srcEid 40231
    "000000000000000000000000feb7204dc23609623bf1c0a09fccf3f625d3acfc" + // sender (CovenantVerifier)
    "00009ce8" + // dstEid 40168
    "ae27b8fa8e16632f115ec7254cd39db4e7bd3f3336ffec009bdfd9a95639bcfc", // receiver = Store
  "hex"
);
const PAYLOAD = Buffer.from(
  "b98d677c99215e07d2269c9a4167d4c944894fecc468f9e69f670a859d948654" + // guid
    "4362ae3e61fd6676e9c89fa361bf3162393561947b0f0194acfdcd7c3c858c3f" + // user (wallet1)
    "06".repeat(32) + // covenant id 0x06 x32
    "00", // verdict = FAIL
  "hex"
);
if (HEADER.length !== 81) throw new Error("header len " + HEADER.length);
if (PAYLOAD.length !== 97) throw new Error("payload len " + PAYLOAD.length);

const PAYLOAD_HASH = Buffer.from(ethers.utils.keccak256(PAYLOAD).slice(2), "hex");
const SENDER32 = HEADER.subarray(13, 45);

// The two earlier packets this OApp sent to the Store. LayerZero's DVN never
// verified them either, so Nonce.inbound_nonce is still 0 and endpoint::clear
// rejects nonce 3 (constraint: params.nonce <= nonce.inbound_nonce). They must
// be verified first, in order, or the channel can never advance. Recovered
// verbatim from the PayloadSent logs of the original Arbitrum transactions.
const BACKFILL = {
  1: {
    tx: "0x4be165a082aa4dacefb461642ab2c80deb067d2532459c141aa17302ed8f70ce",
    header:
      "01000000000000000100009d27000000000000000000000000feb7204dc23609623bf1c0a09fccf3f625d3acfc00009ce8ae27b8fa8e16632f115ec7254cd39db4e7bd3f3336ffec009bdfd9a95639bcfc",
    payload:
      "fb51c08855f79072ccde55c9de5cbe44ecf80c683dabb5be77f6e4eeb23e4fe30000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200",
  },
  2: {
    tx: "0xdd23f2915373603dc60b45c668f560b6286afcabe1aa7b125057edb75db7a000",
    header:
      "01000000000000000200009d27000000000000000000000000feb7204dc23609623bf1c0a09fccf3f625d3acfc00009ce8ae27b8fa8e16632f115ec7254cd39db4e7bd3f3336ffec009bdfd9a95639bcfc",
    payload:
      "8989393e5c353cd1327fdbbb0f71af264b1229fefde9bb32ee72dece8c91dcd50129cef6b9eda0ae0b86caef471a4296aead9f55191e9f5526e4e7ea48a0fbfb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b200",
  },
  // Nonce 4: stray duplicate verdict for the already-Settled covenant 0x06
  // (tx 0x4bd08903...). receive_verdict will reject it (status != Accepted),
  // so it must be VERIFIED (to advance inbound_nonce) but NEVER delivered.
  4: {
    tx: "0x4bd08903ca89c12837eba17b9d5793e0febef0293c771bff3a32331026d11129",
    header:
      "010000000000000004" + // version 1, nonce 4
        "00009d27" +
        "000000000000000000000000feb7204dc23609623bf1c0a09fccf3f625d3acfc" +
        "00009ce8" +
        "ae27b8fa8e16632f115ec7254cd39db4e7bd3f3336ffec009bdfd9a95639bcfc",
    payload:
      "d2a43373f44e07158dd17f260a7572f373230bec9764b250d766a86ebcf5a332" + // guid
        "4362ae3e61fd6676e9c89fa361bf3162393561947b0f0194acfdcd7c3c858c3f" + // user (wallet1)
        "06".repeat(32) + // covenant id 0x06
        "00", // verdict = FAIL
  },
  // Nonce 5: the demo-fail verdict for covenant byte 8 (tx 0x38ac2978...).
  5: {
    tx: "0x38ac2978588ccc95c29ca47b1ca1f78672b858ad0bceb704c388379ef0b09f67",
    header:
      "010000000000000005" + // version 1, nonce 5
        "00009d27" +
        "000000000000000000000000feb7204dc23609623bf1c0a09fccf3f625d3acfc" +
        "00009ce8" +
        "ae27b8fa8e16632f115ec7254cd39db4e7bd3f3336ffec009bdfd9a95639bcfc",
    payload:
      "f39437764884ee96b54b1cd6f66ecb08ae2c6f44f153b1a0c502be80cd8617f2" + // guid
        "4362ae3e61fd6676e9c89fa361bf3162393561947b0f0194acfdcd7c3c858c3f" + // user (wallet1)
        "08".repeat(32) + // covenant id 0x08
        "00", // verdict = FAIL
  },
  // Nonce 6: the demo-PASS verdict for covenant byte 9 (tx 0xf86975ce...).
  // verdict = 01 -> receive_verdict stores Some(true).
  6: {
    tx: "0xf86975cef4b7109618a283fa4167f04abf0e73f0274398dd880626dae748f0e7",
    header:
      "010000000000000006" + // version 1, nonce 6
        "00009d27" +
        "000000000000000000000000feb7204dc23609623bf1c0a09fccf3f625d3acfc" +
        "00009ce8" +
        "ae27b8fa8e16632f115ec7254cd39db4e7bd3f3336ffec009bdfd9a95639bcfc",
    payload:
      "4156e6f4aac06520bb52aaf1a72d2e57f2a4e8172f0f8b29816bf157678d9efd" + // guid
        "4362ae3e61fd6676e9c89fa361bf3162393561947b0f0194acfdcd7c3c858c3f" + // user (wallet1)
        "09".repeat(32) + // covenant id 0x09
        "01", // verdict = PASS
  },
};

function packetOf(n) {
  if (n === MSG_NONCE)
    return { header: HEADER, payload: PAYLOAD, headerHash: keccak(HEADER), payloadHash: PAYLOAD_HASH };
  const p = BACKFILL[n];
  if (!p) throw new Error("no packet for nonce " + n);
  const header = Buffer.from(p.header, "hex");
  const payload = Buffer.from(p.payload, "hex");
  if (header.length !== 81 || payload.length !== 97)
    throw new Error(`nonce ${n}: header ${header.length} payload ${payload.length}`);
  return { header, payload, headerHash: keccak(header), payloadHash: keccak(payload) };
}
function keccak(b) {
  return Buffer.from(ethers.utils.keccak256(b).slice(2), "hex");
}

const DVN_KEY_PATH = path.join(__dirname, ".dvn.json");
const WALLET1_PATH = path.join(process.env.HOME, ".config/solana/id.json");

function loadKeypair(p) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}
function connection() {
  return new Connection(RPC, "confirmed");
}
function u32le(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}
function u64le(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}
function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}
function u64be(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}

// ---- PDA derivation ----
function pdas(n = MSG_NONCE) {
  const info = packetOf(n);
  const nonce = PublicKey.findProgramAddressSync(
    [Buffer.from("Nonce"), STORE.toBuffer(), u32be(SRC_EID), SENDER32],
    ENDPOINT
  )[0];
  const pending = PublicKey.findProgramAddressSync(
    [Buffer.from("PendingNonce"), STORE.toBuffer(), u32be(SRC_EID), SENDER32],
    ENDPOINT
  )[0];
  const payloadHash = PublicKey.findProgramAddressSync(
    [
      Buffer.from("PayloadHash"),
      STORE.toBuffer(),
      u32be(SRC_EID),
      SENDER32,
      u64be(n),
    ],
    ENDPOINT
  )[0];
  const dvn = loadKeypair(DVN_KEY_PATH).publicKey;
  const confirmations = PublicKey.findProgramAddressSync(
    [Buffer.from("Confirmations"), info.headerHash, info.payloadHash, dvn.toBuffer()],
    ULN
  )[0];
  return { nonce, pending, payloadHash, confirmations, dvn, info };
}

function ix(programId, keys, data) {
  return new TransactionInstruction({
    programId,
    keys: keys.map((k) =>
      Array.isArray(k) ? { pubkey: k[0], isSigner: k[1], isWritable: k[2] } : k
    ),
    data,
  });
}

async function send(conn, tx, signers, label) {
  tx.feePayer = signers[0].publicKey;
  const { blockhash } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  const sim = await conn.simulateTransaction(tx, signers);
  if (sim.value.err) {
    console.log(label, "SIMULATION FAILED:", JSON.stringify(sim.value.err));
    (sim.value.logs || []).forEach((l) => console.log("  ", l));
    return null;
  }
  const sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
  console.log(label, "ok:", sig);
  return sig;
}

function cuLimit(units) {
  return ComputeBudgetProgram.setComputeUnitLimit({ units });
}

// ---- steps ---------------------------------------------------------------

async function genDvn() {
  if (fs.existsSync(DVN_KEY_PATH)) {
    console.log("DVN key:", loadKeypair(DVN_KEY_PATH).publicKey.toBase58());
    return;
  }
  const kp = Keypair.generate();
  fs.writeFileSync(DVN_KEY_PATH, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  console.log("Generated controlled DVN keypair:", kp.publicKey.toBase58());
}

async function setConfig() {
  const wallet1 = loadKeypair(WALLET1_PATH);
  const dvn = loadKeypair(DVN_KEY_PATH);
  const config = Buffer.concat([
    u64le(20),
    Buffer.from([0x01, 0xff, 0x00]),
    u32le(1),
    Buffer.from(dvn.publicKey.toBytes()),
    u32le(0),
  ]);
  const data = Buffer.concat([
    DISC.setConfig,
    Buffer.from(STORE.toBytes()),
    u32le(SRC_EID),
    u32le(CONFIG_TYPE_RECEIVE_ULN),
    u32le(config.length),
    config,
  ]);
  const ixSet = ix(
    ENDPOINT,
    [
      [wallet1.publicKey, true, true],
      [OAPP_REGISTRY, false, false],
      [MESSAGE_LIB_INFO, false, false],
      [MESSAGE_LIB, false, false],
      [ULN, false, false],
      [MESSAGE_LIB, false, false], // uln settings
      [SEND_CONFIG, false, true],
      [RECEIVE_CONFIG, false, true],
      [DEFAULT_SEND_CONFIG, false, false],
      [DEFAULT_RECEIVE_CONFIG, false, false],
      [ULN_EVENT_AUTH, false, false],
      [ULN, false, false],
    ],
    data
  );
  const tx = new Transaction().add(cuLimit(200000), ixSet);
  const conn = connection();
  await send(conn, tx, [wallet1], "set-config");
}

async function status() {
  const conn = connection();
  const rc = await conn.getAccountInfo(RECEIVE_CONFIG);
  const d = Buffer.from(rc.data);
  let o = 20;
  const n = d.readUInt32LE(o);
  o += 4;
  const dvns = [];
  for (let i = 0; i < n; i++) {
    dvns.push(new PublicKey(d.subarray(o, o + 32)).toBase58());
    o += 32;
  }
  console.log(
    "ReceiveConfig:",
    JSON.stringify({
      confirmations: Number(d.readBigUInt64LE(9)),
      reqCnt: d[17],
      optCnt: d[18],
      thr: d[19],
      dvns,
    })
  );
  const p = pdas();
  for (const [name, k] of [
    ["Nonce", p.nonce],
    ["PendingNonce", p.pending],
  ]) {
    const a = await conn.getAccountInfo(k);
    console.log("  " + name.padEnd(15), k.toBase58(), a ? `${a.data.length}B` : "MISSING");
  }
  const na = await conn.getAccountInfo(p.nonce);
  if (na) {
    const d = Buffer.from(na.data);
    console.log(
      `    outbound=${d.readBigUInt64LE(9)} inbound=${d.readBigUInt64LE(17)}`
    );
  }
  const pa = await conn.getAccountInfo(p.pending);
  if (pa) {
    const d = Buffer.from(pa.data);
    const n = d.readUInt32LE(8);
    const list = [];
    for (let i = 0; i < n; i++) list.push(Number(d.readBigUInt64LE(12 + i * 8)));
    console.log(`    pending=[${list.join(", ")}]`);
  }
  for (const n of [1, 2, MSG_NONCE]) {
    const q = pdas(n);
    for (const [name, k] of [
      [`PayloadHash#${n}`, q.payloadHash],
      [`Confirmations#${n}`, q.confirmations],
    ]) {
      const a = await conn.getAccountInfo(k);
      let extra = a ? `${a.data.length}B` : "MISSING";
      if (a && name.startsWith("Confirmations"))
        extra += ` value=${Buffer.from(a.data)[8] === 0 ? "None" : "Some(" + Number(Buffer.from(a.data).readBigUInt64LE(9)) + ")"}`;
      if (a && name.startsWith("PayloadHash"))
        extra += ` hash=${Buffer.from(a.data).subarray(8, 40).toString("hex")}`;
      console.log("  " + name.padEnd(17), k.toBase58(), extra);
    }
  }
}

async function initNonce() {
  const wallet1 = loadKeypair(WALLET1_PATH);
  const { nonce, pending } = pdas();
  const data = Buffer.concat([DISC.initNonce, Buffer.from(STORE.toBytes()), u32le(SRC_EID), SENDER32]);
  const tx = new Transaction().add(
    cuLimit(200000),
    ix(
      ENDPOINT,
      [
        [wallet1.publicKey, true, true],
        [OAPP_REGISTRY, false, false],
        [nonce, false, true],
        [pending, false, true],
        [SYSTEM, false, false],
      ],
      data
    )
  );
  await send(connection(), tx, [wallet1], "init-nonce");
}

async function dvnVerify(n = MSG_NONCE) {
  const wallet1 = loadKeypair(WALLET1_PATH);
  const dvn = loadKeypair(DVN_KEY_PATH);
  const { confirmations, info } = pdas(n);
  const initData = Buffer.concat([DISC.initVerify, info.header, info.payloadHash, dvn.publicKey.toBuffer()]);
  const verifyData = Buffer.concat([DISC.verify, info.header, info.payloadHash, u64le(20)]);
  const tx = new Transaction().add(
    cuLimit(300000),
    ix(
      ULN,
      [
        [wallet1.publicKey, true, true],
        [confirmations, false, true],
        [SYSTEM, false, false],
      ],
      initData
    ),
    ix(
      ULN,
      [
        [dvn.publicKey, true, false],
        [confirmations, false, true],
        [ULN_EVENT_AUTH, false, false],
        [ULN, false, false],
      ],
      verifyData
    )
  );
  await send(connection(), tx, [wallet1, dvn], `dvn-verify#${n}`);
}

async function commit(n = MSG_NONCE) {
  const wallet1 = loadKeypair(WALLET1_PATH);
  const { nonce, pending, payloadHash, confirmations, info } = pdas(n);
  const initParams = Buffer.concat([
    DISC.initVerify,
    u32le(SRC_EID),
    SENDER32,
    Buffer.from(STORE.toBytes()),
    u64le(n),
  ]);
  const commitData = Buffer.concat([DISC.commitVerification, info.header, info.payloadHash]);
  const tx = new Transaction().add(
    cuLimit(400000),
    ix(
      ENDPOINT,
      [
        [wallet1.publicKey, true, true],
        [nonce, false, true],
        [payloadHash, false, true],
        [SYSTEM, false, false],
      ],
      initParams
    ),
    ix(
      ULN,
      [
        [RECEIVE_CONFIG, false, false],
        [DEFAULT_RECEIVE_CONFIG, false, false],
        [MESSAGE_LIB, false, false],
        // remaining: confirmation accounts, then endpoint_verify::verify accounts
        [confirmations, false, false],
        [ENDPOINT, false, false],
        [MESSAGE_LIB, false, false], // receive_library == uln settings
        [RECV_LIB_CFG, false, false],
        [DEF_RECV_LIB_CFG, false, false],
        [nonce, false, true],
        [pending, false, true],
        [payloadHash, false, true],
        [EP_EVENT_AUTH, false, false],
        [ENDPOINT, false, false],
      ],
      commitData
    )
  );
  await send(connection(), tx, [wallet1], `commit-verification#${n}`);
}

const step = process.argv[2];
if (step === "gen-dvn") await genDvn();
else if (step === "set-config") await setConfig();
else if (step === "status") await status();
else if (step === "init-nonce") await initNonce();
else if (step === "dvn-verify") await dvnVerify(Number(process.argv[3]) || MSG_NONCE);
else if (step === "commit") await commit(Number(process.argv[3]) || MSG_NONCE);
else if (step === "backfill") {
  // Verify nonces 1 and 2, in order, so Nonce.inbound_nonce advances 0 -> 3.
  // endpoint::clear rejects a nonce greater than inbound_nonce, so nonce 3
  // cannot be delivered until these two are verified first.
  for (const n of [1, 2]) {
    const q = pdas(n);
    console.log(
      `nonce ${n}: headerHash=${q.info.headerHash.toString("hex")} payloadHash=${q.info.payloadHash.toString("hex")} tx=${BACKFILL[n].tx}`
    );
    await dvnVerify(n);
    await commit(n);
  }
  await status();
} else if (step === "derive") {
  const p = pdas();
  console.log("headerHash ", p.info.headerHash.toString("hex"));
  console.log("payloadHash", p.info.payloadHash.toString("hex"));
  console.log("Nonce      ", p.nonce.toBase58());
  console.log("Pending    ", p.pending.toBase58());
  console.log("PayloadHash", p.payloadHash.toBase58());
  console.log("Confirmat. ", p.confirmations.toBase58());
  console.log("DVN        ", p.dvn.toBase58());
} else if (step === "all") {
  await initNonce();
  await dvnVerify();
  await commit();
} else {
  console.log(
    "usage: node self-dvn.mjs <gen-dvn|set-config|status|derive|init-nonce|dvn-verify|commit|backfill|all>"
  );
  process.exit(1);
}
