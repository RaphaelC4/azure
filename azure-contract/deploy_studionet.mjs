// deploy_studionet.mjs — deploys the 61999 variant (azure_contract_studionet.py:
// same logic as azure_contract.py, legacy GenVM API) to legacy Studionet (61999).
// Run: node --env-file=.env deploy_studionet.mjs
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { deployContractV5 } from "./sn_v5_sender.mjs";
import { readFileSync } from "node:fs";

const key = process.env.AGENT_A_PRIVATE_KEY;
if (!key) throw new Error("AGENT_A_PRIVATE_KEY not set");
const account = createAccount(key);
const client = createClient({ chain: studionet, account });
const code = readFileSync(new URL("./azure_contract_studionet.py", import.meta.url), "utf8");

console.log("Deployer:", account.address);
console.log("Chain:", client.chain.name, `(id ${client.chain.id})`, client.chain.rpcUrls.default.http[0]);

try {
  const schema = await client.getContractSchemaForCode(code);
  const methods = Object.keys(schema?.methods ?? schema ?? {});
  console.log("[preflight] schema OK —", methods.length, "methods:", methods.join(", "));
} catch (err) {
  console.warn("[preflight] schema extraction FAILED:", err instanceof Error ? err.message : err);
}

console.log("Deploying azure_contract_studionet.py (no args -> 24h/24h/24h windows)...");
// 61999's consensus main contract only speaks the OLD flat addTransaction ABI
// (V5, selector 0x27241a99) — genlayer-js 2.0.0-rc.1 ships ONLY the new
// struct+fees encoding (0x35a251fb), which the 61999 node cannot parse: the tx
// is recorded empty (data {}) and finalizes NO_MAJORITY with zero votes. That
// — not a network outage — is what every "stuck deploy" on 61999 was. Send the
// byte-verified V5 envelope instead (see sn_v5_sender.mjs); keep client.deployContract
// for 61997, which runs the new consensus.
const { txHash: deployTxHash, receipt } = await deployContractV5({ client, account, code });
console.log("[deploy] tx sent:", deployTxHash);
console.log("[deploy] finalized");
const addr =
  receipt?.to_address ?? receipt?.recipient ?? receipt?.contract_address ?? receipt?.data?.contract_address ?? null;
if (!addr) {
  console.error("No contract address in receipt:", JSON.stringify(receipt).slice(0, 2000));
  throw new Error("Could not determine new contract address");
}
// The SDK's "finalized" only tracks the queue status — consensus can still end
// NO_MAJORITY (61999 infra has done this twice) with no contract created and
// consensus_data null. Verify the actual consensus result before trusting it.
const raw = await client.request({
  method: "eth_getTransactionByHash",
  params: [deployTxHash],
});
const resultName = raw?.result_name ?? raw?.result?.result_name ?? null;
if (resultName && resultName !== "MAJORITY_AGREE") {
  throw new Error(
    `Deploy did NOT reach consensus: result_name=${resultName}, ` +
      `consensus_data=${raw?.consensus_data === null ? "null" : "present"}, ` +
      `status=${raw?.status}. No contract exists at ${addr}. Tx: ${deployTxHash}`
  );
}
console.log("[deploy] consensus verified:", resultName ?? "(absent)");
console.log("NEW_ADDRESS:", addr);
