# Azure — GenLayer dispute contract

Peer-to-peer dispute settlement on GenLayer: two parties stake GEN, submit
evidence, run a consensus verdict, and the winner is paid **natively** via
`emit_transfer` at settle time. No credits ledger, no `withdraw` — payouts are
direct native GEN sends. Every move leans on what only GenLayer can do —
Optimistic Democracy Consensus, the Equivalence Principle, in-consensus LLM
and web calls — mapped call-by-call in the
[root README](../README.md#the-genlayer-superpowers-azure-puts-to-work).

## Lifecycle (AZ cases)

1. **File** — claimant `file_dispute(case_id, respondent, reason)` with a 0.1+ GEN stake (min `MIN_STAKE_WEI`).
2. **Accept** — respondent `accept_dispute(case_id)` with a matching stake within the acceptance window.
3. **Evidence** — either party `submit_evidence` / `submit_evidence_with_url` after dual approval.
4. **Verdict** — dual `approve_case_evidence`, then `request_verdict` runs the GenLayer consensus verdict.
5. **Settle** — either party `accept_verdict`; the second acceptance auto-settles: the winner is **paid the full pot natively** (both stakes — transaction fees are paid by the transacting wallets, never from the pot).
6. **Reclaim** — if the respondent never accepted within the window, the claimant `reclaim_unaccepted_stake` recovers their stake — also paid natively.

Windows default to 24h / 24h / 24h (accept / verdict-accept / verdict-approve) unless deploy args pass `[u256, u256, u256]` seconds.

## Canonical instance (studio-dev, 61997)

| | |
|---|---|
| Address | `0x22473F53712A5cf944D8f7eDCc38681C28C1Ce16` |
| Deploy tx | `0xaed25bf1b95614d61bc6e72306d594635758a2ecd5d7b52cc0ab18351cab33ba` (2026-09-13, windows 24/24/24) |
| RPC | `https://studio-dev.genlayer.com/api` — chain `61997` |
| State | pristine, zero cases |

Studionet (61999): the deployer's deterministic slot `0xb7278A61aa25c888815aFC32Ad3cC52fF24fE575` is **reserved but empty** — see *Studionet status* below.

## Payout mechanism (important for integrators)

`settle` and `reclaim_unaccepted_stake` call `emit_transfer` directly. The
**transaction that triggers them must carry a message fee budget** — a plain
fee injection fails with `0x02 fee no_matching_allocation # external` and the
payout silently defers. In `genlayer-js`:

```js
const fees = await client.estimateTransactionFeesForWrite({
  address, functionName: "settle", args: ["AZ-1"],
});
await client.writeContract({
  address, functionName: "settle", args: ["AZ-1"],
  fees: {
    distribution: fees.distribution, feeValue: fees.feeValue,
    ...(fees.messageAllocations ? { messageAllocations: fees.messageAllocations } : {}),
  },
});
```

Verified end-to-end on 61997: child value message finalized with
`value_credited: true` and the winner's balance up by the exact pot.

## Studionet status (61999)

**Live for contract transactions as of 2026-09-13.** The earlier
"consensus offline" streak was never an outage: genlayer-js 2.0.0-rc.1 ships
only the new struct `addTransaction` ABI (0x35a251fb), which 61999's consensus
main contract cannot parse — the node records an empty type-0 tx and
finalizes `NO_MAJORITY` with zero votes. The old flat interface
`addTransaction(address,address,uint256,uint256,bytes)` (V5, 0x27241a99) is
what the net still speaks; `sn_v5_sender.mjs` (node) and
`lib/genlayer-v5.ts` (browser) rebuild that envelope byte-for-byte.

Verified live on 61999: deploy via `deployContractV5`, then the
`file_dispute` + `accept_dispute` smoke (with the 0.1 GEN stake as `value`)
both reached MAJORITY_AGREE with real execution returns, and `get_case`
round-trips through `readCallV5`/`decodeCalldataV5`. The live instance is
`0x1d0CAF3f9CC120d2701A16Ff7a43409B49c2868e` — a fresh, transaction-free
hackathon deploy (2026-09-15, tx `0x04a915e6…d8e2`, `MAJORITY_AGREE`, empty
case ledger); that address is what the app and probes now target. Caveat
kept in the senders: 61999's `gen_call` only resolves the legacy
"method"-key calldata layout, so rc.1's own read/write calls still fail
there — always go through the V5 path.

## Methods (10)

| Method | Access | Effect |
|---|---|---|
| `file_dispute(case_id, respondent, reason)` | claimant | Opens the case + native stake |
| `accept_dispute(case_id)` | respondent | Matching stake, case `active` |
| `submit_evidence(case_id, text)` / `submit_evidence_with_url(case_id, url)` | both, after dual approval | Records evidence (URL leg renders via `gl.nondet.web.render`) |
| `approve_case_evidence(case_id)` | both | Gate for the verdict |
| `request_verdict(case_id)` | both, after dual approval | Runs the consensus verdict |
| `accept_verdict(case_id)` | both, after verdict | First = consent; second = auto-`settle` |
| `settle(case_id)` | either, after verdict-accept deadline | Pays the winner natively |
| `reclaim_unaccepted_stake(case_id)` | claimant, after accept deadline | Native stake refund, case `cancelled` |
| `get_case(case_id)` *view* | anyone | Case state |

## Scripts

| Command | What |
|---|---|
| `npm run deploy` (`deploy_devnet.mjs`) | Deploy the native build to studio-dev 61997 |
| `npm run deploy:studionet` (`deploy_studionet.mjs`) | Deploy the 61999 dialect (guard refuses NO_MAJORITY) |
| `npm run smoke` (`probe_smoke_sn.mjs`) | 61999 write smoke: `file_dispute` → `accept_dispute` (stake escrow), verified via consensus receipts |
| `npm run read` (`read_az2.mjs`) | 61999 read check via V5 `gen_call` — fresh instance returns the contract's own "Case not found" |
| `npm run accept` (`probe_accept_sn.mjs`) | 61999 `accept_verdict` helper (A or B) |
| `npm run balances` (`balance_check.mjs`) | Agent addresses + GEN balances on both nets |

Env (see `.env.example`): `AZURE_CONTRACT_ADDRESS` (studio-dev), the agent keys, plus
optional retargeting overrides (`SMOKE_CONTRACT`, `STUDIONET_CONTRACT`,
`READ_CASE_ID`, `CASE_ID`). All writes that can `emit_transfer` fund the payout
correctly via `estimateTransactionFeesForWrite`.
