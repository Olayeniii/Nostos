import { ZalletRpcClient } from "../../packages/zcash-adapter/src/index.js";
import { loadConfig } from "./lib/config.js";
import { decodeMemo } from "./lib/memo.js";
import { loadState, maskAddress, saveState } from "./lib/state.js";

const config = loadConfig();
const state = await loadState(config.statePath);
if (!state.merchant || !state.payment) {
  throw new Error("Send the customer payment before scanning it.");
}

const merchantRpc = new ZalletRpcClient(config.merchant);
const notes = await merchantRpc.listUnspent([state.merchant.fundingAddress]);
const note = notes.find((candidate) => candidate.txid === state.payment?.txid);
if (!note) throw new Error("Confirmed merchant payment note was not found.");

const memo = decodeMemo(note);
if (memo.o !== state.payment.orderReference)
  throw new Error("Recovered order reference does not match.");
if (memo.r !== state.payment.refundAddress)
  throw new Error("Recovered refund destination does not match.");

const receivers = await merchantRpc.decodeUnifiedAddress(memo.r);
if (!receivers.orchard || receivers.p2pkh || receivers.tex) {
  throw new Error("Refund destination is not an Orchard-only unified address.");
}
if (
  note.pool !== "ironwood" &&
  note.pool !== "orchard" &&
  note.pool !== "sapling"
) {
  throw new Error("Payment note pool is not supported by the spike.");
}

state.detected = {
  amountZec: note.value ?? note.amount ?? state.payment.amountZec,
  confirmations: note.confirmations ?? 1,
  pool: note.pool,
};
await saveState(config.statePath, state);

console.log("Merchant recovered the encrypted Nostos memo.");
console.log(`Order: ${memo.o}`);
console.log(`Refund route: ${maskAddress(memo.r)}`);
console.log(`Pool: ${state.detected.pool}`);
