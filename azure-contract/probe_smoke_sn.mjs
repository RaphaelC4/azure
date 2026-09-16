// probe_smoke_sn.mjs — 61999 write-path smoke against the canonical studionet
// contract: file_dispute (A, 0.1 GEN stake) -> accept_dispute (B). Verified via
// consensus receipts (gen_call reads are broken net-wide on 61999).
// Run: node --env-file=.env probe_smoke_sn.mjs
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { writeContractV5 } from "./sn_v5_sender.mjs";

const CONTRACT = process.env.SMOKE_CONTRACT ?? "0x1d0CAF3f9CC120d2701A16Ff7a43409B49c2868e";
const agentA = createAccount(process.env.AGENT_A_PRIVATE_KEY);
const agentB = createAccount(process.env.AGENT_B_PRIVATE_KEY);
const client = createClient({ chain: studionet, account: agentA });

console.log("contract:", CONTRACT, "| claimant:", agentA.address, "| respondent:", agentB.address);

function verdictOf(receipt) {
  const raw = receipt && receipt.__raw ? receipt.__raw : receipt;
  const leader = raw?.consensus_data?.leader_receipt?.[0];
  const result = leader?.result;
  return {
    status: result?.status ?? "(none)",
    readable: result?.payload?.readable ?? leader?.genvm_result?.stderr ?? "",
  };
}

// 1) A files a dispute, staking 0.1 GEN
const stake = 10n ** 17n;
const f = await writeContractV5({
  client,
  account: agentA,
  address: CONTRACT,
  functionName: "file_dispute",
  args: [agentB.address, "Smoke test terms: respondent owes claimant 0.01 GEN (not enforced — smoke only)."],
  value: stake,
});
const fv = verdictOf(f.receipt);
console.log("[file_dispute] result:", fv.status, "| return/stderr:", String(fv.readable).slice(0, 200));
if (fv.status !== "return") {
  console.error("SMOKE FAILED at file_dispute");
  process.exit(1);
}
const caseId = (() => { try { return JSON.parse(fv.readable); } catch { return fv.readable; } })();
console.log("case_id:", caseId);

// 2) B accepts, matching the claimant's 0.1 GEN stake exactly
const a = await writeContractV5({
  client,
  account: agentB,
  address: CONTRACT,
  functionName: "accept_dispute",
  args: [String(caseId)],
  value: stake,
});
const av = verdictOf(a.receipt);
console.log("[accept_dispute] result:", av.status, "| return/stderr:", String(av.readable).slice(0, 200));
if (av.status !== "return") {
  console.error("SMOKE FAILED at accept_dispute");
  process.exit(1);
}
console.log("SMOKE OK: file_dispute + accept_dispute both reached consensus with successful execution returns.");
