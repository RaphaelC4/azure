// genlayer-v5.ts — V5 flat-ABI write & read path for legacy studionet (61999).
//
// WHY: genlayer-js 2.0.0-rc.1 encodes writes with the struct addTransaction
// ABI (selector 0x35a251fb). The 61999 consensus main contract only implements
// the OLD flat interface addTransaction(address,address,uint256,uint256,bytes)
// (selector 0x27241a99), so rc.1 writes there finalize to an empty type-0
// NO_MAJORITY tx. This module rebuilds the 1.x-era envelope: genlayer calldata
// ("method"-key layout, byte-verified against on-chain txs) -> RLP ->
// V5 addTransaction -> wallet-signed eth_sendTransaction (browser flow).
// Reads ride gen_call with the same "method"-key calldata (the SDK's ""-key
// layout lands in __handle_undefined_method__ on this net's runner); the
// response payload is decoded with a port of rc.1's calldata decoder.
import {
  encodeFunctionData,
  toHex,
  toRlp,
  type Address,
} from "viem";
import type { GenClient } from "./contract";

const BITS = 3;
const TYPE_PINT = 1;
const TYPE_STR = 4;
const TYPE_ARR = 5;
const TYPE_MAP = 6;

function writeNum(to: number[], data: bigint): void {
  if (data === 0n) {
    to.push(0);
    return;
  }
  while (data > 0) {
    let cur = Number(data & 0x7fn);
    data >>= 7n;
    if (data > 0) cur |= 128;
    to.push(cur);
  }
}

function numWithType(to: number[], data: bigint, type: number): void {
  writeNum(to, (data << BigInt(BITS)) | BigInt(type));
}

function cmpStr(l: number[], r: number[]): number {
  for (let i = 0; i < l.length && i < r.length; i++) {
    const c = l[i] - r[i];
    if (c !== 0) return c;
  }
  return l.length - r.length;
}

function encodeImpl(to: number[], data: unknown): void {
  if (data === null || data === undefined) {
    to.push(0);
    return;
  }
  if (data === true) {
    to.push(2);
    return;
  }
  if (data === false) {
    to.push(1);
    return;
  }
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
      const entries = Object.entries(data as Record<string, unknown>).map(
        ([k, v]) =>
          [Array.from(k, (c) => c.codePointAt(0) as number), k, v] as const,
      );
      entries.sort((a, b) => cmpStr([...a[0]], [...b[0]]));
      numWithType(to, BigInt(entries.length), TYPE_MAP);
      for (const [, k, v] of entries) {
        const kb = new TextEncoder().encode(k);
        writeNum(to, BigInt(kb.length));
        for (const c of kb) to.push(c);
        encodeImpl(to, v);
      }
      return;
    }
    default:
      throw new Error(`unsupported calldata type ${typeof data}`);
  }
}

/** genlayer calldata encode (str/num/bool/arr/plain-object subset) -> 0x-hex. */
function encodeCalldata(data: unknown): `0x${string}` {
  const a: number[] = [];
  encodeImpl(a, data);
  return toHex(new Uint8Array(a));
}

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
] as const;

interface V5WriteArgs {
  /** The deployed genlayer contract to call (recipient of the inner tx). */
  address: Address;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  leaderOnly?: boolean;
}

function accountAddress(client: GenClient): Address | undefined {
  const acc = (client as unknown as { account?: unknown }).account;
  if (typeof acc === "string") return acc as Address;
  const addr = (acc as { address?: Address } | undefined)?.address;
  return addr;
}

/**
 * Sends a write on 61999 through the V5 flat addTransaction envelope.
 * Signing rides the client's json-rpc account (browser wallet) via
 * eth_sendTransaction — mirrors what rc.1's writeContract does, only with the
 * encoding the 61999 consensus contract actually implements.
 */
export async function sendWriteV5(
  client: GenClient,
  { address, functionName, args = [], value = 0n, leaderOnly = false }: V5WriteArgs,
): Promise<unknown> {
  const consensusTo = client.chain.consensusMainContract?.address as Address | undefined;
  if (!consensusTo) {
    throw new Error(`Consensus main contract not configured for chain "${client.chain.name}".`);
  }
  const sender = accountAddress(client);
  if (!sender) {
    throw new Error("sendWriteV5 requires a connected account on the client.");
  }
  const cd: Record<string, unknown> = { method: functionName };
  // 61999's legacy runner resolves methods from the "method" key (on-chain
  // verified: 0x91018a30… = {"method":"resolve"}); the rc.1 ""-key layout hits
  // __handle_undefined_method__ there.
  if (args.length > 0) cd.args = args;
  const txData = toRlp([encodeCalldata(cd), leaderOnly ? "0x01" : "0x00"]);
  const data = encodeFunctionData({
    abi: ADD_TRANSACTION_ABI_V5,
    functionName: "addTransaction",
    args: [
      sender,
      address,
      BigInt(client.chain.defaultNumberOfInitialValidators),
      BigInt(client.chain.defaultConsensusMaxRotations),
      txData,
    ],
  });
  return client.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: sender,
        to: consensusTo,
        data,
        ...(value > 0n ? { value: `0x${value.toString(16)}` } : {}),
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Reads — gen_call with V5 ("method"-key) calldata. The decoder is a faithful
// port of src/abi/calldata/decoder.ts from genlayer-js 2.0.0-rc.1 (browser-
// safe: no Buffer, Uint8Array + TextDecoder only). Verified live on 61999:
// get_case("AZ-2") round-trips the full case JSON through this path.
// ---------------------------------------------------------------------------

function readULeb128(data: Uint8Array, i: { i: number }): bigint {
  let res = 0n;
  let accum = 0n;
  for (;;) {
    const byte = data[i.i++];
    res += BigInt(byte & 127) * (1n << accum);
    accum += 7n;
    if (byte < 128) break;
  }
  return res;
}

function byteHex(b: Uint8Array): string {
  let out = "";
  for (const c of b) out += c.toString(16).padStart(2, "0");
  return out;
}

function decodeImpl(data: Uint8Array, i: { i: number }): unknown {
  const cur = readULeb128(data, i);
  if (cur === 0n) return null;
  if (cur === 2n) return true;
  if (cur === 1n) return false;
  if (cur === 3n) {
    const b = data.slice(i.i, i.i + 20);
    i.i += 20;
    return `0x${byteHex(b)}`;
  }
  const type = Number(cur & 0xffn) & 7;
  const rest = cur >> 3n;
  switch (type) {
    case 3: { // bytes
      const b = data.slice(i.i, i.i + Number(rest));
      i.i += Number(rest);
      return b;
    }
    case 1:
      return rest; // pint
    case 2:
      return -1n - rest; // nint
    case 4: { // str
      const s = data.slice(i.i, i.i + Number(rest));
      i.i += Number(rest);
      return new TextDecoder("utf-8").decode(s);
    }
    case 5: { // array
      const out: unknown[] = [];
      for (let n = rest; n > 0n; n--) out.push(decodeImpl(data, i));
      return out;
    }
    case 6: { // map
      const out: Record<string, unknown> = {};
      for (let n = rest; n > 0n; n--) {
        const keyLen = Number(readULeb128(data, i));
        const key = new TextDecoder("utf-8").decode(data.slice(i.i, i.i + keyLen));
        i.i += keyLen;
        out[key] = decodeImpl(data, i);
      }
      return out;
    }
    default:
      throw new Error(`calldata decode: unknown type ${type} at ${i.i}`);
  }
}

/** Decode a genlayer-calldata payload (str/num/bool/bytes/arr/map/addr). */
export function decodeCalldataV5(bytes: Uint8Array): unknown {
  const i = { i: 0 };
  const res = decodeImpl(bytes, i);
  if (i.i !== bytes.length) {
    throw new Error(`calldata decode: trailing bytes (${i.i}/${bytes.length})`);
  }
  return res;
}

export interface V5ReadArgs {
  address: Address;
  functionName: string;
  args?: readonly unknown[];
  /** Simulated caller; defaults to the zero address (public read). */
  from?: Address;
}

/**
 * Read-only call on 61999 via gen_call with V5 ("method"-key) calldata.
 * Mirrors the SDK's readContract (RLP([calldata, leaderOnly]) framing and
 * gen_call result extraction) minus the ""-key encoding that 61999's runner
 * cannot resolve. No account needed — reads are public.
 */
export async function readCallV5(
  client: GenClient,
  { address, functionName, args = [], from }: V5ReadArgs,
): Promise<unknown> {
  const cd: Record<string, unknown> = { method: functionName };
  if (args.length > 0) cd.args = args;
  const data = toRlp([encodeCalldata(cd), "0x00"]);
  const result = await client.request({
    method: "gen_call",
    params: [
      {
        type: "read",
        to: address,
        from: (from ?? "0x0000000000000000000000000000000000000000") as Address,
        data,
      },
    ],
  });
  const hex = typeof result === "string" ? result : ((result as { data?: string })?.data ?? "");
  const prefixed = hex.startsWith("0x") ? hex : `0x${hex}`;
  const bytes = new Uint8Array(
    (prefixed.slice(2).match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)),
  );
  return decodeCalldataV5(bytes);
}
