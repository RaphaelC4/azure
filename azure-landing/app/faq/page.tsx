import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";

const faqs = [
  { q: "How does Azure decide who's right?", a: "Validators score evidence against the contract terms stated at filing, independently. A verdict issues once enough scores agree inside the tolerance band — no exact match required." },
  { q: "What counts as evidence?", a: "Whatever the terms point to: logs, API responses, outputs, timestamps. Azure judges what was submitted in the window, not reputation." },
  { q: "What if validators don't agree?", a: "If scores fall outside tolerance, the case escalates rather than forcing false consensus — one stubborn or compromised validator can't decide the outcome." },
  { q: "Does this replace Internet Court?", a: "No — it plugs into it. Azure's case and verdict format matches the Internet Court consortium standard for agent commerce disputes." },
];

export default function FAQPage() {
  return (
    <div className="grain min-h-screen" style={{ background: "var(--color-paper)", color: "var(--color-ink)" }}>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1280px] px-6 sm:px-8 py-12 sm:py-16">
        <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: "var(--color-accent)" }}>
          FAQ
        </p>
        <h1 className="mt-3 font-display text-[32px] min-[420px]:text-[38px] sm:text-[54px] leading-[0.9] tracking-[-0.04em]">Questions a validator would ask.</h1>

        <div className="mt-10 max-w-[820px] divide-y rounded-[20px] border overflow-hidden" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}>
          {faqs.map((f) => (
            <details key={f.q} className="group px-6 sm:px-8 py-5 open:bg-[var(--color-paper-3)] transition-colors">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-display text-[17px]">
                {f.q}
                <span className="shrink-0 h-7 w-7 rounded-full border flex items-center justify-center text-sm transition-transform group-open:rotate-45" style={{ borderColor: "var(--color-rule)", color: "var(--color-accent)", background: "var(--color-paper)" }}>
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed pr-2 sm:pr-10" style={{ color: "var(--color-ink-dim)" }}>
                {f.a}
              </p>
            </details>
          ))}
        </div>

        <div className="mt-8 max-w-[820px] rounded-[16px] border p-6" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}>
          <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>
            Stated Honestly
          </p>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3" style={{ color: "var(--color-ink-dim)" }}>
            <span>Average time to verdict: to confirm once real test cases have run.</span>
            <span>Cases resolved without unanimity: to confirm.</span>
            <span>Steps filed to settled: just counting.</span>
          </div>
        </div>

        <div className="mt-8">
          <Link href="/file" className="rounded-full px-6 py-3 text-sm font-medium" style={{ background: "var(--color-accent)", color: "var(--color-paper)" }}>
            File a test dispute →
          </Link>
        </div>
      </main>
      <SiteFooter
        copy={{
          headline: "Read the verdicts yourself — the docket doesn't lie.",
          footnote: "© 2026 Azure. Still a question? File a dispute and watch it resolve.",
        }}
      />
    </div>
  );
}
