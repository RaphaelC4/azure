"use client";

import { useEffect, useRef, useState } from "react";
import { useNet } from "../hooks/useNet";
import { NETS, type NetId } from "../lib/contract";
import { chainParamsFor, ensureStudionetChain, getWallet } from "../lib/wallet";

const ORDER: NetId[] = ["studio-dev", "studionet"];

/** Net switcher, styled and behaved like the wallet button: a pill trigger
    that opens a dropdown menu. Selecting a net re-targets every read and
    write app-wide and walks a connected wallet over to the net's chain
    (best effort - a rejected switch prompt just means the next write will
    ask for it again). */
export default function NetSwitcher() {
  const { netId, net, setNet } = useNet();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const select = async (id: NetId) => {
    setOpen(false);
    if (id === netId) return;
    setNet(id);
    const { status, provider } = getWallet();
    if (status === "connected") {
      try {
        await ensureStudionetChain(provider, chainParamsFor(NETS[id].chainId));
      } catch {
        /* surfaced by the next write's own chain ensure */
      }
    }
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`${net.label} - ${net.status}`}
        className="inline-flex items-center gap-2 rounded-full border px-4 py-2.5 font-mono text-sm transition hover:bg-[var(--color-paper-2)]"
        style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)", background: "var(--color-paper-2)" }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: net.writesAvailable ? "var(--color-success)" : "var(--color-evidence-bright)" }}
        />
        {net.label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
        >
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 min-w-[220px] overflow-hidden rounded-xl border py-1 shadow-lg"
          style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}
        >
          <div className="px-3 pb-1 pt-2 text-[11px] font-medium" style={{ color: "var(--color-ink)" }}>
            GenLayer network
          </div>
          {ORDER.map((id) => {
            const n = NETS[id];
            const active = id === netId;
            return (
              <button
                key={id}
                type="button"
                role="menuitem"
                aria-pressed={active}
                onClick={() => void select(id)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-[var(--color-paper)]"
                style={{ color: "var(--color-ink)" }}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: n.writesAvailable ? "var(--color-success)" : "var(--color-evidence-bright)" }}
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{n.label}</span>
                  <span className="block font-mono text-[10px] leading-snug" style={{ color: "var(--color-ink-faint)" }}>
                    {n.status}
                  </span>
                </span>
                {active && (
                  <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-success)" }}>
                    Active
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
