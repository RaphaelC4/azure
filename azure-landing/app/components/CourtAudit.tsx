"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AzureLogo } from "./Logo";
import { useSpotlight } from "../lib/useSpotlight";
import {
  AUDIT_HOLD_TICKS,
  AUDIT_ROTATE_MS,
  AUDIT_SOURCE,
  AUDIT_TICKS_BEFORE_VERDICT,
  AUDIT_TICK_MS,
  auditCase as demoAuditCase,
  fetchContractAudit,
  fetchRankings,
  tickScores,
  type ContractAudit,
  type ValidatorScore,
} from "../lib/audit";
import { explorerAddress, getNetId, isLive } from "../lib/contract";

type Phase = "audit" | "settled";
const CYCLE_TICKS = AUDIT_TICKS_BEFORE_VERDICT + AUDIT_HOLD_TICKS;

function MetaRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-baseline justify-between gap-4 border-b border-dashed py-1.5 last:border-b-0"
      style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }}
    >
      <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>
        {k}
      </span>
      <span className="font-mono text-[11px] leading-none">{children}</span>
    </div>
  );
}

/**
 * One party of the audited case. When the case comes from the contract the
 * chip links to the party's address on the GenLayer explorer (same pattern
 * as the dockets rows); the seeded demo agent codes stay plain text.
 */
function PartyChip({ label, role, right, href }: { label: string; role: string; right?: boolean; href?: string }) {
  const style = { background: "var(--color-paper-3)", border: "1px solid var(--color-rule)" };
  const inner = (
    <>
      {label}
      <span className="ml-1.5 text-[9px] uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>
        {role}
      </span>
    </>
  );
  const cls = `rounded-[8px] px-2.5 py-1.5 font-mono text-xs font-medium min-w-0 max-w-full ${right ? " text-right" : ""}`;
  if (!href) {
    return (
      <span className={cls} style={style}>
        {inner}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="View this address on the GenLayer explorer"
      className={`${cls} underline-offset-4 transition hover:underline`}
      style={style}
    >
      {inner}
    </a>
  );
}

/**
 * Court Audit. A formal audit document for the hero: case metadata, the
 * disputed stake, and the validator bench ranking evidence scores against
 * the tolerance band. AUDIT_SOURCE="demo" runs the seeded AZ-0142 loop;
 * AUDIT_SOURCE="contract" reads a real case from the deployed Azure
 * contract (metadata + consensus verdict - no fabricated validator bars),
 * rotating through the docket's reveal-eligible cases, and renders the
 * full document immediately with neutral placeholders until the read
 * lands — never the demo case.
 */
/** Subscribe to prefers-reduced-motion without setState-in-effect. Older
    browsers without matchMedia (pre Chrome 130 / Safari 18 / Firefox 137)
    would throw during subscribe, so guard it and treat motion as enabled. */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function matchMediaSafe(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}
function subscribeReducedMotion(onChange: () => void) {
  const mq = matchMediaSafe(REDUCED_MOTION_QUERY);
  if (!mq) return () => {};
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export default function CourtAudit() {
  const spotlightRef = useSpotlight<HTMLDivElement>();
  // The audit reads the active net's contract; netId re-runs the read
  // effects below on a studio-dev ⇄ studionet switch.
  const netId = getNetId();
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => matchMediaSafe(REDUCED_MOTION_QUERY)?.matches ?? false,
    () => false
  );
  const [rankings, setRankings] = useState<ValidatorScore[]>([]);
  const [livePhase, setLivePhase] = useState<Phase>("audit");
  const [error, setError] = useState<string | null>(null);
  // Contract mode: one real case from the deployed Azure contract, advanced
  // every AUDIT_ROTATE_MS so each docket entry takes a turn. Null while
  // reading (the document renders placeholders until the first read lands);
  // null forever in demo mode.
  const [liveAudit, setLiveAudit] = useState<ContractAudit | null>(null);
  const [tick, setTick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const prevTops = useRef<Map<string, number> | null>(null);

  // Seed the rankings from the configured source (demo bench, or [] when
  // the contract exposes no per-validator scores).
  useEffect(() => {
    let alive = true;
    fetchRankings()
      .then((r) => {
        if (alive) setRankings(r);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Audit source unavailable.");
      });
    return () => {
      alive = false;
    };
  }, [netId]);

  // Contract source: real case metadata + consensus verdict/reasoning, for
  // whichever docket entry `tick` features right now. Re-reads on rotation;
  // the previously featured case stays on screen until the new read lands.
  useEffect(() => {
    if (AUDIT_SOURCE !== "contract") return;
    let alive = true;
    // A net switch drops the previous net's featured case immediately —
    // placeholders show until this net's read lands.
    setLiveAudit(null);
    fetchContractAudit(tick)
      .then((a) => {
        if (alive) {
          setLiveAudit(a);
          setError(null);
        }
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Contract audit unavailable.");
      });
    return () => {
      alive = false;
    };
  }, [netId, tick]);

  // Rotation: advance to the next reveal-eligible case on a slow cadence
  // (or immediately via the "next case" control) so the audit never pins
  // to a single case.
  useEffect(() => {
    if (AUDIT_SOURCE !== "contract") return;
    const id = window.setInterval(() => setTick((t) => t + 1), AUDIT_ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);

  // Demo loop — every state update happens inside the interval callback (an
  // external system), never synchronously in the effect body. While the
  // audit is live, scores drift and the bench re-ranks; the verdict then
  // holds before the cycle reseeds. With reduced motion the loop never
  // starts, so the document renders in its settled state.
  useEffect(() => {
    if (error || reduced || AUDIT_SOURCE !== "demo") return;
    let t = 0;
    const id = window.setInterval(() => {
      t = (t + 1) % CYCLE_TICKS;
      setLivePhase(t < AUDIT_TICKS_BEFORE_VERDICT ? "audit" : "settled");
      if (t === 0) {
        // Cycle wrapped — reseed the bench for the next audit pass.
        fetchRankings()
          .then((r) => setRankings(r))
          .catch(() => {});
      } else if (t < AUDIT_TICKS_BEFORE_VERDICT) {
        setRankings((r) => tickScores(r));
      }
    }, AUDIT_TICK_MS);
    return () => window.clearInterval(id);
  }, [error, reduced]);

  // The audit document renders either source: the real case read off the
  // contract, or the seeded AZ-0142 demo case (demo mode only - in contract
  // mode the demo meta is masked by the `reading` placeholders below).
  const auditCase = liveAudit?.meta ?? demoAuditCase;
  // Contract mode with no read yet: render the full document now with
  // neutral placeholders instead of holding back a skeleton card.
  const reading = AUDIT_SOURCE === "contract" && !liveAudit;
  const contractVerdict = AUDIT_SOURCE === "contract" && !!liveAudit?.verdict;
  const phase: Phase = reduced || error || contractVerdict ? "settled" : livePhase;
  const ordered = useMemo(() => [...rankings].sort((a, b) => b.score - a.score), [rankings]);
  const inBand = (s: number) => s >= auditCase.bandLo && s <= auditCase.bandHi;

  // FLIP: when a tick re-sorts the bench, animate rows to their new rank.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || reduced) {
      prevTops.current = null;
      return;
    }
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-vcode]"));
    const next = new Map<string, number>();
    for (const row of rows) next.set(row.dataset.vcode as string, row.getBoundingClientRect().top);
    if (prevTops.current) {
      for (const row of rows) {
        const code = row.dataset.vcode as string;
        const prev = prevTops.current.get(code);
        const cur = next.get(code);
        if (prev === undefined || cur === undefined || prev === cur) continue;
        row.style.transition = "none";
        row.style.transform = `translateY(${prev - cur}px)`;
        requestAnimationFrame(() => {
          row.style.transition = "transform 420ms var(--ease-out)";
          row.style.transform = "translateY(0)";
        });
      }
    }
    prevTops.current = next;
  }, [ordered, reduced]);

  // (The full document below renders immediately in contract mode; while
  // the first read is in flight `reading` masks the fields with neutral
  // placeholders — the demo case is never reachable in contract mode.)

  return (
    <div ref={spotlightRef} className="spotlight perforated glass rounded-[16px] pb-5 pl-5 pr-4 pt-5">
      {/* Document header */}
      <div
        className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider"
        style={{ color: "var(--color-ink-faint)" }}
      >
        <span>Court Audit · {reading ? "—" : auditCase.caseId}{liveAudit ? " · live" : ""}</span>
        <span
          aria-live="polite"
          className="rounded-full border px-2.5 py-1 flex items-center gap-1.5"
          style={
            phase === "settled"
              ? { borderColor: "var(--color-accent)", color: "var(--color-accent)", background: "var(--color-accent-soft)" }
              : { borderColor: "var(--color-rule)", color: "var(--color-ink-dim)", background: "var(--color-paper-3)" }
          }
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${phase === "audit" || reading ? "animate-pulse" : ""}`}
            style={{
              background: reading
                ? error
                  ? "var(--color-breach)"
                  : "var(--color-accent)"
                : phase === "settled"
                  ? "var(--color-accent)"
                  : "var(--color-success)",
            }}
          />
          {reading
            ? error
              ? "Unavailable"
              : "Reading chain"
            : phase === "settled"
              ? "Verdict Issued"
              : AUDIT_SOURCE === "contract"
                ? "Reading chain"
                : "Live Audit"}
        </span>
      </div>

      {/* Parties - explorer links when a real contract case backs the
          audit; demo agent codes stay plain text. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <PartyChip
          label={reading ? "—" : auditCase.claimant}
          role={reading ? "…" : auditCase.claimantRole}
          href={liveAudit?.claimantAddr ? explorerAddress(liveAudit.claimantAddr) : undefined}
        />
        <span className="font-mono text-[11px]" style={{ color: "var(--color-ink-faint)" }}>
          vs
        </span>
        <PartyChip
          label={reading ? "—" : auditCase.respondent}
          role={reading ? "…" : auditCase.respondentRole}
          right
          href={liveAudit?.respondentAddr ? explorerAddress(liveAudit.respondentAddr) : undefined}
        />
      </div>

      {/* Disputed stake + case record — merged, compact */}
      <div className="mt-4">
        <div className="flex items-end justify-between gap-3">
          <p className="font-display text-[26px] leading-none tracking-[-0.03em]" style={{ color: "var(--color-accent-bright)" }}>
            {reading ? "…" : auditCase.stake}
          </p>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]"
            style={
              phase === "settled" && !reading
                ? {
                    background: "color-mix(in oklch, var(--color-success) 12%, transparent)",
                    color: "var(--color-success)",
                    border: "1px solid color-mix(in oklch, var(--color-success) 45%, transparent)",
                  }
                : { background: "var(--color-paper-3)", color: "var(--color-ink-dim)", border: "1px solid var(--color-rule)" }
            }
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: reading ? "var(--color-accent)" : phase === "settled" ? "var(--color-success)" : "var(--color-accent)" }}
            />
            {reading ? (
              "Reading chain"
            ) : phase === "settled" ? (
              liveAudit?.status === "settled_pending" ? "Verdict in · awaiting acceptance" : "Escrow released"
            ) : AUDIT_SOURCE === "contract" ? (
              "Stake held"
            ) : (
              "Stake held · scoring"
            )}
          </span>
        </div>
        <div className="mt-2 border-t border-dashed pt-2" style={{ borderColor: "var(--color-rule)" }}>
          <MetaRow k="Filed">{reading ? "…" : auditCase.filed}</MetaRow>
          <div className="grid grid-cols-2 gap-3 pt-1.5">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>
                Settled in
              </p>
              <p className="mt-0.5 font-mono text-[11px] leading-none" style={{ color: "var(--color-ink)" }}>
                {reading ? "…" : auditCase.settledAfter}
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[9px] uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>
                Block
              </p>
              <p className="mt-0.5 font-mono text-[11px] leading-none" style={{ color: "var(--color-ink)" }}>
                {reading ? "…" : auditCase.block}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Validator rankings — the live part */}
      <div className="mt-3 rounded-lg p-3" style={{ background: "var(--color-paper-3)", border: "1px solid var(--color-rule)" }}>
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>
            Validator rankings
          </p>
          <p className="font-mono text-[10px]" style={{ color: "var(--color-ink-faint)" }}>
            Band {auditCase.bandLo}–{auditCase.bandHi}
          </p>
        </div>
        <div ref={listRef} className="mt-2 space-y-1">
          {ordered.map((v, i) => {
            const ok = inBand(v.score);
            return (
              <div key={v.id} data-vcode={v.id} className="flex items-center gap-2">
                <span
                  className="h-6 w-6 shrink-0 rounded-full border text-center font-mono text-[9px] leading-[22px]"
                  style={
                    i === 0
                      ? { borderColor: "var(--color-accent)", color: "var(--color-accent)", background: "var(--color-accent-soft)" }
                      : { borderColor: "var(--color-rule)", color: "var(--color-ink-faint)", background: "var(--color-paper-2)" }
                  }
                >
                  {i + 1}
                </span>
                <span className="w-16 shrink-0 font-mono text-[10px] leading-tight" style={{ color: "var(--color-ink)" }}>
                  {v.id}
                  <span className="ml-1 text-[8px] uppercase tracking-wider" style={{ color: "var(--color-ink-faint)" }}>
                    {v.role}
                  </span>
                </span>
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--color-paper-4)" }}>
                  <div
                    className="absolute inset-y-0"
                    style={{
                      left: `${auditCase.bandLo}%`,
                      right: `${100 - auditCase.bandHi}%`,
                      borderLeft: "1px dashed color-mix(in oklch, var(--color-evidence) 60%, transparent)",
                      borderRight: "1px dashed color-mix(in oklch, var(--color-evidence) 60%, transparent)",
                      background: "color-mix(in oklch, var(--color-evidence) 10%, transparent)",
                    }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                    style={{ width: `${v.score}%`, background: ok ? "var(--color-accent)" : "var(--color-breach)" }}
                  />
                </div>
                <span className="w-6 text-right font-mono text-[11px]" style={{ color: ok ? "var(--color-ink)" : "var(--color-breach)" }}>
                  {v.score}
                </span>
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: ok ? "var(--color-success)" : "var(--color-breach)" }}
                />
              </div>
            );
          })}
          {AUDIT_SOURCE === "contract" && reading && (
            <p className="animate-pulse font-mono text-[11px]" style={{ color: "var(--color-ink-dim)" }}>
              Reading the docket off-chain cache…
            </p>
          )}
          {AUDIT_SOURCE === "contract" && !reading && ordered.length === 0 && (
            <p className="font-mono text-[11px]" style={{ color: "var(--color-ink-dim)" }}>
              The contract records one consensus verdict per case — per-validator scores stay
              off-chain, so no bars are drawn rather than invented ones.
            </p>
          )}
          {error && (
            <p className="font-mono text-[11px]" style={{ color: "var(--color-breach)" }}>
              {error}
            </p>
          )}
        </div>
        <p className="mt-2 font-mono text-[9px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>
          {AUDIT_SOURCE === "contract"
            ? "Live contract read · consensus verdict only · no per-validator scores on-chain"
            : "Demo validator set · seeded scores"}
        </p>
      </div>

      {/* Finding */}
      <p className="mt-3 min-w-0 break-words text-[13px] leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
        {auditCase.finding}
      </p>
      {liveAudit?.winnerLabel && (
        <p className="mt-2 font-mono text-[11px]" style={{ color: "var(--color-accent)" }}>
          Consensus winner: {liveAudit.winnerLabel} · {liveAudit.casesScanned} case(s) scanned on-chain
        </p>
      )}

      {/* Footer + the wax-seal verdict stamp (kept, as decided) */}
      <div className="relative mt-4 flex items-center justify-between border-t pt-4" style={{ borderColor: "var(--color-rule)" }}>
        <div className="font-mono text-[11px] leading-snug" style={{ color: "var(--color-ink-faint)" }}>
          {AUDIT_SOURCE === "contract" ? (
            liveAudit ? (
              <>
                <span>
                  {`Case ${liveAudit.featuredIndex + 1} of ${liveAudit.featuredTotal} · `}
                  <button
                    type="button"
                    onClick={() => setTick((t) => t + 1)}
                    className="underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-75"
                    style={{ color: "var(--color-accent)" }}
                  >
                    next case ↻
                  </button>
                </span>
                <br />
                <span style={{ color: "var(--color-ink-dim)" }}>
                  {`Status · ${liveAudit.status} · rotates every ${AUDIT_ROTATE_MS / 1000}s`}
                </span>
              </>
            ) : (
              <span style={{ color: "var(--color-ink-dim)" }}>{error ? "Audit unavailable" : "Reading the docket…"}</span>
            )
          ) : (
            <>
              {`Settled · ${auditCase.settledAfter} after filing`}
              <br />
              <span style={{ color: "var(--color-ink-dim)" }}>{`GenLayer · block ${auditCase.block}`}</span>
            </>
          )}
        </div>
        <div
          className="seal flex h-[62px] w-[62px] flex-col items-center justify-center gap-0.5 rounded-full border-2 p-1 text-center"
          style={{
            borderColor: "var(--color-accent)",
            background: "var(--color-paper-2)",
            animation: reading ? "none" : "stampIn 700ms var(--ease-out) 400ms both",
            opacity: reading ? 0.35 : 1,
          }}
        >
          <AzureLogo size={20} className="text-[var(--color-accent-bright)]" bright />
          <p className="font-display text-[7px] uppercase tracking-widest leading-none" style={{ color: "var(--color-accent)" }}>
            Verdict
          </p>
        </div>
      </div>
    </div>
  );
}