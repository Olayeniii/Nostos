import { ZalletRpcClient } from "../../packages/zcash-adapter/src/index.js";
import { loadConfig } from "./lib/config.js";
import { loadState, maskAddress, saveState } from "./lib/state.js";

const config = loadConfig();
const state = await loadState(config.statePath);
if (!state.merchant || !state.payment || !state.detected) {
  throw new Error(
    "Scan and validate the merchant payment before sending a refund.",
  );
}
if (state.refund)
  throw new Error(`Refund already exists: ${state.refund.txid}`);

const merchantRpc = new ZalletRpcClient(config.merchant);
const txid = await merchantRpc.sendFromAccount(
  state.merchant.accountUuid,
  state.detected.pool,
  [{ address: state.payment.refundAddress, amount: config.refundZec }],
);

state.refund = { amountZec: config.refundZec, txid };
await saveState(config.statePath, state);

console.log("Shielded merchant refund broadcast.");
console.log(`Transaction: ${txid}`);
console.log(`Destination: ${maskAddress(state.payment.refundAddress)}`);
