import { runtimeNetwork } from "../../../packages/network/src/index.js";

export class MerchantCustodyError extends Error {
  constructor() {
    super(
      "Merchant-controlled mainnet wallets are not connected yet. Hosted wallet setup and spending are disabled on mainnet.",
    );
  }
}

// The existing adapter holds operator spending keys. A new account in that
// adapter is not merchant custody. No environment flag may bypass this gate.
export function assertHostedMerchantOperationsAllowed() {
  if (runtimeNetwork() === "mainnet") throw new MerchantCustodyError();
}
