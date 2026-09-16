// deploy_devnet.mjs — deploys CURRENT azure_contract.py to Studio Devnet (61997).
// Run: node --env-file=.env deploy_devnet.mjs
import { createClient, createAccount } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { readFileSync } from "node:fs";

const key = process.env.AGENT_A_PRIVATE_KEY;
if (!key) throw new Error("AGENT_A_PRIVATE_KEY not set");
const account = createAccount(key);
const client = createClient({ chain: studioDevnet, account });
const code = readFileSync(new URL("./azure_contract.py", import.meta.url), "utf8");

console.log("Deployer:", account.address);
console.log("Chain:", client.chain.name, `(id ${client.chain.id})`, client.chain.rpcUrls.default.http[0]);

try {
  const schema = await client.getContractSchemaForCode(code);
  const methods = Object.keys(schema?.methods ?? schema ?? {});
  console.log("[preflight] schema OK —", methods.length, "methods:", methods.join(", "));
} catch (err) {
  console.warn("[preflight] schema extraction FAILED:", err instanceof Error ? err.message : err);
}

const fees = await client.estimateTransactionFees({});
console.log("[deploy] quoted feeValue:", fees.feeValue, "wei");

console.log("Deploying azure_contract.py (no args -> 24h/24h/24h windows)...");
const deployTxHash = await client.deployContract({
  code,
  fees: { distribution: fees.distribution, feeValue: fees.feeValue },
});
console.log("[deploy] tx sent:", deployTxHash);
const receipt = await client.waitForTransactionReceipt({
  hash: deployTxHash,
  waitUntil: "finalized",
  retries: 100,
  interval: 5000,
});
console.log("[deploy] finalized");
const addr =
  receipt?.to_address ?? receipt?.recipient ?? receipt?.contract_address ?? receipt?.data?.contract_address ?? null;
if (!addr) {
  console.error("No contract address in receipt:", JSON.stringify(receipt).slice(0, 2000));
  throw new Error("Could not determine new contract address");
}
console.log("NEW_ADDRESS:", addr);
