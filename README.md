# Azure — AI Dispute Resolution on GenLayer

**Staked, evidence-based dispute settlement with consensus LLM verdicts — the complete hackathon submission: GenLayer contract + full frontend, verified live on both GenLayer nets (studio-dev `61997` and legacy studionet `61999`).**

Azure lets two parties lock GEN into an on-chain case, submit evidence, approve the record together, and let GenLayer's validator-consensus LLM decide who walks away with the pot. Deadlines and default judgment mean no case can stall forever, and every no-show path is enforced by the contract, not by trust. This repo is both halves of that product, built to be read together:

- **`azure-contract/`** — the GenLayer contract (py-genlib / GenVM) in two net variants, the deploy helpers, the legacy-net V5 transaction sender, and smoke/read/balance probes.
- **`azure-landing/`** — a Next.js 16 frontend that turns the contract into a product: a live Court Audit that reads real cases off the chain, a docket browser, dispute filing, and the full consent ceremony (evidence, dual approval, blind verdict acceptance, settlement) driven from a browser wallet.

## The GenLayer superpowers Azure puts to work

Azure isn't a contract that happens to run on GenLayer — it's built around what only GenLayer can do:

- **Optimistic Democracy Consensus** — every write (`file_dispute`, `accept_dispute`, `settle`…) is validated optimistically by GenLayer's validator network — ~1-second blocks, majority vote, no per-operation gas, no trusted finality committee. The contract's 7 `gl.public.write` + 2 payable entries submit straight into that consensus, and the winner's payout is a protocol-native transfer finalized the same way.
- **On-chain AI verdicts (`gl.nondet.exec_prompt`)** — `request_verdict` runs the dispute prompt *inside* the contract. Every validator executes the same question, so the "judge" is GenLayer's consensus itself — and its answer is a settlement the contract automatically enforces.
- **Equivalence Principle (`gl.eq_principle.prompt_comparative` / `prompt_non_comparative`)** — validators may run *different* underlying models; logically equivalent outputs count as one vote. Azure uses the comparative variant to weigh both sides against the contract terms and pick the winner, and the non-comparative one to render the verdict text.
- **Nondeterministic web evidence (`gl.nondet.web.render` / `web.get`)** — evidence submitted as a URL is fetched and rendered by validators *inside consensus* — the network inspects the evidence itself; no centralized crawler sits in the middle.
- **Contracts in Python (py-genlib / GenVM)** — a clean 10-method surface with 34 protocol-level `gl.vm.UserError` sites, and `gl.evm.contract_interface` so the whole thing is callable from standard EVM tooling (viem, MetaMask, WalletConnect).
- **Native value in the message (`gl.message.value` / `gl.message.raw`)** — each 0.1 GEN stake travels with the transaction itself; the contract escrows it and pays the winner in real GEN via `emit_transfer` — not internal credits.
- **Public views (`gl.public.view`)** — the live docket (`get_case`) reads from any browser tab with no wallet, and deadline windows run off the chain's own clock — so no case can stall forever.

That's not marketing — every one of these is a call you can find in [`azure-contract/azure_contract.py`](azure-contract/azure_contract.py).

## Repository layout

```
Azure/
├─ azure-contract/                # the contract + tooling            (see its README.md)
│  ├─ azure_contract.py           # the contract — studio-dev (61997), GenVM v0.3 API
│  ├─ azure_contract_studionet.py # same logic — legacy studionet (61999) API
│  ├─ sn_v5_sender.mjs            # V5-format tx sender for 61999 (why: see below)
│  ├─ deploy_devnet.mjs           # deploy to studio-dev        (npm run deploy)
│  ├─ deploy_studionet.mjs        # deploy to legacy studionet  (npm run deploy:studionet)
│  ├─ probe_smoke_sn.mjs          # 61999 write smoke: file_dispute → accept_dispute
│  ├─ probe_accept_sn.mjs         # 61999 accept_verdict helper
│  ├─ read_az2.mjs                # 61999 read-path check via V5 gen_call
│  ├─ balance_check.mjs           # agent addresses + balances on both nets
│  └─ package.json
└─ azure-landing/                # the frontend                      (see its README.md)
   └─ app/                       # Next.js 16.3.3 (Turbopack) — /, /dockets, /file,
                                 # /consensus, /problem, /faq
```

## Deployed instances (verified live)

| | studio-dev (`61997`) | legacy studionet (`61999`) |
|---|---|---|
| **Contract** | `0x22473F53712A5cf944D8f7eDCc38681C28C1Ce16` | `0x1d0CAF3f9CC120d2701A16Ff7a43409B49c2868e` |
| **Windows** | 24h accept / 24h evidence / 24h verdict | 24h accept / 24h evidence / 24h verdict |
| **Verified** | full lifecycle ×2 — LLM verdict + native winner payout | full lifecycle — LLM verdict + native winner payout |

Both instances run **identical logic** (same 10 public methods, same rules, 34 `UserError` sites); the two source files differ only in the GenVM runtime API they target. The full lifecycle — file → stake → evidence → dual approval → consensus LLM verdict → dual verdict acceptance → settle with the **winner paid out in native GEN** — has been executed live on both nets.

The studionet instance is the fresh hackathon deployment: default windows, clean ledger, first `file_dispute` through the UI will be its first transaction.

## Legacy-net calldata — why `sn_v5_sender.mjs` exists

Studionet `61999` consensus implements only the flat `addTransaction (0x27241a99)` path, and its `gen_call` resolver only accepts `"method"`-keyed calldata. `genlayer-js 2.0.0-rc.1` encodes every user transaction in the new struct-based shape, so plain SDK calls on 61999 land in the contract's `__handle_undefined_method__`. `sn_v5_sender.mjs` (and `azure-landing/app/lib/genlayer-v5.ts` in the frontend) build the legacy V5 format directly: reads via `readCallV5`, writes via `sendWriteV5`. On studio-dev the stock SDK paths work as-is.

## How the two halves connect

The frontend never hardcodes contract state — it configures to any deployment through env vars:

- `azure-landing/.env.local` → `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS` (+ chain id; WalletConnect project id optional). A net toggle (studio-dev vs studionet, persisted in `localStorage: azure-net-v1`) dispatches reads per net — 61997 uses the stock SDK `readContract`, 61999 uses `readCallV5` — and every write first ensures the right chain in the wallet (`wallet_switchEthereumChain`) then routes through `sendWriteV5` on 61999.
- `azure-contract/.env` → `AZURE_CONTRACT_ADDRESS` (studio-dev) + the funded agent keys used by the deploy/probe tools.

Point both at any fresh deployment and the entire stack — contract, tools, and UI — retargets as one unit.

## Quick start

**Contract** (deploy + verify on either net):
```bash
cd azure-contract
npm install
cp .env.example .env            # add your funded agent keys
npm run deploy                  # studio-dev (61997), no-arg → 24h/24h/24h windows
npm run deploy:studionet        # legacy studionet (61999) — same logic, legacy API
npm run smoke                   # 61999 write smoke vs the canonical instance
npm run read                    # 61999 V5 read check (fresh instance → "Case not found" proof)
npm run balances                # agent addresses + GEN balances on both nets
```

**Frontend** (run the product):
```bash
cd azure-landing
npm install
cp .env.example .env.local      # fresh studionet contract address pre-set
npm run dev                     # → http://localhost:3000
npm run build                   # clean production build (Next 16.3.3 / Turbopack)
```

## What the live runs proved

- **The consent ceremony, end to end, on both nets** — filing → accept → evidence → dual approval → consensus LLM verdict → dual verdict acceptance → settlement, with the winner's payout arriving as a native GEN transfer. Every premature action is rejected on-chain (reclaim while the window is open, verdict without evidence/approvals, settle during the verdict window…).
- **Deadlines are real** — late acceptance is rejected, expired cases sit until reclaimed, reclaim cancels cleanly.
- **Default judgment** — a no-show respondent loses by on-chain LLM verdict, and the case settles.

Full reasoning, the method inventory, and the deployment notes are in [`azure-contract/README.md`](azure-contract/README.md).

## License

MIT. Built for the GenLayer hackathon — GEN on these nets is a testnet token.
