import { ZalletRpcClient } from "../../packages/zcash-adapter/src/index.js";
import { loadConfig } from "./lib/config.js";
import { encodeMemo } from "./lib/memo.js";
import { loadState, maskAddress, saveState } from "./lib/state.js";

const config = loadConfig();
const state = await loadState(config.statePath);
if (!state.customer || !state.merchant) {
  throw new Error("Run pnpm spike:setup before sending a payment.");
}
if (state.payment) {
  throw new Error(`Payment already exists: ${state.payment.txid}`);
}

const customerRpc = new ZalletRpcClient(config.customer);
const refundAddress = await customerRpc.deriveOrchardAddress(
  state.customer.accountUuid,
);
const memoHex = encodeMemo(config.orderReference, refundAddress);
const txid = await customerRpc.sendFromAccount(
  state.customer.accountUuid,
  "orchard",
  [
    {
      address: state.merchant.fundingAddress,
      amount: config.paymentZec,
      memo: memoHex,
    },
  ],
);

state.payment = {
  amountZec: config.paymentZec,
  memoHex,
  orderReference: config.orderReference,
  refundAddress,
  txid,
};
await saveState(config.statePath, state);

console.log("Shielded customer payment broadcast.");
console.log(`Transaction: ${txid}`);
console.log(`Refund route: ${maskAddress(refundAddress)}`);
