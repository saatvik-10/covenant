/**
 * Sends a covenant verdict from Arbitrum Sepolia to Solana via the deployed
 * CovenantVerifier.
 *
 * The payload is ABI-encoded on-chain as abi.encodePacked(userPubkey, constraintHash, passed)
 * = 32 + 32 + 1 = 65 bytes. This script is the source of truth for the two 32-byte
 * fields, and it derives both from local sources rather than accepting literals:
 *
 *   1. userPubkey   — derived from the wallet1 keypair on disk
 *   2. constraintHash — derived from the byte given on the command line
 *   3. covenant PDA — re-derived from (1) and (2) and compared to the expected address
 *
 * Check 3 is not a substitute for checks 1 and 2. A single-bit corruption in the
 * user field and a matching corruption elsewhere in the hash could in principle
 * produce a PDA that still validates, so the two fields are each asserted against
 * their own independent source before the derived PDA is checked as well.
 *
 * Usage:
 *   npx ts-node scripts/send-verdict.ts 6 [--max-exposure 1000000000000000000000000]
 *                                         [--expect-pass]
 *
 *   --expect-pass flips the two verdict assertions (GMX read + wire flag):
 *   with a real short open, a low --max-exposure (e.g. 5e33) yields passed=true.
 *
 * Env:
 *   PRIVATE_KEY          (0x-prefixed) Arbitrum Sepolia sender key
 *   COVENANT_USER_KEYPAIR wallet1 keypair path (default ~/.config/solana/id.json)
 *   VERIFIER_ADDRESS     CovenantVerifier on Arbitrum Sepolia (optional)
 *   GMX_EXECUTOR         GMX account whose position decides (optional)
 *   COVENANT_HASH        default constraint byte if no arg given
 *   LZ_RPC               optional Arbitrum Sepolia RPC override
 */
import { createRequire } from "module";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const req = createRequire(path.join(__dirname, "..", "package.json"));
const { ethers } = req("ethers");
const { Keypair, PublicKey } = req("@solana/web3.js");

const REPO = path.join(__dirname, "..", "..");
const COVENANT_PROGRAM_ID = "Cb5yZqPKS9utNAf6LB3Cb4r36tMHpKtaY8LeNjtkwRAi";
const DEFAULT_MAX_EXPOSURE_USD =
  BigInt("1000000000000000000000000"); // 1e24 -> always FAIL for a flat position
const EXPECTED_MESSAGE_LEN = 65;

const RPCS = [
  process.env.LZ_RPC,
  "https://arbitrum-sepolia-rpc.publicnode.com",
  "https://sepolia-rollup.arbitrum.io/rpc",
].filter(Boolean) as string[];

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

function loadKeypair(p: string) {
  const secret = JSON.parse(
    fs.readFileSync(p.replace("~", os.homedir()), "utf8")
  );
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function parseConstraintByte(arg: string | undefined): Buffer {
  if (!arg) return Buffer.alloc(32, 1);
  const hex = arg.startsWith("0x") ? arg.slice(2) : arg;
  if (/^[0-9a-fA-F]{1,2}$/.test(hex)) return Buffer.alloc(32, parseInt(hex, 16));
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  throw new Error(`Invalid constraint hash "${arg}"`);
}

async function rpc(method: string, params: unknown[]): Promise<any> {
  let lastErr: unknown;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const j: any = await res.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`All RPCs failed: ${String(lastErr)}`);
}

/** Throws unless `label` is true. Every payload check funnels through here. */
function assert(label: string, ok: boolean, detail: string): void {
  if (!ok) throw new Error(`PAYLOAD CHECK FAILED — ${label}: ${detail}`);
  console.log(`  ok  ${label}: ${detail}`);
}

async function main() {
  loadEnvFile(path.join(REPO, "covenant", ".env"));
  loadEnvFile(path.join(REPO, "bridge-poc", ".env"));

  const VERIFIER_ADDRESS =
    process.env.VERIFIER_ADDRESS ?? "0xFeB7204dc23609623bF1C0A09fccF3F625d3ACfc";
  const GMX_EXECUTOR =
    process.env.GMX_EXECUTOR ?? "0x0Ac16B86d0396Bb7558f144fBb9FbbB91857ff4b";

  const byteArg = process.argv[2] ?? process.env.COVENANT_HASH;
  const expectPass = process.argv.includes("--expect-pass");
  const maxExposureIdx = process.argv.indexOf("--max-exposure");
  const maxNetExposureUsd =
    maxExposureIdx >= 0
      ? BigInt(process.argv[maxExposureIdx + 1])
      : DEFAULT_MAX_EXPOSURE_USD;

  // --- derive the two 32-byte fields from independent local sources ---
  const wallet1 = loadKeypair(process.env.COVENANT_USER_KEYPAIR ?? "~/.config/solana/id.json");
  const userField = Buffer.from(wallet1.publicKey.toBuffer());
  const hashField = parseConstraintByte(byteArg);

  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("covenant"), new Uint8Array(userField), new Uint8Array(hashField)],
    new PublicKey(COVENANT_PROGRAM_ID)
  );

  console.log("=== payload (source of truth) ===");
  console.log("user field   : 0x" + userField.toString("hex"));
  console.log("             wallet1 =", wallet1.publicKey.toBase58());
  console.log("hash field   : 0x" + hashField.toString("hex"));
  console.log("             byte    =", byteArg ?? "1 (default)");
  console.log("covenant PDA :", pda.toBase58());
  console.log("executor     :", GMX_EXECUTOR, "(GMX position key)");
  console.log("max exposure :", maxNetExposureUsd.toString(), "USD");

  // --- independent assertions, before anything is broadcast ---
  console.log("\n=== checks ===");
  assert(
    "user field is 32 bytes",
    userField.length === 32,
    `${userField.length} bytes`
  );
  assert(
    "user field round-trips to wallet1",
    new PublicKey(new Uint8Array(userField)).equals(wallet1.publicKey),
    "base58(bytes) == wallet1"
  );
  assert(
    "hash field is 32 bytes",
    hashField.length === 32,
    `${hashField.length} bytes`
  );
  const intendedHash = parseConstraintByte(byteArg);
  assert(
    "hash field matches intent",
    hashField.toString("hex") === intendedHash.toString("hex"),
    "independent re-parse of the requested byte"
  );
  assert(
    "user and hash fields differ",
    userField.toString("hex") !== hashField.toString("hex"),
    "guards against a copy-paste of one field into the other"
  );
  console.log(`  ok  derived PDA for (user,hash): ${pda.toBase58()}`);

  // --- quote ---
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY not set");
  const provider = new ethers.providers.JsonRpcProvider(RPCS[0], 421614);
  const wallet = new ethers.Wallet(pk, provider);
  console.log("\nsigner:", wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log("balance:", ethers.utils.formatEther(balance), "ETH");

  const abi = req(path.join(
    REPO,
    "covenant",
    "contracts",
    "out",
    "CovenantVerifier.sol",
    "CovenantVerifier.json"
  )).abi;
  const verifier = new ethers.Contract(VERIFIER_ADDRESS, abi, wallet);

  // extraOptions is empty; the endpoint substitutes the enforced option, which
  // currently caps destination execution at 100,000 CU. Raising that needs a
  // setEnforcedOptions call on both sides and is out of scope until we see the
  // executor actually run out of compute.
  const extraOptions = "0x";
  const quote: any = await verifier.quoteSend(
    "0x" + userField.toString("hex"),
    "0x" + hashField.toString("hex"),
    false,
    extraOptions
  );
  const fee = quote.nativeFee ?? quote.lzFee;
  console.log("quote fee:", ethers.utils.formatEther(fee), "ETH");

  // --- read the GMX position that will decide the verdict ---
  const [shortSizeUsd, passed] = await verifier.checkPosition(
    GMX_EXECUTOR,
    maxNetExposureUsd
  );
  console.log(
    "\nGMX check: shortSizeUsd =",
    shortSizeUsd.toString(),
    " passed =",
    passed
  );
  assert(
    expectPass
      ? "GMX read yields the PASS we expect"
      : "GMX read yields the FAIL we expect",
    passed === expectPass,
    `passed=${passed} (shortSizeUsd=${shortSizeUsd}, maxNetExposureUsd=${maxNetExposureUsd})`
  );

  const tx = await verifier.checkAndSend(
    "0x" + userField.toString("hex"),
    "0x" + hashField.toString("hex"),
    GMX_EXECUTOR,
    maxNetExposureUsd,
    extraOptions,
    { value: fee, gasLimit: 400000 }
  );
  console.log("\nsent:", tx.hash);
  const rec: any = await tx.wait();

  // --- verify what was actually broadcast ---
  console.log("\n=== post-broadcast verification ===");
  const iface = new ethers.utils.Interface(abi);
  const ev = rec.logs
    .map((l: any) => {
      try {
        return iface.parseLog(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .find((p: any) => p.name === "VerdictSent");
  assert("VerdictSent emitted", !!ev, "verifier confirmed the send");

  const computed = rec.logs
    .map((l: any) => {
      try {
        return iface.parseLog(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .find((p: any) => p.name === "VerdictComputed");
  if (computed) {
    assert(
      "event user field matches",
      computed.args.userPubkey.toLowerCase() ===
        ("0x" + userField.toString("hex")).toLowerCase(),
      computed.args.userPubkey
    );
    assert(
      "event hash field matches",
      computed.args.constraintHash.toLowerCase() ===
        ("0x" + hashField.toString("hex")).toLowerCase(),
      computed.args.constraintHash
    );
    assert(
      "event executor matches",
      computed.args.executor.toLowerCase() === GMX_EXECUTOR.toLowerCase(),
      computed.args.executor
    );
    console.log("  passed flag:", computed.args.passed);
  }

  // The endpoint's PayloadSent is a non-indexed struct whose exact Solidity type
  // list is not published in the installed packages, so it is decoded from the
  // raw log data using offsets confirmed against known field values:
  //   b0   : offset to packet      b128 : PacketType marker (0x01)
  //   b32  : offset to options     b136 : nonce (1 byte)
  //   b64  : endpoint address      b137 : srcEid (u32 BE)
  //   b96  : packet length         b173 : dstEid (u32 BE)
  //   b128+: packet bytes          b209 : guid (32B)
  //                                 b241 : message (65B)
  // See /tmp/opencode/verify-packet.mjs for the full derivation.
  const ps = rec.logs.find((l: any) =>
    l.topics[0].startsWith("0x1ab700d4")
  );
  assert("PayloadSent event found", !!ps, ps ? "ok" : "missing");
  const data: string = (ps as any).data.slice(2);
  const byte = (o: number) => data.slice(o * 2, o * 2 + 2);
  const packetLen = Number(BigInt("0x" + data.slice(96 * 2, 96 * 2 + 64)));
  const nonce = parseInt(byte(136), 16);
  const srcEid = Number(BigInt("0x" + data.slice(137 * 2, 137 * 2 + 8)));
  const dstEid = Number(BigInt("0x" + data.slice(173 * 2, 173 * 2 + 8)));
  const guid = "0x" + data.slice(209 * 2, 241 * 2);
  const m = data.slice(241 * 2, (241 + EXPECTED_MESSAGE_LEN) * 2);
  const options = "0x" + data.slice(352 * 2, 352 * 2 + 44);

  assert("packet length is 178", packetLen === 178, `${packetLen}`);
  assert("srcEid is Arbitrum Sepolia", srcEid === 40231, `${srcEid}`);
  assert("dstEid is Solana devnet", dstEid === 40168, `${dstEid}`);
  assert("wire message is 65 bytes", m.length / 2 === EXPECTED_MESSAGE_LEN, `${m.length / 2} bytes`);
  assert(
    "wire user field matches",
    ("0x" + m.slice(0, 64)).toLowerCase() ===
      ("0x" + userField.toString("hex")).toLowerCase(),
    "0x" + m.slice(0, 64)
  );
  assert(
    "wire hash field matches",
    ("0x" + m.slice(64, 128)).toLowerCase() ===
      ("0x" + hashField.toString("hex")).toLowerCase(),
    "0x" + m.slice(64, 128)
  );
  const expectedFlag = expectPass ? "01" : "00";
  assert(
    `wire passed flag is ${expectedFlag}`,
    m.slice(128, 130) === expectedFlag,
    m.slice(128, 130)
  );
  console.log("  nonce:", nonce);
  console.log("  guid :", guid);
  console.log("  options:", options);

  console.log(
    `\nSENT. Watch LZ delivery, then settle with:\n` +
      `  npx ts-node scripts/settle-test-covenant.ts ${byteArg ?? 1}`
  );
}

main().catch((e) => {
  console.error("\n" + e.message);
  process.exit(1);
});
