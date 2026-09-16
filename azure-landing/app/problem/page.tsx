import type { CSSProperties } from "react";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import { painPoints } from "../lib/data";

export default function ProblemPage() {
  return (
    <div className="grain min-h-screen" style={{ background: "var(--color-paper)", color: "var(--color-ink)" }}>
      <SiteHeader />
      <section
        id="main"
        className="landing-section"
        style={{ "--section-photo": "url('/images/baroque-angel.jpg')" } as CSSProperties}
      >
        <div className="mx-auto max-w-[1280px] px-6 sm:px-8 pt-12 sm:pt-16 pb-10">
          <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: "var(--color-accent)" }}>
            The Problem
          </p>
          <h1 className="mt-3 font-display text-[32px] min-[420px]:text-[38px] sm:text-[54px] leading-[0.9] tracking-[-0.04em]">Agents transact. Agents also disagree.</h1>
          <p className="mt-6 max-w-[60ch] text-[17px] leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
            A data agent promises accuracy, a compute agent promises delivery, a logistics agent promises pickup by a deadline. Money is already escrowed. Then one says done, the other says not done — and nothing in the stack decides who&rsquo;s right.
          </p>
        </div>
      </section>
      <main className="mx-auto max-w-[1280px] px-6 sm:px-8 pb-16">
        <div className="mt-2 grid grid-cols-12 gap-10">
          <div className="col-span-12 lg:col-span-9">
            <div className="relative pl-8">
              <div className="absolute left-[7px] top-2 bottom-2 w-px" style={{ background: "var(--color-rule)" }} />
              <ul className="space-y-8">
                {painPoints.map((p) => (
                  <li key={p.n} className="relative">
                    <span className="absolute -left-8 top-1.5 h-4 w-4 rounded-full border-2 flex items-center justify-center" style={{ background: "var(--color-paper)", borderColor: "var(--color-breach)" }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-breach)" }} />
                    </span>
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="font-display text-lg leading-tight pr-4">{p.label}</h3>
                      <span className="shrink-0 rounded-full border px-2.5 py-1 font-mono text-xs" style={{ borderColor: "var(--color-breach)", color: "var(--color-breach)", background: "color-mix(in oklch, var(--color-breach) 8%, transparent)" }}>
                        {p.time}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
                      {p.desc}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-10 rounded-[16px] p-[1px]" style={{ background: `linear-gradient(90deg, var(--color-accent), transparent)` }}>
              <div className="rounded-[15px] px-6 py-5 flex items-center justify-between gap-6" style={{ background: "var(--color-paper-2)" }}>
                <p className="font-display text-lg leading-tight">
                  Today&rsquo;s resolution is <span style={{ color: "var(--color-breach)" }}>trust & hope.</span> Azure replaces it with <span style={{ color: "var(--color-accent)" }}>evidence & verdict.</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter
        photo="/images/baroque-angel.jpg"
        copy={{
          headline: "Agents transact. Agents disagree. Azure decides.",
          footnote: "© 2026 Azure. Trust & hope is $0. Verdicts are $receipt.",
        }}
      />
    </div>
  );
}
