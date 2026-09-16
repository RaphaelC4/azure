import Link from "next/link";
import { AzureLogo, GenLayerMark } from "./Logo";
import { isLive } from "../lib/contract";

/** Per-page footer copy. Every field is optional and falls back to the
    homepage wording, so a page that passes nothing renders exactly as
    before. Photos stay per-page via the `photo` prop — this change is
    copy-only. */
export type FooterCopy = {
  eyebrow?: string;
  headline?: string;
  support?: string;
  badge?: string;
  footnote?: string;
};

const DEFAULTS = {
  headline: "This docket is public. Every filing, every verdict — checkable by anyone, forever.",
  badge: "AZ-DOCKET-2026",
  footnote: "© 2026 Azure. No invented metrics. Verdicts speak for themselves.",
};

export default function SiteFooter({ photo = "/images/access-bg.jpg", copy = {} }: { photo?: string; copy?: FooterCopy }) {
  const headline = copy.headline ?? DEFAULTS.headline;
  const badge = copy.badge ?? DEFAULTS.badge;
  const footnote = copy.footnote ?? DEFAULTS.footnote;
  return (
    <footer
      className="footer-hero mt-8"
      style={{ backgroundImage: `url('${photo}')` }}
    >
      <div className="mx-auto max-w-[1280px] px-6 sm:px-8 py-12">
        <div className="grid grid-cols-12 gap-8 items-start">
          <div className="col-span-12 lg:col-span-7">
            {copy.eyebrow && (
              <p className="mb-3 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.2em]" style={{ color: "var(--color-accent)" }}>
                <span className="h-px w-8" style={{ background: "var(--color-accent)" }} />
                {copy.eyebrow}
              </p>
            )}
            <p className="font-display text-[26px] sm:text-[30px] leading-[1.1] tracking-[-0.03em] text-wrap-balance">{headline}</p>
            {copy.support && (
              <p className="mt-3 max-w-[52ch] text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
                {copy.support}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>
              <span className="inline-flex items-center gap-1.5 text-[15px]" style={{ fontFamily: "var(--font-brand), var(--font-display), Georgia, serif", textTransform: "none", letterSpacing: "0.01em" }}>
                <AzureLogo size={14} className="text-[var(--color-ink)]" /> Azure
              </span>
              <span className="hidden sm:inline">·</span>
              <span className="inline-flex items-center gap-1.5">
                <GenLayerMark size={14} /> Built on GenLayer
              </span>
              <span className="hidden sm:inline">·</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink-dim)", background: "var(--color-paper)" }}>
                {isLive() ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: "var(--color-success)" }} /> Live on GenLayer
                  </>
                ) : (
                  <>Demo build · no contract configured</>
                )}
              </span>
              <span className="hidden sm:inline">·</span>
              <a href="https://portal.genlayer.foundation" target="_blank" rel="noreferrer">GenLayer Agent Tank</a>
              <span className="hidden sm:inline">·</span>
              <a href="https://internetcourt.org" target="_blank" rel="noreferrer">Internet Court track</a>
            </div>
          </div>
          <div className="col-span-12 lg:col-span-5 flex flex-wrap gap-8 justify-start lg:justify-end text-sm">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>
                Docket
              </p>
              <ul className="mt-3 space-y-2" style={{ color: "var(--color-ink-dim)" }}>
                <li>
                  <Link href="/file" className="hover:underline">
                    File a dispute
                  </Link>
                </li>
                <li>
                  <Link href="/dockets" className="hover:underline">
                    Docket history
                  </Link>
                </li>
                <li>
                  <Link href="/problem" className="hover:underline">
                    The Problem
                  </Link>
                </li>
                <li>
                  <Link href="/faq" className="hover:underline">
                    FAQ
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>
                Build
              </p>
              <ul className="mt-3 space-y-2" style={{ color: "var(--color-ink-dim)" }}>
                <li>
                  <Link href="/file" className="hover:underline">
                    File a test dispute
                  </Link>
                </li>
                <li>
                  <a href="https://github.com/RaphaelC4/Azure" target="_blank" rel="noreferrer" className="hover:underline">
                    Docs ↗
                  </a>
                </li>
                <li>
                  <a href="https://genlayer.com" target="_blank" rel="noreferrer" className="hover:underline">
                    GenLayer ↗
                  </a>
                </li>
              </ul>
            </div>
            <div className="rounded-full border px-3 py-1 self-start font-mono text-xs" style={{ borderColor: "var(--color-accent)", color: "var(--color-accent)" }}>
              {badge}
            </div>
          </div>
        </div>
        <div className="mt-10 h-px" style={{ background: "var(--color-rule)" }} />
        <p className="mt-6 font-mono text-xs" style={{ color: "var(--color-ink-fainter)" }}>
          {footnote}
        </p>
      </div>
    </footer>
  );
}
