import { ZalletRpcClient } from "../../packages/zcash-adapter/src/index.js";
import { loadConfig } from "./lib/config.js";
import { loadState, maskAddress, saveState } from "./lib/state.js";

const config = loadConfig();
const state = await loadState(config.statePath);
const customerRpc = new ZalletRpcClient(config.customer);
const merchantRpc = new ZalletRpcClient(config.merchant);

if (!state.customer) {
  const accountUuid = await customerRpc.createAccount("nostos-customer");
  state.customer = {
    accountUuid,
    fundingAddress: await customerRpc.deriveOrchardAddress(accountUuid),
  };
}

if (!state.merchant) {
  const accountUuid = await merchantRpc.createAccount("nostos-merchant");
  state.merchant = {
    accountUuid,
    fundingAddress: await merchantRpc.deriveOrchardAddress(accountUuid),
  };
}

state.network = config.network;
await saveState(config.statePath, state);

console.log("Gate G1 demo wallets are ready.");
console.log(`Network: ${state.network}`);
console.log(`Customer funding address: ${state.customer.fundingAddress}`);
console.log(`Merchant address: ${maskAddress(state.merchant.fundingAddress)}`);
console.log(
  "Fund only the customer address with isolated testnet ZEC, then wait for confirmation.",
);
