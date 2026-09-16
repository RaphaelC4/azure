/**
 * Azure contract integration.
 *
 * Reads (`get_case`) are public gen_call RPC reads — they work in any
 * browser tab, no wallet needed. Writes (`file_dispute`, `submit_evidence`,
 * `approve_case_evidence`, `request_verdict`, `accept_verdict`, `settle`) go
 * through the connected wallet: genlayer-js
 * hands `eth_sendTransaction` to the EIP-1193 provider from lib/wallet.ts,
 * the wallet signs and broadcasts, then we poll the consensus receipt and
 * pull the contract's return value (case id, verdict text, …) out of the
 * leader receipt payload — the top-level receipt result is only a consensus
 * status code.
 *
 * NETS: the app transits between the GenLayer nets the Azure contract is
 * deployed on (the registry below). Each net carries its own contract
 * address (baked from env at build time), chain id and explorer; the user's
 * choice persists in localStorage (`azure-net-v1`) and every read/write
 * re-targets the active net. NEXT_PUBLIC_GENLAYER_CHAIN_ID selects the
 * default net (61997 studio-dev, 61999 studionet);
 * NEXT_PUBLIC_CONTRACT_STUDIO_DEV / NEXT_PUBLIC_CONTRACT_STUDIONET carry
 * the per-net instances (NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS still works
 * as the default net's address). With no address on a net, that net renders
 * demo behaviour. Writes use the net-appropriate envelope: SDK struct ABI on
 * 61997, the V5 flat addTransaction on 61999 (lib/genlayer-v5.ts).
 *
 * Nothing here touches `window` at import time; clients are created lazily
 * inside functions, so Next.js SSR never evaluates them.
 */

import { createClient } from "genlayer-js";
import { studioDevnet, studionet } from "genlayer-js/chains";
import { TransactionStatus, type Hash } from "genlayer-js/types";
import type { Account, Address } from "viem";
import { readCallV5, sendWriteV5 } from "./genlayer-v5";
import { chainParamsFor, ensureStudionetChain, type ProviderLike } from "./wallet";

// ---------------------------------------------------------------------------
// Net registry — the switchable studio-dev ⇄ studionet targets
// ---------------------------------------------------------------------------

export type NetId = "studio-dev" | "studionet";

export interface NetConfig {
  id: NetId;
  /** Short UI label ("Studio-Dev", "Studionet"). */
  label: string;
  chainId: number;
  explorer: string;
  /** Deployed Azure contract on this net, baked at build time from env. */
  contract: string;
  /**
   * True when the app can send contract writes on this net. 61999 was
   * blocked only because genlayer-js 2.0.0-rc.1's default envelope lands as
   * an empty tx there — the V5 sender in lib/genlayer-v5.ts rebuilds the
   * legacy flat addTransaction and writes/reached-consensus + reads (via
   * readCallV5) are verified live on 61999 (2026-09-13 smoke: file_dispute
   * + accept_dispute → MAJORITY_AGREE, case AZ-2). Kept as a switch so a
   * net-wide outage can gate writes without touching the write paths.
   */
  writesAvailable: boolean;
  /** One-line status the UI surfaces next to the net toggle. */
  status: string;
}

// NOTE: these must be static `process.env.NEXT_PUBLIC_X` member expressions —
// Turbopack only inlines static accesses, so a dynamic `process.env[name]`
// lookup compiles to an empty string in the browser bundle.
const trim = (v: string | undefined) => (v || "").trim();

export const NETS: Record<NetId, NetConfig> = {
  "studio-dev": {
    id: "studio-dev",
    label: "Studio-Dev",
    chainId: 61997,
    explorer: "https://explorer-studio-dev.genlayer.com",
    contract:
      trim(process.env.NEXT_PUBLIC_CONTRACT_STUDIO_DEV) ||
      trim(process.env.NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS),
    writesAvailable: true,
    status: "Live — full lifecycle, real GEN stakes",
  },
  studionet: {
    id: "studionet",
    label: "Studionet",
    chainId: 61999,
    explorer: "https://explorer-studio.genlayer.com",
    contract: trim(process.env.NEXT_PUBLIC_CONTRACT_STUDIONET),
    writesAvailable: true,
    status: "Live — full lifecycle via the V5 envelope (reads + writes verified)",
  },
};

const isNetId = (v: string | null): v is NetId => v === "studio-dev" || v === "studionet";

function defaultNetId(): NetId {
  if (Number(process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID || 61997) === 61999) return "studionet";
  return "studio-dev";
}

/** localStorage key persisting the user's net choice across reloads. */
const NET_STORAGE_KEY = "azure-net-v1";

let activeNetId: NetId = defaultNetId();
let netHydrated = false;
const netListeners = new Set<() => void>();

function hydrateNet() {
  if (netHydrated || typeof window === "undefined") return;
  netHydrated = true;
  try {
    const saved = window.localStorage.getItem(NET_STORAGE_KEY);
    if (isNetId(saved)) activeNetId = saved;
  } catch {
    /* storage unavailable — keep the default net */
  }
}

function emitNet() {
  for (const fn of netListeners) fn();
}

/** Subscribe to net changes (React via useSyncExternalStore). */
export function subscribeNet(fn: () => void): () => void {
  netListeners.add(fn);
  return () => {
    netListeners.delete(fn);
  };
}

export function getNetId(): NetId {
  hydrateNet();
  return activeNetId;
}

/** The active net's full config (address, chain, explorer, health). */
export function getNet(): NetConfig {
  return NETS[getNetId()];
}

/** Switch nets, persist the choice, and drop every cached read — the cache
    keys are net-scoped, but the in-flight enumeration and the session mirror
    belong to the previous net and must not leak across a switch. */
export function setNet(id: NetId) {
  if (!isNetId(id) || id === activeNetId) return;
  activeNetId = id;
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(NET_STORAGE_KEY, id);
  } catch {
    /* storage unavailable — the choice lives for this tab only */
  }
  bustReadCache();
  emitNet();
}

/** True when a well-formed contract address is configured on the active net. */
export const isLive = () => /^0x[0-9a-fA-F]{40}$/.test(getNet().contract);

/** The active net's deployed contract address ("" when unconfigured). */
export const contractAddress = () => getNet().contract;

export const explorerTx = (hash: string) => `${getNet().explorer}/tx/${hash}`;
export const explorerAddress = (a: string) => `${getNet().explorer}/address/${a}`;

// ---------------------------------------------------------------------------
// Case model
// ---------------------------------------------------------------------------

/**
 * Lifecycle statuses the deployed Azure contract writes into the case blob.
 * ("consensus" is no longer written by the current deployment but stays in
 * the union so any older cached blob still type-checks.)
 */
export type CaseStatus =
  | "pending_acceptance"
  | "evidence_open"
  | "consensus"
  | "settled_pending"
  | "settled"
  | "cancelled";

/** Shape the contract stores for one party's evidence. */
export interface EvidenceRecord {
  text: string;
  fetched_url: string | null;
  fetched_content: string | null;
}

/**
 * The contract stores evidence as an object ({text, fetched_url,
 * fetched_content}) — it must never be rendered directly as a React child.
 * Returns null for "nothing submitted" (including an empty object); plain
 * strings from older blobs are wrapped so the UI still shows them.
 */
export function parseEvidence(raw: unknown): EvidenceRecord | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    return text ? { text: raw, fetched_url: null, fetched_content: null } : null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === "string" ? r.text : "";
  const fetched_url = typeof r.fetched_url === "string" && r.fetched_url ? r.fetched_url : null;
  const fetched_content =
    typeof r.fetched_content === "string" && r.fetched_content ? r.fetched_content : null;
  if (!text && !fetched_content) return null;
  return { text, fetched_url, fetched_content };
}

/** Human-readable evidence for the UI: the typed text plus the verified-fetch note. */
export function evidenceDisplay(ev: EvidenceRecord | string | null): string | null {
  const rec = parseEvidence(ev);
  if (!rec) return null;
  const parts: string[] = [];
  if (rec.text) parts.push(rec.text);
  if (rec.fetched_url) parts.push(`[Fetched by the contract from ${rec.fetched_url}]`);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

export interface AzureCase {
  case_id: string;
  claimant: string;
  respondent: string;
  /** Staked GEN in wei, kept as a string so JS doubles can't round it. */
  staked_amount: string;
  terms: string;
  status: CaseStatus | string;
  claimant_evidence: EvidenceRecord | string | null;
  respondent_evidence: EvidenceRecord | string | null;
  verdict: string | null;
  winner: string | null;
  acceptance_deadline?: string | null;
  evidence_deadline?: string | null;
  /** Consent ledger — each flag is set True by that party's own tx. */
  claimant_evidence_approved?: boolean;
  respondent_evidence_approved?: boolean;
  claimant_verdict_accepted?: boolean;
  respondent_verdict_accepted?: boolean;
  /** Set when a verdict lands; settle() opens once both parties accepted or this passes. */
  verdict_acceptance_deadline?: string | null;
}

/** Contract statuses mapped onto the docket filter vocabulary. */
export function docketFilter(
  status: string,
): "Verdict Issued" | "Verdict awaiting acceptance" | "Consensus forming" | "Evidence window" | "Awaiting acceptance" | "Cancelled" {
  if (status === "settled") return "Verdict Issued";
  if (status === "settled_pending") return "Verdict awaiting acceptance";
  if (status === "consensus") return "Consensus forming";
  if (status === "pending_acceptance") return "Awaiting acceptance";
  if (status === "cancelled") return "Cancelled";
  return "Evidence window";
}

// ---------------------------------------------------------------------------
// Derived consent state — the single source of truth the UI gates its
// buttons on, so a page never fires a call the contract would revert.
// ---------------------------------------------------------------------------

/**
 * TRUE only when both sides have submitted evidence AND both parties have
 * approved the current evidence record — exactly what request_verdict
 * demands (and what the UI must show the verdict button for).
 */
export function evidenceFullyApproved(c: AzureCase): boolean {
  return (
    !!c.claimant_evidence &&
    !!c.respondent_evidence &&
    c.claimant_evidence_approved === true &&
    c.respondent_evidence_approved === true
  );
}

/** Both parties have blind-accepted the delivered verdict. */
export function verdictFullyAccepted(c: AzureCase): boolean {
  return c.claimant_verdict_accepted === true && c.respondent_verdict_accepted === true;
}

/**
 * The settle() release valve: open once both parties accepted the verdict,
 * or once the verdict acceptance deadline has passed (a refuser cannot hold
 * both stakes hostage forever).
 */
export function settleValveOpen(c: AzureCase, now = Date.now()): boolean {
  if (verdictFullyAccepted(c)) return true;
  const t = c.verdict_acceptance_deadline ? Date.parse(c.verdict_acceptance_deadline) : NaN;
  return Number.isFinite(t) && now >= t;
}

/**
 * Blind-reveal rule: the verdict's reasoning and winner are only rendered
 * once the case is settled. The contract's storage is technically public
 * during settled_pending — this gate is what keeps the ceremony honest in
 * the app (see the caveat in azure_contract.py).
 */
export function verdictRevealed(c: Pick<AzureCase, "status">): boolean {
  return c.status === "settled";
}

/**
 * get_case returns a JSON-encoded case blob (or "" for unknown ids). Quote
 * wei-scale integers before JSON.parse so they can't be rounded by JS
 * doubles (2^53 ≈ 9e15, but 1 GEN = 1e18 wei).
 */
function parseCaseJson(raw: unknown): AzureCase | null {
  let data: Record<string, unknown>;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    try {
      const safe = text.replace(/("staked_amount"\s*:\s*)(\d{15,})/g, '$1"$2"');
      data = JSON.parse(safe);
    } catch {
      return null;
    }
  } else if (raw && typeof raw === "object") {
    data = raw as Record<string, unknown>;
  } else {
    return null;
  }
  if (typeof data.case_id !== "string") return null;
  return {
    case_id: data.case_id,
    claimant: String(data.claimant ?? ""),
    respondent: String(data.respondent ?? ""),
    staked_amount: String(data.staked_amount ?? "0"),
    terms: String(data.terms ?? ""),
    status: String(data.status ?? ""),
    claimant_evidence: parseEvidence(data.claimant_evidence),
    respondent_evidence: parseEvidence(data.respondent_evidence),
    verdict: (data.verdict as string | null) ?? null,
    winner: (data.winner as string | null) ?? null,
    acceptance_deadline: (data.acceptance_deadline as string | null) ?? null,
    evidence_deadline: (data.evidence_deadline as string | null) ?? null,
    claimant_evidence_approved: data.claimant_evidence_approved === true,
    respondent_evidence_approved: data.respondent_evidence_approved === true,
    claimant_verdict_accepted: data.claimant_verdict_accepted === true,
    respondent_verdict_accepted: data.respondent_verdict_accepted === true,
    verdict_acceptance_deadline: (data.verdict_acceptance_deadline as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Reads — public, no wallet needed
// ---------------------------------------------------------------------------

export type GenClient = ReturnType<typeof createClient>;

/** Chain descriptor for a net's chain id: the studio-dev net runs 61997 on
    studio-dev.genlayer.com, anything else rides the legacy public studionet
    descriptor (61999). */
function chainDescriptorFor(chainId: number) {
  return chainId === 61997 ? studioDevnet : studionet;
}

const readClients = new Map<number, GenClient>();

/** One read client per net chain — created lazily, cached for the session.
    Writes pass the net they captured up front, so a mid-flight net switch
    can't retarget their receipt polling. */
function getClient(net?: NetConfig): GenClient {
  const chainId = (net ?? getNet()).chainId;
  let client = readClients.get(chainId);
  if (!client) {
    client = createClient({ chain: chainDescriptorFor(chainId) });
    readClients.set(chainId, client);
  }
  return client;
}

// ---------------------------------------------------------------------------
// Read scheduling. The Studio RPC rate-limits per IP (~500 requests per
// window) and every page polls it, so all public reads share one gate:
//   - reads are serialized with a minimum gap between two of them;
//   - identical reads while one is in flight share its promise (the homepage
//     audit and the docket enumeration read the same cases);
//   - a fresh read is cached briefly in memory and persisted to
//     sessionStorage, so reloading a page doesn't refire the whole burst;
//   - settled (final) cases are cached for minutes, so the docket's 30s poll
//     re-reads only the active cases plus one probe past the end of the list;
//   - HTTP 429s put every read on a cooldown, and the read retries once.
// This is what keeps multi-tab browsing under the rate limit.
// ---------------------------------------------------------------------------

const READ_GAP_MS = 300; // min spacing between two RPC reads
const READ_CACHE_TTL_MS = 2000; // how long a fresh read may be reused in memory
const READ_PERSIST_TTL_MS = 15_000; // sessionStorage layer — survives a reload
const SETTLED_CACHE_TTL_MS = 10 * 60_000; // settled cases are final — reusable far longer
const RATE_COOLDOWN_MS = 10_000; // back off after a rate-limit response

/** One cached read: when it was read, what was read, and how long it may be
    reused (the 2s/15s pair by default; settled cases carry a long ttl that
    applies to both layers). */
type CacheEntry = { at: number; value: unknown; ttl?: number };

let readTail: Promise<unknown> = Promise.resolve();
let lastReadAt = 0;
let rateLimitedUntil = 0;
const inFlight = new Map<string, Promise<unknown>>();
const readCache = new Map<string, CacheEntry>();

/** sessionStorage is scoped to the tab and to the active net+contract, so a
    reload reuses the tab's own reads and never another net's data. */
function readSessionKey(): string {
  const net = getNet();
  return `azure.reads.v1.${net.id}.${(net.contract || "demo").toLowerCase()}`;
}

// In-memory mirror of the sessionStorage record. Parsing the whole record per
// read and re-stringifying it per write is fine at demo scale but dominates
// once the docket grows past ~100 cases, so the record is parsed once per tab
// and kept in sync from then on. Only this module writes the key.
let sessionMirror: Record<string, CacheEntry> | null = null;

function sessionRecord(): Record<string, CacheEntry> {
  if (!sessionMirror) sessionMirror = loadSessionCache();
  return sessionMirror;
}

function loadSessionCache(): Record<string, CacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(readSessionKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {}; // corrupt entry, disabled storage, SSR — fall through to the chain
  }
}

function persistRead(key: string, entry: CacheEntry) {
  if (typeof window === "undefined") return;
  try {
    const cache = sessionRecord();
    cache[key] = entry;
    window.sessionStorage.setItem(readSessionKey(), JSON.stringify(cache));
  } catch {
    /* quota or privacy mode — the memory cache still works */
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Forget cached reads — called after every successful write so the follow-up
    read is fresh, and after a net switch so the previous net's data can't be
    served. Clears the memory cache, the sessionStorage layer, and any shared
    in-flight enumeration. */
export function bustReadCache() {
  readCache.clear();
  sessionMirror = null;
  enumerateInFlight = null;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(readSessionKey());
    } catch {
      /* storage unavailable — nothing persisted anyway */
    }
  }
}

/** Per-entry reuse window. A settled case is final — settle() is the last
    lifecycle step and ids are never reused — so its read can be served from
    cache for minutes instead of seconds. Everything else (cases still in
    flight, missing-id probes) keeps the short windows. bustReadCache() clears
    every entry after each successful write, so a user's own actions never
    read through a stale cache. */
function entryTtlMs(key: string, value: unknown): number {
  if (
    key.includes(":case:") &&
    value !== null &&
    typeof value === "object" &&
    (value as { status?: unknown }).status === "settled"
  ) {
    return SETTLED_CACHE_TTL_MS;
  }
  return READ_CACHE_TTL_MS;
}

function looksRateLimited(err: unknown): boolean {
  const msg = String((err as { message?: string; shortMessage?: string })?.message ?? err ?? "");
  return /\b429\b|rate.?limit|too many requests/i.test(msg);
}

async function gatedRead<T>(key: string, task: () => Promise<T>): Promise<T> {
  const hit = readCache.get(key);
  if (hit && Date.now() - hit.at < (hit.ttl ?? READ_CACHE_TTL_MS)) return hit.value as T;
  // Memory miss → fall back to the sessionStorage layer (survives a reload),
  // promoting the entry so the hot path hits memory on the next call.
  const persisted = sessionRecord()[key];
  if (persisted && typeof persisted.at === "number" && Date.now() - persisted.at < (persisted.ttl ?? READ_PERSIST_TTL_MS)) {
    readCache.set(key, persisted);
    return persisted.value as T;
  }
  const running = inFlight.get(key);
  if (running) return running as Promise<T>;

  const exec = readTail.then(async () => {
    const wait = Math.max(lastReadAt + READ_GAP_MS, rateLimitedUntil) - Date.now();
    if (wait > 0) await sleep(wait);
    lastReadAt = Date.now();
    return task();
  });
  inFlight.set(key, exec);
  // Keep the gate moving even when this read rejects.
  readTail = exec.then(
    (value) => {
      const entry: CacheEntry = { at: Date.now(), value, ttl: entryTtlMs(key, value) };
      readCache.set(key, entry);
      persistRead(key, entry);
      return undefined;
    },
    (err) => {
      if (looksRateLimited(err)) rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + RATE_COOLDOWN_MS);
      return undefined;
    }
  );
  try {
    return (await exec) as T;
  } finally {
    inFlight.delete(key);
  }
}

/** Un-gated read; only ever called through readCase. */
async function readCaseDirect(caseId: string): Promise<AzureCase | null> {
  const net = getNet();
  const address = net.contract as Address;
  // 61999's gen_call runner only resolves the "method"-key calldata layout —
  // the SDK's readContract sends the rc.1 ""-key form and always errors there.
  const raw =
    net.chainId === 61997
      ? await getClient(net).readContract({
          address,
          functionName: "get_case",
          args: [caseId],
        })
      : await readCallV5(getClient(net), {
          address,
          functionName: "get_case",
          args: [caseId],
        });
  return parseCaseJson(raw);
}

/**
 * Read one case; null when the id doesn't exist (or the blob is empty).
 * Gated: queued, deduped, briefly cached, and retried once after a
 * rate-limit cooldown so a 429 mid-enumeration doesn't tear the page down.
 */
export async function readCase(caseId: string): Promise<AzureCase | null> {
  const id = caseId.trim().toUpperCase();
  const key = `${getNetId()}:case:${id}`;
  try {
    return await gatedRead(key, () => readCaseDirect(id));
  } catch (err) {
    if (!looksRateLimited(err)) throw err;
    rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + RATE_COOLDOWN_MS);
    return await gatedRead(key, () => readCaseDirect(id));
  }
}

/** Hard stop for the enumeration. Ids are assigned in order, so the walk
    normally ends at the first missing id — this only bounds a pathological
    contract (or a stuck RPC) so no page can read forever. */
export const CASE_SCAN_CEILING = 256;

// One enumeration at a time, shared by every caller (the docket's 30s poll and
// the homepage audit): a poll tick that fires while a long first pass is still
// walking the list joins it instead of doubling the RPC burst.
let enumerateInFlight: Promise<AzureCase[]> | null = null;

/**
 * Enumerate every case the contract holds: sequential AZ-1 … AZ-N reads,
 * stopping at the first missing id (the contract assigns ids in order and
 * never reuses them). The docket can afford the full list instead of a
 * 32-case window because the steady-state poll is cheap — settled cases come
 * from the long cache — so the only expensive pass is the first one on a
 * fresh tab.
 */
export async function fetchLiveCases(maxIds = CASE_SCAN_CEILING): Promise<AzureCase[]> {
  if (!isLive()) return [];
  if (maxIds === CASE_SCAN_CEILING && enumerateInFlight) return enumerateInFlight;
  const run = (async () => {
    const out: AzureCase[] = [];
    // Only a null read proves the list ended. A transport error must not
    // truncate the docket, so skip that id and keep going — but stop after
    // two consecutive failures so a dead RPC can't be hammered.
    let failures = 0;
    for (let i = 1; i <= maxIds; i++) {
      try {
        const c = await readCase(`AZ-${i}`);
        if (!c) break;
        out.push(c);
        failures = 0;
      } catch {
        if (++failures >= 2) break;
      }
    }
    return out;
  })();
  if (maxIds === CASE_SCAN_CEILING) enumerateInFlight = run;
  try {
    return await run;
  } finally {
    if (enumerateInFlight === run) enumerateInFlight = null;
  }
}

/**
 * The last enumeration, served from the sessionStorage layer. The docket
 * seeds its state with this so a reload paints instantly instead of
 * flashing "Reading cases…" while the gated reads run. Null when nothing
 * usable is cached (fresh session, expired entries, or demo mode).
 */
export function loadCachedLiveCases(maxIds = CASE_SCAN_CEILING): AzureCase[] | null {
  if (!isLive() || typeof window === "undefined") return null;
  const cache = loadSessionCache();
  const now = Date.now();
  const out: AzureCase[] = [];
  for (let i = 1; i <= maxIds; i++) {
    const hit = cache[`${getNetId()}:case:AZ-${i}`]; // readCase's net-scoped key for `AZ-${i}`
    if (!hit || typeof hit.at !== "number" || now - hit.at >= (hit.ttl ?? READ_PERSIST_TTL_MS)) break;
    const c = parseCaseJson(hit.value);
    if (!c) break;
    out.push(c);
  }
  return out.length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// GEN formatting
// ---------------------------------------------------------------------------

/**
 * "2" | "2.5" | "2,500" GEN → wei. Null for junk, zero, or negative input —
 * parsed with string math so no float can sneak into the stake.
 */
export function parseGenWei(input: string): bigint | null {
  const t = input.trim().replace(/,/g, "").replace(/gen$/i, "").trim();
  if (!/^\d{1,9}(\.\d{1,18})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const wei = BigInt((whole || "0") + frac.padEnd(18, "0"));
  return wei === 0n ? null : wei;
}

/** wei → human GEN, up to 6 fractional digits, trailing zeros trimmed. */
export function formatGen(wei: string | bigint): string {
  let w: bigint;
  try {
    w = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  } catch {
    return "0";
  }
  const base = 10n ** 18n;
  const whole = w / base;
  const frac = (w % base).toString().padStart(18, "0").replace(/0+$/, "").slice(0, 6);
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// ---------------------------------------------------------------------------
// Writes — signed by the connected wallet (lib/wallet.ts provider)
// ---------------------------------------------------------------------------

/** The minimal wallet surface the write path needs. */
export interface WalletArgs {
  provider: ProviderLike;
  account: string;
}

/**
 * A viem "json-rpc" account: genlayer-js sees a non-local account and routes
 * signing through eth_sendTransaction instead of signing locally — exactly
 * what a browser wallet (or WalletConnect session) expects.
 */
function walletAccount(address: string): Account {
  return { address: address as Address, type: "json-rpc" } as unknown as Account;
}

function writeClient({ provider, account }: WalletArgs, net: NetConfig): GenClient {
  const client = createClient({
    chain: chainDescriptorFor(net.chainId),
    account: account as Address, // a string address makes genlayer-js route eth_* to the provider
    provider: provider as never, // our EIP-1193 surface (request()) is all the SDK calls
  });
  // 61999 (studionet) needs the V5 flat addTransaction envelope: rc.1's struct
  // ABI (0x35a251fb) is not implemented by its consensus contract, so default
  // writes finalize as empty type-0 NO_MAJORITY txs. sendWriteV5 rebuilds the
  // 1.x-era encoding (method-key calldata -> RLP -> V5 ABI) and rides the same
  // wallet-signed eth_sendTransaction flow. Reads stay on the SDK path.
  if (net.chainId !== 61997) {
    client.writeContract = (async (args: Parameters<GenClient["writeContract"]>[0]) => {
      const hash = (await sendWriteV5(client, {
        address: args.address,
        functionName: String(args.functionName),
        args: (args.args ?? []) as readonly unknown[],
        value: args.value ?? 0n,
      })) as Hash;
      return hash;
    }) as GenClient["writeContract"];
    return client;
  }
  // On 61997 the node rejects wallet-signed writes with FeeValueMustBeNonZero:
  // the SDK's fee auto-resolution quotes zero here and the eth_sendTransaction
  // envelope carries no fee field at all, so the node sees fee = 0.
  //
  // More importantly, writes that emit value messages (settle/withdraw-style
  // paths calling emit_transfer) ALSO need a message fee budget — a plain
  // execution quote fails them with `0x02 fee no_matching_allocation #
  // external` and the payout silently never leaves the contract. So quote per
  // write with estimateTransactionFeesForWrite: it simulates the concrete
  // call and returns the authoritative preset (distribution + feeValue +
  // messageAllocations). Not cached — the quote depends on the method/args.
  // Small retry because sim_getFeeConfig occasionally 404s with an HTML page.
  const origWrite = client.writeContract.bind(client);
  client.writeContract = (async (args: Parameters<GenClient["writeContract"]>[0]) => {
    let quote: Awaited<ReturnType<GenClient["estimateTransactionFeesForWrite"]>> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        quote = await client.estimateTransactionFeesForWrite({
          address: args.address,
          functionName: args.functionName,
          args: args.args as never,
          ...(args.kwargs ? { kwargs: args.kwargs } : {}),
          ...(args.value ? { value: args.value } : {}),
        });
        break;
      } catch {
        if (attempt === 2) {
          const hints: Record<string, string> = {
            reclaim_unaccepted_stake: "Reclaims only work after the accept window expires (24h) and only while the dispute is still unaccepted — check the case status on the explorer, then try again.",
            settle: "Settle only works after both parties accepted the verdict and the deadline valve opened — check the case status, then try again.",
            withdraw: "Withdraw only works after the case is settled and only pays the winner's credit — check the case status, then try again.",
          };
          const hint = hints[String(args.functionName)] ?? "";
          const lead =
            String(args.functionName) === "reclaim_unaccepted_stake"
              ? "We couldn't prepare this transaction (24h window not expired yet)."
              : "We couldn't prepare this transaction.";
          throw new Error(
            lead +
              (hint ? ` ${hint}` : "") +
              " If it keeps happening, the network may be busy — give it a minute and retry.",
          );
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    return origWrite({
      ...args,
      fees: {
        distribution: quote!.distribution,
        feeValue: quote!.feeValue,
        ...(quote!.messageAllocations?.length ? { messageAllocations: quote!.messageAllocations } : {}),
      },
    } as typeof args);
  }) as GenClient["writeContract"];
  return client;
}

const RECEIPT_POLL = { retries: 120, interval: 5000 } as const;

async function awaitConsensus(hash: string, net: NetConfig = getNet()) {
  return getClient(net).waitForTransactionReceipt({
    hash: hash as Hash,
    status: TransactionStatus.FINALIZED,
    ...RECEIPT_POLL,
  });
}

/**
 * The consensus receipt's result field is a status code (6 = MAJORITY_AGREE,
 * …). The value the Python method returned lives inside
 * consensus_data.leader_receipt[0].result.payload.readable, JSON-encoded.
 */
function extractReturnValue(receipt: unknown): string {
  const r = receipt as {
    consensus_data?: {
      leader_receipt?: Array<{
        result?: { status?: string; payload?: { readable?: string } };
        genvm_result?: { stderr?: string };
      }>;
    };
  };
  const leader = r?.consensus_data?.leader_receipt?.[0];
  const result = leader?.result;
  if (!result || result.status !== "return") {
    const stderr = leader?.genvm_result?.stderr ?? "(no stderr captured)";
    throw new Error(`The contract call did not return successfully. ${stderr}`.trim());
  }
  const readable = result.payload?.readable ?? "";
  try {
    return JSON.parse(readable);
  } catch {
    return readable;
  }
}

/** Wait for consensus, tagging failures with the tx hash so the UI can link to it. */
async function finalizeOrThrow(hash: string, what: string, net: NetConfig = getNet()): Promise<unknown> {
  try {
    return await awaitConsensus(hash, net);
  } catch (err) {
    const m = String(err instanceof Error ? err.message : err);
    if (m.includes(hash)) throw err;
    throw new Error(`${what} did not reach final consensus — tx ${hash}. ${m}`.trim());
  }
}

/** Which party `account` is (if either) for the given case. */
function evidenceSideFor(account: string, c: AzureCase): "claimant" | "respondent" | null {
  const a = account.toLowerCase();
  if (a === (c.claimant || "").toLowerCase()) return "claimant";
  if (a === (c.respondent || "").toLowerCase()) return "respondent";
  return null;
}

/**
 * After an evidence write finalizes, re-read the case WITHOUT the read-cache
 * and confirm the evidence actually landed. A GenVM execution error (the wallet
 * shows "Execution result ERROR / Contract Error") finalizes the write tx
 * without recording anything — without this check the write path would report
 * success while the case still shows no evidence.
 */
async function assertEvidenceRecorded(txHash: string, w: WalletArgs & { caseId: string }): Promise<void> {
  const after = await readCaseDirect(w.caseId);
  if (!after) return; // transport-level read failure — can't verify, don't blame the contract
  const side = evidenceSideFor(w.account, after);
  const landed = side === "claimant" ? after.claimant_evidence : side === "respondent" ? after.respondent_evidence : null;
  if (!landed) {
    throw new Error(
      `Evidence was not recorded — the contract call finalized with an execution error (Contract Error). Tx ${txHash}. ` +
        `The case still shows no ${side ?? "matching-party"} evidence on-chain.`
    );
  }
}

/**
 * Resolve + validate the write target on the active net before any signing:
 * a net with no configured contract gets a clear env hint, and studionet
 * gets an honest refusal (its validator consensus is offline — a write would
 * sit unfinalized forever, so don't let it start).
 */
function writeTarget(): NetConfig {
  const net = getNet();
  if (!isLive()) {
    const envName = net.chainId === 61997 ? "NEXT_PUBLIC_CONTRACT_STUDIO_DEV" : "NEXT_PUBLIC_CONTRACT_STUDIONET";
    throw new Error(`No Azure contract configured on ${net.label} — set ${envName} in .env.local.`);
  }
  if (!net.writesAvailable) {
    throw new Error(`${net.label} cannot accept contract writes right now: ${net.status}. Switch back to Studio-Dev for the full lifecycle.`);
  }
  return net;
}

/** file_dispute(respondent, terms) — payable; stakeWei is the real stake. */
export async function fileDisputeOnChain(
  w: WalletArgs & { respondent: string; terms: string; stakeWei: bigint }
): Promise<{ txHash: string; caseId: string }> {
  const net = writeTarget();
  await ensureStudionetChain(w.provider, chainParamsFor(net.chainId));
  const c = writeClient(w, net);
  const txHash = (await c.writeContract({
    account: walletAccount(w.account),
    address: net.contract as Address,
    functionName: "file_dispute",
    args: [w.respondent, w.terms],
    value: w.stakeWei,
  })) as string;
  const caseId = extractReturnValue(await awaitConsensus(txHash, net));
  bustReadCache();
  return { txHash, caseId };
}

/** submit_evidence(case_id, evidence) — only case participants may call. */
export async function submitEvidenceOnChain(w: WalletArgs & { caseId: string; evidence: string }): Promise<string> {
  const net = writeTarget();
  await ensureStudionetChain(w.provider, chainParamsFor(net.chainId));
  const c = writeClient(w, net);
  const txHash = (await c.writeContract({
    account: walletAccount(w.account),
    address: net.contract as Address,
    functionName: "submit_evidence",
    args: [w.caseId, w.evidence],
    value: 0n,
  })) as string;
  await finalizeOrThrow(txHash, "Evidence submission", net);
  await assertEvidenceRecorded(txHash, w);
  bustReadCache();
  return txHash;
}

/** submit_evidence_with_url(case_id, evidence, evidence_url) — the contract itself fetches the URL once and snapshots it on-chain. */
export async function submitEvidenceWithUrlOnChain(
  w: WalletArgs & { caseId: string; evidence: string; evidenceUrl: string }
): Promise<string> {
  const net = writeTarget();
  await ensureStudionetChain(w.provider, chainParamsFor(net.chainId));
  const c = writeClient(w, net);
  const txHash = (await c.writeContract({
    account: walletAccount(w.account),
    address: net.contract as Address,
    functionName: "submit_evidence_with_url",
    args: [w.caseId, w.evidence, w.evidenceUrl],
    value: 0n,
  })) as string;
  await finalizeOrThrow(txHash, "Evidence submission", net);
  await assertEvidenceRecorded(txHash, w);
  bustReadCache();
  return txHash;
}

/** request_verdict(case_id) — runs the comparative equivalence principle; returns the reasoning.
    Only succeeds once both parties have approved the evidence record (see approveEvidenceOnChain). */
export async function requestVerdictOnChain(w: WalletArgs & { caseId: string }): Promise<{ txHash: string; verdict: string }> {
  const net = writeTarget();
  await ensureStudionetChain(w.provider, chainParamsFor(net.chainId));
  const c = writeClient(w, net);
  const txHash = (await c.writeContract({
    account: walletAccount(w.account),
    address: net.contract as Address,
    functionName: "request_verdict",
    args: [w.caseId],
    value: 0n,
  })) as string;
  const verdict = extractReturnValue(await awaitConsensus(txHash, net));
  bustReadCache();
  return { txHash, verdict };
}

/** approve_case_evidence(case_id) — the connected wallet (a case party)
    approves the CURRENT on-chain evidence record as the basis for the
    verdict. Both parties must do this before request_verdict will run; any
    evidence re-submission clears both approvals. */
export async function approveEvidenceOnChain(w: WalletArgs & { caseId: string }): Promise<{ txHash: string; message: string }> {
  const net = writeTarget();
  await ensureStudionetChain(w.provider, chainParamsFor(net.chainId));
  const c = writeClient(w, net);
  const txHash = (await c.writeContract({
    account: walletAccount(w.account),
    address: net.contract as Address,
    functionName: "approve_case_evidence",
    args: [w.caseId],
    value: 0n,
  })) as string;
  const message = extractReturnValue(await awaitConsensus(txHash, net));
  bustReadCache();
  return { txHash, message };
}

/** accept_verdict(case_id) — the connected wallet (a case party) blind-accepts
    the delivered verdict, binding itself to a judgment it has not seen. The
    second acceptance settles the case and pays the winner in the same tx. */
export async function acceptVerdictOnChain(w: WalletArgs & { caseId: string }): Promise<{ txHash: string; message: string }> {
  const net = writeTarget();
  await ensureStudionetChain(w.provider, chainParamsFor(net.chainId));
  const c = writeClient(w, net);
  const txHash = (await c.writeContract({
    account: walletAccount(w.account),
    address: net.contract as Address,
    functionName: "accept_verdict",
    args: [w.caseId],
    value: 0n,
  })) as string;
  const message = extractReturnValue(await awaitConsensus(txHash, net));
  bustReadCache();
  return { txHash, message };
}

/** settle(case_id) — releases the stake to the winner recorded in the verdict.
    Gated on-chain: both parties must have accepted the verdict, or the
    verdict acceptance deadline must have passed. */
export async function settleOnChain(w: WalletArgs & { caseId: string }): Promise<string> {
  const net = writeTarget();
  await ensureStudionetChain(w.provider, chainParamsFor(net.chainId));
  const c = writeClient(w, net);
  const txHash = (await c.writeContract({
    account: walletAccount(w.account),
    address: net.contract as Address,
    functionName: "settle",
    args: [w.caseId],
    value: 0n,
  })) as string;
  await awaitConsensus(txHash, net);
  bustReadCache();
  return txHash;
}

/** accept_dispute(case_id) — the respondent locks in by attaching exactly the
    claimant's staked_amount as the tx value (the contract reverts on any other
    amount), which opens the evidence window. Only the respondent may call it,
    and only before the acceptance deadline. */
export async function acceptDisputeOnChain(
  w: WalletArgs & { caseId: string; stakeWei: bigint }
): Promise<string> {
  const net = writeTarget();
  await ensureStudionetChain(w.provider, chainParamsFor(net.chainId));
  const c = writeClient(w, net);
  const txHash = (await c.writeContract({
    account: walletAccount(w.account),
    address: net.contract as Address,
    functionName: "accept_dispute",
    args: [w.caseId],
    value: w.stakeWei,
  })) as string;
  await awaitConsensus(txHash, net);
  bustReadCache();
  return txHash;
}

/** reclaim_unaccepted_stake(case_id) — the claimant takes the stake back
    once the acceptance deadline has passed without the respondent accepting
    (the case is then cancelled). Rejected while the window is still open. */
export async function reclaimUnacceptedStakeOnChain(w: WalletArgs & { caseId: string }): Promise<string> {
  const net = writeTarget();
  await ensureStudionetChain(w.provider, chainParamsFor(net.chainId));
  const c = writeClient(w, net);
  const txHash = (await c.writeContract({
    account: walletAccount(w.account),
    address: net.contract as Address,
    functionName: "reclaim_unaccepted_stake",
    args: [w.caseId],
    value: 0n,
  })) as string;
  await awaitConsensus(txHash, net);
  bustReadCache();
  return txHash;
}


