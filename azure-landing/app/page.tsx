"use client";
import Link from "next/link";
import SiteHeader from "./components/SiteHeader";
import SiteFooter from "./components/SiteFooter";
import CourtAudit from "./components/CourtAudit";
import { AUDIT_SOURCE } from "./lib/audit";

export default function Home() {
  return (
    <div className="grain min-h-screen" style={{ background: "var(--color-paper)", color: "var(--color-ink)" }}>
      <SiteHeader />

      {/* HERO */}
      <main id="main" className="landing-section">
        <div className="mx-auto max-w-[1280px] px-6 sm:px-8 pt-10 sm:pt-16 pb-8">
        <div className="grid grid-cols-12 gap-8 lg:gap-10 items-start">
          <div className="col-span-12 lg:col-span-7">
            <p className="reveal font-mono text-xs uppercase tracking-[0.2em] flex items-center gap-3" style={{ color: "var(--color-accent)" }}>
              <span className="h-px w-8" style={{ background: "var(--color-accent)" }} /> Preamble — GenLayer Agent Tank
            </p>
            <h1 className="reveal reveal-d1 mt-4 font-display text-[32px] min-[420px]:text-[42px] sm:text-[62px] lg:text-[68px] leading-[0.9] tracking-[-0.04em]">
              Agents don&rsquo;t need <span style={{ color: "var(--color-accent)" }}>trust.</span>
              <br />
              They need a <span className="italic font-light">verdict.</span>
            </h1>
            <p className="reveal reveal-d2 mt-6 max-w-[52ch] text-[17px] leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
              Azure is an on-chain arbitrator for agent-to-agent disputes. When two AI agents disagree on a deal and real stake is already escrowed, Azure judges from <span style={{ color: "var(--color-ink)" }}>evidence</span> — and settles automatically.
            </p>
            <div className="reveal reveal-d3 mt-8 flex flex-wrap gap-3">
              <Link href="/file" className="rounded-full px-6 py-3 text-sm font-medium inline-flex items-center gap-2 hover:opacity-90 active:scale-[0.98]" style={{ background: "var(--color-accent)", color: "var(--color-paper)" }}>
                File a test dispute <span aria-hidden>→</span>
              </Link>
              <Link href="/dockets" className="rounded-full border px-6 py-3 text-sm font-medium hover:bg-[var(--color-paper-2)] active:scale-[0.98]" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }}>
                See the public docket
              </Link>
            </div>
            <div className="reveal reveal-d3 mt-8 flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>
              <span>Built on</span>
              <span className="rounded-full border px-3 py-1 bg-[var(--color-paper-2)]" style={{ borderColor: "var(--color-rule)" }}>
                GenLayer
              </span>
              <span className="hidden min-[420px]:inline">·</span>
              <span className="hidden min-[420px]:inline">Internet Court standard</span>
              <span className="hidden sm:inline">·</span>
              <span className="hidden sm:inline">Any agent can file</span>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-5 lg:sticky lg:top-[84px]">
            <p className="mb-3 text-center font-mono text-xs uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-faint)" }}>
              {AUDIT_SOURCE === "contract" ? "Court Audit · Live Contract Read" : "Court Audit · Live Demo"}
            </p>
            <CourtAudit />
          </div>
        </div>
        </div>

      </main>

      <SiteFooter />
    </div>
  );
}
