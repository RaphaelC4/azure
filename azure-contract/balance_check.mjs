// balance_check.mjs — scratch: print AGENT_A address + balances on both nets.
import { createClient, createAccount } from "genlayer-js";
import { studioDevnet, studionet } from "genlayer-js/chains";
import { formatEther } from "viem";

const key = process.env.AGENT_A_PRIVATE_KEY;
const account = createAccount(key);
console.log("AGENT_A address:", account.address);

for (const [name, chain] of [["studio-dev(61997)", studioDevnet], ["studionet(61999)", studionet]]) {
  const client = createClient({ chain, account });
  try {
    const bal = await client.getBalance({ address: account.address });
    console.log(`${name}: ${formatEther(bal)} GEN  (raw ${bal})`);
  } catch (err) {
    console.log(`${name}: getBalance failed — ${err instanceof Error ? err.message : err}`);
  }
}
