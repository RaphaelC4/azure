// read_az2.mjs — verify the V5 ("method"-key) read path on 61999 against the
// fresh hackathon contract (STUDIONET_CONTRACT env overrides). On the fresh
// instance a get_case for any id must come back as the contract's own
// "Case not found" UserError — proof the code deployed and executes, without
// sending any tx (reads are stateless gen_calls, the address stays clean).
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { readCallV5, encodeCalldata, decodeCalldataV5 } from "./sn_v5_sender.mjs";
import { Buffer } from "node:buffer";

// decoder round-trip sanity: encode -> decode must restore the value
const sample = { method: "get_case", args: ["AZ-2", 42n, true, null, ["a", "b"]] };
const rt = decodeCalldataV5(new Uint8Array(Buffer.from(encodeCalldata(sample).slice(2), "hex")));
const expect = { method: "get_case", args: ["AZ-2", "42", true, null, ["a", "b"]] };
const bigintSafe = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? String(x) : x));
console.log("round-trip ok:", rt.method === expect.method && bigintSafe(rt.args) === bigintSafe(expect.args));

const CONTRACT = process.env.STUDIONET_CONTRACT ?? "0x1d0CAF3f9CC120d2701A16Ff7a43409B49c2868e";
const client = createClient({ chain: studionet, account: createAccount(process.env.AGENT_A_PRIVATE_KEY) });
const caseId = process.env.READ_CASE_ID ?? "AZ-2";
try {
  const res = await readCallV5({
    client,
    address: CONTRACT,
    functionName: "get_case",
    args: [caseId],
    from: "0x09502F2F0a792D57BB7045608F2BC958608959C4",
  });
  console.log(`get_case(${caseId}) =`, String(res).slice(0, 400));
} catch (err) {
  console.log(`get_case(${caseId}) returned error (expected on the fresh contract):`,
    err instanceof Error ? err.message : err);
}

