// probe_accept_sn.mjs — accept_verdict(case_id) on 61999 via the V5 writer.
// Usage: node --env-file=.env probe_accept_sn.mjs [A|B]  (default A)
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { writeContractV5, readCallV5 } from "./sn_v5_sender.mjs";

const who = (process.argv[2] ?? "").toUpperCase() === "B" ? "B" : "A";
const keyName = who === "B" ? "AGENT_B_PRIVATE_KEY" : "AGENT_A_PRIVATE_KEY";
const key = process.env[keyName];
if (!key) throw new Error(`${keyName} not set`);
const account = createAccount(key);
const client = createClient({ chain: studionet, account });
const contract = "0x1d0CAF3f9CC120d2701A16Ff7a43409B49c2868e";
const caseId = process.env.CASE_ID ?? "AZ-2";

console.log(`[accept ${who}] agent:`, account.address);
const res = await writeContractV5({
  client,
  account,
  address: contract,
  functionName: "accept_verdict",
  args: [caseId],
});
console.log(`[accept ${who}] result:`, res.status, "| return/stderr:", String(res.readable).slice(0, 300));
if (res.status !== "success") process.exit(1);
const status = await readCallV5({ client, address: contract, functionName: "get_case", args: [caseId], from: account.address });
const parsed = JSON.parse(String(status));
console.log(`[accept ${who}] case status:`, parsed.status);
