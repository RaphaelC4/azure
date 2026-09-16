// sn_v5_sender.mjs — V5-format transaction sender for legacy Studionet (61999).
//
// WHY THIS EXISTS: genlayer-js 2.0.0-rc.1 encodes every user tx with the new
// struct-based `addTransaction((sender,recipient,...,feesDistribution,txCalldata,
// messageAllocations))` ABI (selector 0x35a251fb) and has no fallback. The live
// 61999 consensus main contract (0xb7278A61…E575) only implements the OLD flat
// interface `addTransaction(address,address,uint256,uint256,bytes)` (V5, selector
// 0x27241a99) — verified against another user's successful deploy (tx
// 0xec3af52e…, whose EVM data starts with 0x27241a99). With rc.1's struct
// envelope the node cannot parse the inner genlayer tx: it records an empty
// type-0 tx (data {}) that finalizes straight to NO_MAJORITY with zero votes —
// exactly what every "stuck deploy" we saw was. 61997 (studio devnet) runs the
// NEW consensus, so rc.1 works there; keep using it on 61997.
//
// This module rebuilds the exact V5 envelope genlayer-js 1.x used:
//   txData = RLP([code, calldata, leaderOnly])   (byte-verified vs tx 0xec3af52e…)
//   EVM    = legacy tx to consensusMainContract, data = V5 addTransaction(...)
// For a no-constructor-args deploy the calldata is the empty genlayer map,
// encoded as the single byte 0x06 ("Bg==" in the explorer).
// NOTE: only supports no-args deploys (what azure_contract_studionet.py uses);
// constructor args would need the full genlayer calldata encoder and are
// intentionally not implemented here.
import { encodeFunctionData, zeroAddress, toHex, toRlp } from "viem";

const ADD_TRANSACTION_ABI_V5 = [
  {
    type: "function",
    name: "addTransaction",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_sender", type: "address" },
      { name: "_recipient", type: "address" },
      { name: "_numOfInitialValidators", type: "uint256" },
      { name: "_maxRotations", type: "uint256" },
      { name: "_txData", type: "bytes" },
    ],
    outputs: [],
  },
];

/** Empty genlayer calldata object -> TYPE_MAP with 0 entries -> single byte 0x06. */
const EMPTY_CALLDATA = "0x06";

export async function deployContractV5({ client, account, code, leaderOnly = false }) {
  if (!client.chain.consensusMainContract?.address) {
    throw new Error(`Consensus main contract not configured for chain "${client.chain.name}".`);
  }
  if (typeof code !== "string" || code.length === 0) {
    throw new Error("deployContractV5: code must be a non-empty string");
  }

  // genlayer-js 1.x deploy payload: serialize([code, encode(calldata), leaderOnly]).
  const txData = toRlp([toHex(code), EMPTY_CALLDATA, leaderOnly ? "0x01" : "0x00"]);
  const encodedData = encodeFunctionData({
    abi: ADD_TRANSACTION_ABI_V5,
    functionName: "addTransaction",
    args: [
      account.address,
      zeroAddress, // deploy marker — the node computes the deterministic slot
      BigInt(client.chain.defaultNumberOfInitialValidators),
      BigInt(client.chain.defaultConsensusMaxRotations),
      txData,
    ],
  });

  const to = client.chain.consensusMainContract.address;
  let gas;
  try {
    gas = await client.request({
      method: "eth_estimateGas",
      params: [{ from: account.address, to, data: encodedData, value: "0x0" }],
    });
    gas = BigInt(gas);
  } catch (err) {
    console.warn("[v5] gas estimation failed, using 1,000,000:", err instanceof Error ? err.message : err);
    gas = 1_000_000n;
  }
  const gasPrice = BigInt(await client.request({ method: "eth_gasPrice" }));
  const nonce = await client.getCurrentNonce({ address: account.address });

  const serializedTransaction = await account.signTransaction({
    account,
    to,
    data: encodedData,
    type: "legacy",
    nonce: Number(nonce),
    value: 0n,
    gas,
    gasPrice,
    chainId: client.chain.id,
  });
  const txHash = await client.sendRawTransaction({ serializedTransaction });
  console.log("[v5-deploy] tx sent:", txHash);
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    waitUntil: "finalized",
    retries: 100,
    interval: 5000,
  });
  return { txHash, receipt };
}

// ---------------------------------------------------------------------------
// Writes (V5 call envelope) — genlayer calldata encoder port byte-verified
// against on-chain 61999 txs (0x91018a30… "method"-key, 0xfc6a2b08… ""-key;
// the 61999 GenVM accepts both — we emit the rc.1-canonical ""-key layout).
// ---------------------------------------------------------------------------

const BITS = 3;
const TYPE_PINT = 1, TYPE_STR = 4, TYPE_ARR = 5, TYPE_MAP = 6;

function writeNum(to, data) {
  if (data === 0n) { to.push(0); return; }
  while (data > 0) {
    let cur = Number(data & 0x7fn);
    data >>= 7n;
    if (data > 0) cur |= 128;
    to.push(cur);
  }
}
function numWithType(to, data, type) { writeNum(to, (data << BigInt(BITS)) | BigInt(type)); }
function cmpStr(l, r) {
  for (let i = 0; i < l.length && i < r.length; i++) { const c = l[i] - r[i]; if (c !== 0) return c; }
  return l.length - r.length;
}
function encodeImpl(to, data) {
  if (data === null || data === undefined) { to.push(0); return; }
  if (data === true) { to.push(2); return; }
  if (data === false) { to.push(1); return; }
  switch (typeof data) {
    case "bigint":
    case "number": {
      const v = BigInt(data);
      numWithType(to, v >= 0n ? v : -v - 1n, v >= 0n ? TYPE_PINT : 2);
      return;
    }
    case "string": {
      const s = new TextEncoder().encode(data);
      numWithType(to, BigInt(s.length), TYPE_STR);
      for (const c of s) to.push(c);
      return;
    }
    case "object": {
      if (Array.isArray(data)) {
        numWithType(to, BigInt(data.length), TYPE_ARR);
        for (const c of data) encodeImpl(to, c);
        return;
      }
      // codepoint arrays (NOT chars) — the decoder enforces strictly
      // increasing keys, and cmpStr subtracts numerically.
      const entries = Object.entries(data).map(([k, v]) => [
        Array.from(k, (c) => c.codePointAt(0)),
        k,
        v,
      ]);
      entries.sort((a, b) => cmpStr(a[0], b[0]));
      numWithType(to, BigInt(entries.length), TYPE_MAP);
      for (const [, k, v] of entries) {
        const kb = new TextEncoder().encode(k);
        writeNum(to, BigInt(kb.length));
        for (const c of kb) to.push(c);
        encodeImpl(to, v);
      }
      return;
    }
    default: throw new Error(`unsupported calldata type ${typeof data}`);
  }
}
/** genlayer calldata encode (str/num/bool/arr/plain-object subset) -> hex. */
export function encodeCalldata(data) {
  const a = [];
  encodeImpl(a, data);
  return toHex(new Uint8Array(a));
}

/**
 * Send a write (contract call) on 61999 through the V5 flat addTransaction ABI.
 * Wallet flow note: works with locally-signed accounts (createAccount); for
 * browser json-rpc accounts use sendWriteV5JsonRpc in the app lib instead.
 */
export async function writeContractV5({ client, account, address, functionName, args = [], value = 0n, leaderOnly = false }) {
  // 61999's legacy py-genlayer runner resolves methods from the "method" key
  // (verified on-chain: tx 0x91018a30… calldata = {"method":"resolve"}). The
  // rc.1-canonical ""-key layout falls into __handle_undefined_method__ there.
  const cd = { method: functionName, ...(args.length ? { args } : {}) };
  const txData = toRlp([encodeCalldata(cd), leaderOnly ? "0x01" : "0x00"]);
  const encodedData = encodeFunctionData({
    abi: ADD_TRANSACTION_ABI_V5,
    functionName: "addTransaction",
    args: [
      account.address,
      address,
      BigInt(client.chain.defaultNumberOfInitialValidators),
      BigInt(client.chain.defaultConsensusMaxRotations),
      txData,
    ],
  });
  const to = client.chain.consensusMainContract.address;
  let gas;
  try {
    gas = await client.request({
      method: "eth_estimateGas",
      params: [{ from: account.address, to, data: encodedData, value: `0x${value.toString(16)}` }],
    });
    gas = BigInt(gas);
  } catch (err) {
    console.warn("[v5] gas estimation failed, using 2,000,000:", err instanceof Error ? err.message : err);
    gas = 2_000_000n;
  }
  const gasPrice = BigInt(await client.request({ method: "eth_gasPrice" }));
  const nonce = await client.getCurrentNonce({ address: account.address });
  const serializedTransaction = await account.signTransaction({
    account,
    to,
    data: encodedData,
    type: "legacy",
    nonce: Number(nonce),
    value,
    gas,
    gasPrice,
    chainId: client.chain.id,
  });
  const txHash = await client.sendRawTransaction({ serializedTransaction });
  console.log("[v5-write]", functionName, "tx:", txHash);
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    waitUntil: "finalized",
    retries: 100,
    interval: 5000,
  });
  return { txHash, receipt };
}

// ---------------------------------------------------------------------------
// Reads — 61999's gen_call runner resolves methods via the "method" key too
// (the SDK's readContract sends the ""-key layout, which lands in
// __handle_undefined_method__). The decoder is a faithful port of
// src/abi/calldata/decoder.ts from genlayer-js 2.0.0-rc.1.
// ---------------------------------------------------------------------------
function readULeb128(data, i) {
  let res = 0n, accum = 0n;
  for (;;) {
    const byte = data[i.i++];
    res += BigInt(byte & 127) * (1n << accum);
    accum += 7n;
    if (byte < 128) break;
  }
  return res;
}
function decodeImpl(data, i) {
  const cur = readULeb128(data, i);
  if (cur === 0n) return null;
  if (cur === 2n) return true;
  if (cur === 1n) return false;
  if (cur === 3n) {
    const b = data.slice(i.i, i.i + 20);
    i.i += 20;
    return "0x" + Buffer.from(b).toString("hex");
  }
  const type = Number(cur & 0xffn) & 7;
  const rest = cur >> 3n;
  switch (type) {
    case 3: { // bytes
      const b = data.slice(i.i, i.i + Number(rest));
      i.i += Number(rest);
      return b;
    }
    case 1: return rest;       // pint
    case 2: return -1n - rest; // nint
    case 4: {                  // str
      const s = data.slice(i.i, i.i + Number(rest));
      i.i += Number(rest);
      return new TextDecoder("utf-8").decode(s);
    }
    case 5: {                  // array
      const out = [];
      for (let n = rest; n > 0n; n--) out.push(decodeImpl(data, i));
      return out;
    }
    case 6: {                  // map
      const out = {};
      for (let n = rest; n > 0n; n--) {
        const keyLen = Number(readULeb128(data, i));
        const key = new TextDecoder("utf-8").decode(data.slice(i.i, i.i + keyLen));
        i.i += keyLen;
        out[key] = decodeImpl(data, i);
      }
      return out;
    }
    default: throw new Error(`calldata decode: unknown type ${type} at ${i.i}`);
  }
}
/** Decode a genlayer-calldata payload (str/num/bool/bytes/arr/map/addr). */
export function decodeCalldataV5(bytes) {
  const i = { i: 0 };
  const res = decodeImpl(bytes, i);
  if (i.i !== bytes.length) throw new Error(`calldata decode: trailing bytes (${i.i}/${bytes.length})`);
  return res;
}

/**
 * Read-only call on 61999 via gen_call with V5 ("method"-key) calldata.
 * Mirrors the SDK's readContract (RLP([calldata, leaderOnly]) framing and
 * gen_call result extraction) minus the ""-key encoding that breaks here.
 */
export async function readCallV5({ client, address, functionName, args = [], from }) {
  const cd = { method: functionName, ...(args.length ? { args } : {}) };
  const data = toRlp([encodeCalldata(cd), "0x00"]);
  const result = await client.request({
    method: "gen_call",
    params: [{
      type: "read",
      to: address,
      from: from ?? "0x0000000000000000000000000000000000000000",
      data,
    }],
  });
  const hex = typeof result === "string" ? result : (result?.data ?? "");
  const prefixed = hex.startsWith("0x") ? hex : `0x${hex}`;
  return decodeCalldataV5(new Uint8Array(Buffer.from(prefixed.slice(2), "hex")));
}
