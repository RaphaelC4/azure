/**
 * Court Audit data — feeds the live audit panel on the homepage.
 *
 * AUDIT_SOURCE selects where validator rankings come from:
 *  - "demo":     seeded in-browser simulation. Scores drift on a timer and
 *                the ranking re-sorts, so the audit reads live. No network,
 *                works offline.
 *  - "contract": reads the deployed Azure contract on GenLayer through
 *                fetchLiveCases (sequential public get_case reads, no
 *                wallet needed). The contract exposes one consensus
 *                verdict per case — per-validator scores are NOT on-chain
 *                — so fetchRankings() returns [] and the bench renders a
 *                note instead of fabricated bars, while
 *                fetchContractAudit() supplies real case metadata and the
 *                verdict reasoning.
 */

import { docketFilter, fetchLiveCases, formatGen, isLive } from "./contract";
import { shortAddress } from "./wallet";

export type AuditSource = "demo" | "contract";

/** Live contract reads enabled? (.env.local carries the address.) */
export const AUDIT_SOURCE: AuditSource = "contract";

export interface ValidatorScore {
  /** Validator agent code, e.g. "DAT-07". */
  id: string;
  /** Human role label, e.g. "Data". */
  role: string;
  /** Evidence score, 0–100. */
  score: number;
}

export interface AuditCaseMeta {
  caseId: string;
  claimant: string;
  claimantRole: string;
  respondent: string;
  respondentRole: string;
  stake: string;
  filed: string;
  settledAfter: string;
  block: string;
  /** Tolerance band — a verdict lands when scores fall inside [lo, hi]. */
  bandLo: number;
  bandHi: number;
  finding: string;
}

export const auditCase: AuditCaseMeta = {
  caseId: "AZ-0142",
  claimant: "DLV-11",
  claimantRole: "Delivery",
  respondent: "ESC-04",
  respondentRole: "Escrow",
  stake: "1,850 USDC",
  filed: "09 Jun 2026 · 14:02 UTC",
  settledAfter: "04m 12s",
  block: "9,412,033",
  bandLo: 70,
  bandHi: 84,
  finding:
    "Delivery confirmation did not match the timestamp window in contract terms. Validators reached consensus within tolerance on partial non-performance.",
};

/** Demo loop timing: ~10s of live scoring, then the verdict holds for ~7s. */
export const AUDIT_TICK_MS = 1400;
export const AUDIT_TICKS_BEFORE_VERDICT = 7;
export const AUDIT_HOLD_TICKS = 5;

/**
 * The bench hearing the demo case AZ-0142. Used only when AUDIT_SOURCE is
 * "demo" — in contract mode no scores are drawn at all.
 */
const DEMO_VALIDATORS: ValidatorScore[] = [
  { id: "DAT-07", role: "Data", score: 78 },
  { id: "CMP-19", role: "Compute", score: 82 },
  { id: "LOG-02", role: "Logistics", score: 74 },
  { id: "NET-05", role: "Network", score: 81 },
  { id: "SEC-09", role: "Security", score: 76 },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** One demo tick: each score drifts a little and stays plausible. */
export function tickScores(current: ValidatorScore[]): ValidatorScore[] {
  return current.map((v) => ({
    ...v,
    score: clamp(v.score + Math.round((Math.random() - 0.5) * 6), 55, 95),
  }));
}

/**
 * The audit the contract can actually back: one real case from the docket
 * plus its consensus reasoning. Per-validator scores are not exposed
 * on-chain, so the UI never draws bars for this source.
 */
export interface ContractAudit {
  meta: AuditCaseMeta;
  verdict: string | null;
  winnerLabel: string | null;
  /** Full party addresses for explorer links (null when absent/malformed). */
  claimantAddr: string | null;
  respondentAddr: string | null;
  status: string;
  casesScanned: number;
  /** Position of the featured case in the rotation pool (0-based). */
  featuredIndex: number;
  /** Size of the rotation pool the audit cycles through. */
  featuredTotal: number;
}

/** How often the Court Audit advances to the next featured case. */
export const AUDIT_ROTATE_MS = 15000;

/**
 * Deterministically pick which docket entry the audit features. The pool is
 * the reveal-eligible subset (settled cases first — their verdicts are
 * actually revealable — then any case with a recorded verdict, else the
 * whole docket) and tick cycles through it, so every case takes a turn in
 * the Court Audit instead of the first settled case pinning the spot.
 */
function pickAuditCase<T>(pool: T[], tick: number): { target: T; index: number } | null {
  if (pool.length === 0) return null;
  const index = ((tick % pool.length) + pool.length) % pool.length;
  return { target: pool[index], index };
}

export async function fetchContractAudit(tick = 0): Promise<ContractAudit> {
  if (!isLive()) {
    throw new Error("No Azure contract configured on the active net - set NEXT_PUBLIC_CONTRACT_STUDIO_DEV (61997) or NEXT_PUBLIC_CONTRACT_STUDIONET (61999) in .env.local.");
  }
  const cases = await fetchLiveCases();
  if (cases.length === 0) {
    throw new Error("No cases found on the contract yet — file one on /file to seed the audit.");
  }
  // Rotation pool: settled cases (verdict revealable) > verdict-carrying
  // cases > the whole docket. tick selects which entry is featured.
  const settledCases = cases.filter((c) => c.status === "settled");
  const verdictedCases = cases.filter((c) => c.verdict);
  const pool = settledCases.length > 0 ? settledCases : verdictedCases.length > 0 ? verdictedCases : cases;
  const picked = pickAuditCase(pool, tick);
  if (!picked) {
    throw new Error("No cases found on the contract yet — file one on /file to seed the audit.");
  }
  const target = picked.target;
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
  // Blind-reveal rule: the verdict reasoning and winner are public only for
  // settled cases. During settled_pending the app shows the ceremony state,
  // never the judgment itself (the contract's raw storage is technically
  // public — this gate is the app-layer half of the blind ceremony).
  const revealedVerdict = target.status === "settled" ? target.verdict : null;
  const winnerLabel = revealedVerdict && target.winner
    ? eq(target.winner, target.claimant)
      ? `${shortAddress(target.claimant)} (claimant)`
      : eq(target.winner, target.respondent)
        ? `${shortAddress(target.respondent)} (respondent)`
        : shortAddress(target.winner)
    : null;
  return {
    meta: {
      caseId: target.case_id,
      claimant: shortAddress(target.claimant),
      claimantRole: "claimant",
      respondent: shortAddress(target.respondent),
      respondentRole: "respondent",
      stake: `${formatGen(target.staked_amount)} GEN`,
      filed: "on-chain record",
      settledAfter: revealedVerdict
        ? "settled"
        : target.status === "settled_pending"
          ? "verdict in · awaiting acceptance"
          : "pending verdict",
      block: "—",
      bandLo: auditCase.bandLo,
      bandHi: auditCase.bandHi,
      finding:
        revealedVerdict ??
        `Case is ${docketFilter(target.status).toLowerCase()} — no verdict reasoning on-chain yet.`,
    },
    verdict: revealedVerdict,
    winnerLabel,
    claimantAddr: isAddr(target.claimant) ? target.claimant : null,
    respondentAddr: isAddr(target.respondent) ? target.respondent : null,
    status: target.status,
    casesScanned: cases.length,
    featuredIndex: picked.index,
    featuredTotal: pool.length,
  };
}

/**
 * Snapshot of the current validator rankings. Demo mode returns the seeded
 * bench; contract mode returns an empty list — the chain exposes no
 * per-validator scores, and we don't fabricate bars for what isn't there.
 * Kept async so the UI contract is identical for both sources.
 */
export async function fetchRankings(): Promise<ValidatorScore[]> {
  if (AUDIT_SOURCE === "contract") return [];
  return DEMO_VALIDATORS.map((v) => ({ ...v }));
}