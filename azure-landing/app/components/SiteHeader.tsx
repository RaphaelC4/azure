"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AzureLogo } from "./Logo";
import WalletButton from "./WalletButton";
import NetSwitcher from "./NetSwitcher";
import { restoreWallet } from "../lib/wallet";

const navLinks = [
  { href: "/file", label: "File Dispute" },
  { href: "/dockets", label: "Docket History" },
  { href: "/problem", label: "The Problem" },
  { href: "/faq", label: "FAQ" },
];

export default function SiteHeader() {
  const [scrollP, setScrollP] = useState(0);
  const pathname = usePathname();

  // Restore the wallet session on first mount so a refresh keeps the
  // connection (silent eth_accounts / WalletConnect session restore).
  useEffect(() => {
    void restoreWallet();
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setScrollP(h ? window.scrollY / h : 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <div className="fixed left-0 right-0 top-0 z-[100] h-[2px]" style={{ background: "var(--color-rule)" }}>
        <div id="progress" className="h-full" style={{ width: `${scrollP * 100}%`, background: "var(--color-accent)" }} />
      </div>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-[var(--color-paper-2)] focus:px-4 focus:py-2 focus:text-sm">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b" style={{ borderColor: "var(--color-rule)", background: "color-mix(in oklch, var(--color-paper) 88%, transparent)", backdropFilter: "blur(14px)" }}>
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-6 px-6 py-3 sm:px-8 sm:py-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-[10px] border flex items-center justify-center overflow-hidden" style={{ borderColor: "var(--color-accent-bright)", color: "#ffffff", background: "var(--color-accent)", boxShadow: "0 2px 12px oklch(0% 0 0 / 0.35), inset 0 1px 0 oklch(100% 0 0 / 0.2)" }}>
                <AzureLogo size={22} className="text-white" bright />
              </div>
              <span
                className="text-[26px] sm:text-[28px] leading-none"
                style={{ fontFamily: "var(--font-brand), var(--font-display), Georgia, serif", letterSpacing: "-0.01em", color: "var(--color-ink)" }}
              >
                Azure
              </span>
            </Link>
            <nav className="hidden lg:flex items-center gap-6 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
              {navLinks.map((l) => {
                const active = pathname === l.href;
                return (
                  <Link key={l.href} href={l.href} className={`hover:underline underline-offset-4 transition ${active ? "font-medium" : "opacity-80 hover:opacity-100"}`} style={{ color: active ? "var(--color-accent)" : undefined, textUnderlineOffset: "4px" }}>
                    {l.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/file" className="hidden rounded-full px-5 py-2.5 text-sm font-medium transition hover:opacity-90 active:scale-[0.98] sm:inline-flex" style={{ background: "var(--color-accent)", color: "var(--color-paper)" }}>
              File a dispute
            </Link>
            <NetSwitcher />
            <WalletButton />
          </div>
        </div>
        {/* Mobile nav */}
        <div className="flex flex-wrap gap-x-4 gap-y-2.5 border-t px-6 py-3 text-sm lg:hidden" style={{ borderColor: "var(--color-rule)", background: "color-mix(in oklch, var(--color-paper) 88%, transparent)" }}>
          {navLinks.map((l) => (
            <Link key={l.href} href={l.href} className="whitespace-nowrap font-mono text-xs uppercase tracking-widest" style={{ color: pathname === l.href ? "var(--color-accent)" : "var(--color-ink-dim)" }}>
              {l.label}
            </Link>
          ))}
        </div>
      </header>
    </>
  );
}
