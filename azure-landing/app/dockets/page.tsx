"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import { lifecycle } from "../lib/data";
import { CASE_SCAN_CEILING, docketFilter, evidenceDisplay, explorerAddress, fetchLiveCases, formatGen, getNetId, isLive, loadCachedLiveCases, type AzureCase } from "../lib/contract";
import { shortAddress } from "../lib/wallet";

const FILTERS = ["All", "Verdict Issued", "Verdict awaiting acceptance", "Evidence window", "Awaiting acceptance", "Cancelled"] as const;

/** Status chip styles for the on-chain rows. */
const chip = (status: string) =>
  status === "Verdict Issued"
    ? { background: "var(--color-accent-soft)", color: "var(--color-accent)", border: "1px solid color-mix(in oklch, var(--color-accent) 18%, transparent)" }
    : { background: "var(--color-paper-3)", color: "var(--color-ink-dim)", border: "1px solid var(--color-rule)" };

/** One on-chain case row: the docket renders the chain and nothing else. */
function LiveCaseRow({ c, open, onToggle }: { c: AzureCase; open: boolean; onToggle: () => void }) {
  const steps = [
    { tag: "file_dispute", note: "stake escrowed", done: true },
    {
      tag: "accept_dispute",
      note:
        c.status === "pending_acceptance"
          ? "awaiting the respondent's matching stake"
          : c.status === "cancelled"
            ? "never accepted — stake reclaimed"
            : "accepted",
      done: c.status !== "pending_acceptance" && c.status !== "cancelled",
    },
    { tag: "submit_evidence · claimant", note: c.claimant_evidence ? "on-chain" : "pending", done: !!c.claimant_evidence },
    { tag: "submit_evidence · respondent", note: c.respondent_evidence ? "on-chain" : "pending", done: !!c.respondent_evidence },
    {
      tag: "approve_case_evidence",
      note:
        !(c.claimant_evidence && c.respondent_evidence)
          ? "pending — needs both submissions"
          : c.claimant_evidence_approved && c.respondent_evidence_approved
            ? "both parties approved"
            : "awaiting approvals",
      done: !!(c.claimant_evidence_approved && c.respondent_evidence_approved),
    },
    { tag: "request_verdict", note: c.verdict ? "consensus reached" : c.status === "consensus" ? "running" : "pending", done: !!c.verdict },
    {
      tag: "accept_verdict",
      note:
        c.status === "settled_pending"
          ? c.claimant_verdict_accepted && c.respondent_verdict_accepted
            ? "both parties accepted"
            : "awaiting blind acceptances"
          : c.status === "settled"
            ? "both parties accepted"
            : "pending verdict",
      done: c.status === "settled",
    },
    { tag: "settle", note: c.status === "settled" ? "stake released" : c.status === "cancelled" ? "n/a — reclaimed" : "pending", done: c.status === "settled" },
  ];
  return (
    <div style={{ borderTop: "1px solid var(--color-rule)" }}>
      <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4 text-left transition hover:bg-[var(--color-paper-3)] sm:gap-x-6">
        <span className="font-mono text-sm font-medium" style={{ color: "var(--color-accent)" }}>{c.case_id}</span>
        <span className="whitespace-nowrap font-mono text-xs" style={{ color: "var(--color-ink-dim)" }}>{shortAddress(c.claimant)} vs {shortAddress(c.respondent)}</span>
        <span className="whitespace-nowrap font-mono text-xs">{formatGen(c.staked_amount)} GEN</span>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px]" style={chip(docketFilter(c.status))}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: docketFilter(c.status) === "Verdict Issued" ? "var(--color-accent)" : "var(--color-ink-faint)" }} />
          {docketFilter(c.status)}
        </span>
        <span className="ml-auto flex items-center gap-3 font-mono text-xs" style={{ color: "var(--color-ink-faint)" }}>
          <span className="hidden sm:inline">{c.terms.slice(0, 28)}{c.terms.length > 28 ? "…" : ""}</span>
          <span className={`transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
        </span>
      </button>

      {open && (
        <div className="border-t px-5 py-6" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper)" }}>
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 sm:col-span-5">
              <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>Lifecycle</p>
              <ol className="relative mt-3 pl-5">
                <span className="absolute left-[6px] top-1.5 bottom-1.5 w-px" style={{ background: "var(--color-rule)" }} />
                {steps.map((s) => (
                  <li key={s.tag} className="relative mb-3 last:mb-0">
                    <span className="absolute -left-5 top-1 flex h-3 w-3 items-center justify-center rounded-full text-[8px]" style={{ background: s.done ? "var(--color-accent)" : "var(--color-paper-4)", color: "var(--color-paper)" }}>
                      {s.done ? "✓" : ""}
                    </span>
                    <code className="font-mono text-xs" style={{ color: "var(--color-ink)" }}>{s.tag}</code>
                    <span className="ml-2 font-mono text-[11px]" style={{ color: s.done ? "var(--color-ink-dim)" : "var(--color-ink-fainter)" }}>{s.note}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>Contract terms</p>
              <p className="mt-1.5 min-w-0 break-words text-xs leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>{c.terms || "—"}</p>
              <div className="mt-4 space-y-1 font-mono text-[10px]" style={{ color: "var(--color-ink-faint)" }}>
                <p>claimant <a href={explorerAddress(c.claimant)} target="_blank" rel="noreferrer" className="underline underline-offset-4">{shortAddress(c.claimant)}</a></p>
                <p>respondent <a href={explorerAddress(c.respondent)} target="_blank" rel="noreferrer" className="underline underline-offset-4">{shortAddress(c.respondent)}</a></p>
              </div>
            </div>
            <div className="col-span-12 sm:col-span-7">
              <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>Evidence on record</p>
              <div className="mt-3 grid gap-3">
                <div className="rounded-[14px] border p-4" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}>
                  <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>Claimant</p>
                  <p className="mt-1.5 min-w-0 break-words whitespace-pre-wrap text-xs leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>{evidenceDisplay(c.claimant_evidence) ?? "Not yet submitted."}</p>
                </div>
                <div className="rounded-[14px] border p-4" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}>
                  <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>Respondent</p>
                  <p className="mt-1.5 min-w-0 break-words whitespace-pre-wrap text-xs leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>{evidenceDisplay(c.respondent_evidence) ?? "Not yet submitted."}</p>
                </div>
              </div>
              {c.verdict && (
                <div className="mt-4 rounded-[14px] border p-4" style={{ borderColor: "var(--color-accent)", background: "var(--color-accent-soft)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-display text-sm" style={{ color: "var(--color-accent)" }}>
                      {c.winner ? (c.winner === c.claimant ? "For the claimant" : c.winner === c.respondent ? "For the respondent" : `For ${shortAddress(c.winner)}`) : "Verdict"}
                    </p>
                    <span className="font-mono text-[10px]" style={{ color: "var(--color-ink-faint)" }}>validator consensus · on-chain</span>
                  </div>
                  <p className="mt-2 min-w-0 break-words text-xs leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>{c.verdict}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DocketsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  // The docket reads the active net's contract; switching nets restarts the
  // poll below (bustReadCache already dropped the previous net's cache).
  const netId = getNetId();

  // Live reads — sequential get_case("AZ-1"…) over the deployed contract.
  // Seeded from the sessionStorage read cache so a reload paints the docket
  // instantly instead of flashing "Reading cases…" while the poll runs
  // (seeded from cache after hydration — see the effect below).
  const live = isLive();
  const [liveCases, setLiveCases] = useState<AzureCase[] | null>(null);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [liveOpen, setLiveOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    let alive = true;
    // Drop the previous net's rows so a switch can't flash stale cases.
    setLiveCases(null);
    setLiveErr(null);
    // Seed from the sessionStorage cache after hydration — reading storage
    // during the first client render (a useState initializer) desyncs it from
    // the SSR HTML and trips a hydration mismatch on every warm reload. The
    // timeout keeps the setState out of the synchronous effect body; the poll
    // below refreshes with live cases right after anyway.
    const seed = window.setTimeout(() => {
      const cached = loadCachedLiveCases();
      if (cached) setLiveCases(cached);
    }, 0);
    const load = () =>
      fetchLiveCases()
        .then((cs) => {
          if (alive) {
            setLiveCases(cs);
            setLiveErr(null);
          }
        })
        .catch((err) => {
          if (alive) setLiveErr(err instanceof Error ? err.message : "Could not read the contract.");
        });
    load();
    const id = window.setInterval(() => {
      // Skip the enumeration while the tab is hidden — the Studio RPC rate-limits per IP.
      if (document.visibilityState !== "visible") return;
      load();
    }, 30000); // keep the ledger fresh
    return () => {
      alive = false;
      window.clearTimeout(seed);
      window.clearInterval(id);
    };
  }, [live, netId]);

  const visibleLive = useMemo(() => {
    if (!liveCases) return [];
    return filter === "All" ? liveCases : liveCases.filter((c) => docketFilter(c.status) === filter);
  }, [liveCases, filter]);

  // Counts come straight from the live on-chain cases; nothing else is listed.
  const counts = useMemo(() => {
    const cs = liveCases ?? [];
    return {
      total: cs.length,
      verdicts: cs.filter((c) => c.status === "settled" || c.status === "settled_pending").length,
      inProgress: cs.filter((c) => c.status === "pending_acceptance" || c.status === "evidence_open" || c.status === "consensus").length,
      loaded: liveCases !== null,
    };
  }, [liveCases]);

  return (
    <div className="grain min-h-screen" style={{ background: "var(--color-paper)", color: "var(--color-ink)" }}>
      <SiteHeader />
      <section
        id="main"
        className="landing-section"
        style={{ "--section-photo": "url('/images/marketplace-bg.jpg')" } as CSSProperties}
      >
        <div className="mx-auto max-w-[1280px] px-6 sm:px-8 pt-12 sm:pt-16 pb-10">
          <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: "var(--color-accent)" }}>Docket History</p>
          <h1 className="mt-3 font-display text-[32px] min-[420px]:text-[38px] sm:text-[54px] leading-[0.9] tracking-[-0.04em]">Every dispute leaves a record.</h1>
          <p className="mt-3 font-mono text-xs" style={{ color: "var(--color-ink-faint)" }}>Public ledger · GenLayer · time-stamped · no deletions</p>
        </div>
      </section>
      <main className="mx-auto max-w-[1280px] px-6 sm:px-8 pb-16">
        <div className="mt-10 rounded-[16px] border p-5" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}>
          <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>Latest chain activity</p>
          <div className="no-scrollbar mt-3 space-y-1.5 overflow-x-auto">
            {!live && (
              <p className="whitespace-nowrap font-mono text-xs" style={{ color: "var(--color-ink-dim)" }}>
                Docket not connected - no Azure contract configured on {netId === "studionet" ? "studionet (61999)" : "studio-dev (61997)"} - set NEXT_PUBLIC_CONTRACT_STUDIO_DEV or NEXT_PUBLIC_CONTRACT_STUDIONET in .env.local to read live cases.
              </p>
            )}
            {live && liveErr && (
              <p className="whitespace-nowrap font-mono text-xs" style={{ color: "var(--color-breach)" }}>{liveErr}</p>
            )}
            {live && !liveErr && liveCases === null && (
              <p className="whitespace-nowrap font-mono text-xs" style={{ color: "var(--color-ink-dim)" }}>Reading the contract...</p>
            )}
            {liveCases !== null && liveCases.length === 0 && (
              <p className="whitespace-nowrap font-mono text-xs" style={{ color: "var(--color-ink-dim)" }}>
                No cases on chain yet - AZ-1 is yours to open on /file.
              </p>
            )}
            {(liveCases ?? []).slice(-4).reverse().map((c) => (
              <p key={c.case_id} className="flex items-center gap-2 whitespace-nowrap font-mono text-xs" style={{ color: "var(--color-ink)" }}>
                <span className="animate-pulse" style={{ color: "var(--color-accent)" }}>●</span>
                {c.case_id} · {docketFilter(c.status)} · {formatGen(c.staked_amount)} GEN · {c.terms.slice(0, 36)}{c.terms.length > 36 ? "…" : ""}
                <span className="rounded-full border px-1.5 font-mono text-[9px] uppercase tracking-widest" style={{ borderColor: "var(--color-accent)", color: "var(--color-accent)" }}>live</span>
              </p>
            ))}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-12 items-start gap-8">
          <div className="col-span-12 space-y-6 lg:sticky lg:top-[84px] lg:col-span-5">
            <div className="rounded-[20px] border p-6" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}>
              <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>Ledger at a glance</p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { k: "Cases listed", v: counts.total },
                  { k: "Verdicts issued", v: counts.verdicts },
                  { k: "In progress", v: counts.inProgress },
                ].map((c, i) => (
                  <div key={c.k} className={`rounded-[14px] border px-4 py-3 ${i === 2 ? "col-span-2 sm:col-span-1" : ""}`} style={{ borderColor: "var(--color-rule)", background: "var(--color-paper)" }}>
                    <p className="font-display text-2xl">{counts.loaded ? c.v : "\u2014"}</p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>{c.k}</p>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--color-ink-fainter)" }}>
                {counts.loaded
                  ? `Counts are live reads of the deployed Azure contract (sequential reads over AZ-1…AZ-${Math.max(counts.total, 1)}, refreshed every 30s) — ${counts.verdicts} of ${counts.total} already carry a verdict. The chain is the record.`
                  : liveErr
                    ? `Live read failed: ${liveErr}`
                    : live
                      ? "Reading the deployed contract - counts land with the first live read."
                      : `Not connected - no Azure contract configured on ${netId === "studionet" ? "studionet (61999)" : "studio-dev (61997)"} - set NEXT_PUBLIC_CONTRACT_STUDIO_DEV or NEXT_PUBLIC_CONTRACT_STUDIONET in .env.local to read the live docket.`}
              </p>
            </div>

            {liveCases && liveCases.length > 0 && (() => {
              const hearing = liveCases.find((c) => c.status === "consensus") ?? liveCases.find((c) => c.status === "evidence_open") ?? liveCases[0];
              return (
                <div className="rounded-[20px] border p-6" style={{ borderColor: "var(--color-accent)", background: "var(--color-paper-2)" }}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>Now on chain · {hearing.case_id}</p>
                    <span className="rounded-full px-3 py-1 font-mono text-[10px]" style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}>{docketFilter(hearing.status)}</span>
                  </div>
                  <p className="mt-1 font-mono text-[11px]" style={{ color: "var(--color-ink-dim)" }}>{shortAddress(hearing.claimant)} vs {shortAddress(hearing.respondent)} · {formatGen(hearing.staked_amount)} GEN</p>
                  <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>{hearing.terms || "No terms recorded."}</p>
                  <div className="mt-3 font-mono text-[10px]" style={{ color: "var(--color-ink-fainter)" }}>
                    evidence {hearing.claimant_evidence ? "✓" : "—"} / {hearing.respondent_evidence ? "✓" : "—"} · verdict {hearing.verdict ? "✓" : "pending"}
                  </div>
                </div>
              );
            })()}

            <div className="rounded-[20px] border p-6" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}>
              <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>Every case runs the same script</p>
              <ul className="mt-4 space-y-2.5 font-mono text-xs" style={{ color: "var(--color-ink-dim)" }}>
                {lifecycle.map((s) => (
                  <li key={s.num} className="flex items-center gap-2">
                    <span style={{ color: "var(--color-accent)" }}>{s.num}</span>
                    <span>{s.title}</span>
                    <code className="ml-auto" style={{ color: "var(--color-ink-faint)" }}>{s.tag}</code>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-7">
            {live && (
              <div className="flex flex-wrap gap-2">
                {FILTERS.map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className="rounded-full border px-4 py-1.5 font-mono text-xs" style={filter === f ? { borderColor: "var(--color-accent)", color: "var(--color-accent)", background: "var(--color-accent-soft)" } : { borderColor: "var(--color-rule)", color: "var(--color-ink-dim)", background: "var(--color-paper-2)" }}>
                    {f}
                  </button>
                ))}
              </div>
            )}

            {live && (
              <div className="mt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-accent)" }}>On-chain docket · live contract reads</p>
                  {liveErr && <span className="font-mono text-[10px]" style={{ color: "var(--color-breach)" }}>{liveErr}</span>}
                </div>
                <div className="mt-3 overflow-hidden rounded-[20px] border" style={{ borderColor: "var(--color-accent)", background: "var(--color-paper-2)" }}>
                  {liveCases === null && (
                    <p className="px-6 py-8 text-center font-mono text-sm" style={{ color: "var(--color-ink-faint)" }}>Reading cases AZ-1…N from the contract…</p>
                  )}
                  {liveCases !== null && visibleLive.length === 0 && (
                    <p className="px-6 py-8 text-center font-mono text-sm" style={{ color: "var(--color-ink-faint)" }}>
                      {liveCases.length === 0 ? "No disputes filed yet — AZ-1 is yours to open on /file." : "No on-chain cases under this filter."}
                    </p>
                  )}
                  {visibleLive.map((c) => (
                    <LiveCaseRow key={c.case_id} c={c} open={liveOpen === c.case_id} onToggle={() => setLiveOpen(liveOpen === c.case_id ? null : c.case_id)} />
                  ))}
                </div>
                <p className="mt-2 font-mono text-[10px]" style={{ color: "var(--color-ink-fainter)" }}>
                  Live on-chain reads · {liveCases?.length ?? 0} case(s) found · refreshed every 30s
                  {liveCases !== null && liveCases.length >= CASE_SCAN_CEILING &&
                    ` · scan stops at AZ-${CASE_SCAN_CEILING} — anything newer stays readable on the explorer`}
                </p>
              </div>
            )}

            {!live && (
              <div className="mt-6 overflow-hidden rounded-[20px] border" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}>
                <p className="px-6 py-8 text-center font-mono text-sm" style={{ color: "var(--color-ink-faint)" }}>
                  Docket not connected - no Azure contract configured on {netId === "studionet" ? "studionet (61999)" : "studio-dev (61997)"} - set NEXT_PUBLIC_CONTRACT_STUDIO_DEV or NEXT_PUBLIC_CONTRACT_STUDIONET in .env.local to read live cases from the chain.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter
        photo="/images/marketplace-bg.jpg"
        copy={{
          headline: "No staging, no seeds. These rows are read straight from the contract.",
          footnote: "© 2026 Azure. Rows are live on-chain reads only — nothing fabricated.",
        }}
      />
    </div>
  );
}