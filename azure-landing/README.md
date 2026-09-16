# Azure — Landing Page

Landing page for **Azure**, an agent-vs-agent arbitration contract on GenLayer
built for the GenLayer Agent Tank hackathon (Internet Court track).

## Design direction

Built with the disciplines from [Nutlope/hallmark](https://github.com/Nutlope/hallmark)
(an anti-AI-slop design skill) applied by hand — no invented metrics, no
italic display headings, no re-drawn fake browser chrome, real OKLCH tokens,
`:focus-visible` rings that appear instantly, `prefers-reduced-motion`
support, no horizontal scroll at any width.

**Macrostructure: Ledger.** Instead of the generic hero → 3-feature-grid →
CTA → footer template, the whole page reads as a single continuous legal
document — a case file — with its sections (The Problem, The Solution,
Case Lifecycle...) running down one narrow column, dividers as
horizontal rules, and the audited case ("Exhibit A") inserted directly into
the document flow as a perforated ticket stub rather than floating in a hero
graphic.

**Palette:** near-black paper with a cool undertone, warm parchment text,
brass/gold for judgment and stakes, cold slate-blue for evidence — all
declared as OKLCH tokens in `app/globals.css`.

**Honest copy:** no invented stats anywhere — every panel states its
source. The homepage "Court Audit" reads the deployed contract
(`AUDIT_SOURCE = "contract"` in `app/lib/audit.ts`): real case metadata
plus the consensus verdict, with an explicit note that per-validator
scores are not on-chain so no bars are fabricated. The docket renders
only live on-chain cases (quiet loading, honest empty/error states - no
demo archive), and the FAQ keeps a small "Stated Honestly" block.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Out of the box there are no API keys and no
runtime external calls: with no contract address configured, the Court
Audit and the docket show plain not-configured states. With
`NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS` set in `.env.local`, the audit
panel and docket make public `get_case` reads against GenLayer's Studio
network — no wallet needed for reads.
No runtime font fetch either: the display serif (Newsreader) is
self-hosted at build time by `next/font`, so the site works offline or on
a restricted network.

## Wallet

The header has a **Connect wallet** button. It uses WalletConnect (QR modal,
mobile-friendly) when `NEXT_PUBLIC_WC_PROJECT_ID` is set in `.env.local`,
otherwise it falls back to an injected EIP-1193 wallet (Rabby / MetaMask).
The connected wallet is switched to the GenLayer Studio Network
(chainId 61999) before signing. On-chain writes are wired up on `/file`:
`file_dispute` (real GEN stake), `submit_evidence`, `request_verdict` and
`settle` go through the wallet and poll the consensus receipt. See
`.env.example`.

## Before you ship this

The contract integration is live end-to-end once `.env.local` sets
`NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS`. What ships today:

- The homepage "Court Audit" (`app/lib/audit.ts`, `AUDIT_SOURCE =
  "contract"`) reads one real case — preferring one with a verdict — via
  public `get_case` reads and links the parties to the GenLayer explorer.
  Per-validator scores are not exposed on-chain, so the bench renders a
  note instead of fabricated bars. Flip `AUDIT_SOURCE` to `"demo"` for
  the seeded AZ-0142 simulation (works offline).
- `/dockets` reads every live case (AZ-1… until the first missing id, scan
  ceiling 256) every 30s and renders them all — settled cases are cached so
  the poll stays light; quiet loading, honest empty state when the chain has
  no cases yet.
- `/file` files real disputes through the connected wallet (stake,
  evidence, verdict, settle).
- With no contract address configured, the audit panel and the docket
  say so plainly — no demo content is rendered anywhere.
- Sanity-check the feature/FAQ copy against your actual contract logic
  before a judge reads it.

## Structure

- `app/layout.tsx` — metadata; self-hosted Newsreader display serif via
  `next/font` (build-time fetch only, zero runtime requests)
- `app/globals.css` — OKLCH design tokens, the perforated-ticket and
  wax-seal utility classes, focus/motion/responsive base rules
- `app/page.tsx` — the homepage as one ledger document; content lives in
  typed arrays at the top so copy is easy to edit without touching markup
- `app/components/` — SiteHeader, SiteFooter, Logo, WalletButton (Connect /
  disconnect via WalletConnect QR or injected wallet), plus the homepage's
  CourtAudit (demo loop or live contract read, per `AUDIT_SOURCE`)
- `app/lib/` — shared data arrays (`data.ts`), the spotlight hover hook,
  `audit.ts` (`AUDIT_SOURCE` picks the seeded demo loop or live contract
  reads for the Court Audit), `contract.ts` (genlayer-js `get_case`
  reads, on-chain writes + consensus-receipt parsing), and `wallet.ts`
  (WalletConnect / injected wallet, GenLayer Studionet switch)
- `app/dockets/`, `app/file/` — the public docket (live on-chain rows
  only) and the file-a-dispute flow (on-chain writes with explorer links
  in the receipt)
