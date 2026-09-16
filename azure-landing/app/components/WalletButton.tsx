"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "../hooks/useWallet";
import { shortAddress } from "../lib/wallet";

/**
 * Connect wallet button. Shows a short address, the wallet that actually
 * connected (injected wallets are labelled per lib/wallet.ts), + disconnect.
 */
export default function WalletButton({ label = "Connect wallet" }: { label?: string }) {
  const { status, account, walletLabel, connect, disconnect } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the wallet menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (status === "connected") {
    return (
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          title={walletLabel ? `${walletLabel} \u00b7 ${account ?? ""}` : account || ""}
          className="inline-flex items-center gap-2 rounded-full border px-4 py-2.5 font-mono text-sm transition hover:bg-[var(--color-paper-2)]"
          style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)", background: "var(--color-paper-2)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-success)" }} />
          {shortAddress(account || "")}
          {walletLabel && (
            <span className="text-[10px] font-medium tracking-wide" style={{ color: "var(--color-ink-faint)" }}>
              {walletLabel}
            </span>
          )}
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden
            style={{ transform: menuOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
          >
            <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-[calc(100%+8px)] z-50 min-w-[200px] overflow-hidden rounded-xl border py-1 shadow-lg"
            style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}
          >
            <div className="px-3 pb-1 pt-2 text-[11px] font-medium" style={{ color: "var(--color-ink)" }}>
              {walletLabel ? `Connected via ${walletLabel}` : "Connected wallet"}
            </div>
            <div className="break-all px-3 pb-1 font-mono text-[10px] leading-snug" style={{ color: "var(--color-ink-faint)" }}>
              {account}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                disconnect();
              }}
              className="w-full px-3 py-2 text-left text-sm font-medium transition hover:bg-[var(--color-paper)]"
              style={{ color: "var(--color-breach)" }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await connect();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Wallet connection failed.");
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="rounded-full border px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--color-paper-2)] active:scale-[0.98] disabled:opacity-50"
        style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }}
      >
        {busy ? "Connecting\u2026" : label}
      </button>
      {error && (
        <span role="alert" className="max-w-[220px] text-right font-mono text-[10px] leading-snug" style={{ color: "var(--color-breach)" }}>
          {error}
        </span>
      )}
    </span>
  );
}