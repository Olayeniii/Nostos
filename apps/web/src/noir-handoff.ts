import {
  addressOnNetwork,
  type Network,
} from "../../../packages/network/src/index.js";
// Minimal published Noir injected-provider interface. No WalletConnect transport.
export type NoirProvider = {
  request(args: {
    method: string;
    params?: readonly unknown[];
  }): Promise<unknown>;
};
export type PreparedWalletPayment = {
  network?: Network;
  destination: string;
  amountZat: number;
  memo: string;
};
export function injectedNoir(surface: unknown): NoirProvider | undefined {
  try {
    const wallet = (
      surface as
        | { noirwallet?: { isNoirWallet?: boolean; zcash?: NoirProvider } }
        | undefined
    )?.noirwallet;
    return wallet?.isNoirWallet === true &&
      typeof wallet.zcash?.request === "function"
      ? wallet.zcash
      : undefined;
  } catch {
    return undefined;
  }
}

export class NoirHandoffError extends Error {}

export class NoirHandoff {
  private requested = false;
  private connecting = false;

  async send(
    provider: NoirProvider,
    payment: PreparedWalletPayment,
    beforeSend?: () => Promise<void>,
  ): Promise<string> {
    if (this.requested || this.connecting)
      throw new NoirHandoffError(
        "A wallet request is already in progress. Check your wallet and receipt before sending again.",
      );
    // The server prepares and validates the receivers. These checks prevent a
    // malformed handoff from changing network, amount or private memo semantics.
    if (
      !addressOnNetwork(payment.destination, payment.network ?? "testnet") ||
      !Number.isSafeInteger(payment.amountZat) ||
      payment.amountZat <= 0 ||
      new TextEncoder().encode(payment.memo).length > 512
    )
      throw new NoirHandoffError(
        "Payment instructions are unavailable. Refresh the payment page.",
      );
    let memo: { p?: unknown; v?: unknown; o?: unknown; r?: unknown };
    try {
      memo = JSON.parse(payment.memo);
    } catch {
      throw new NoirHandoffError(
        "Payment instructions are unavailable. Refresh the payment page.",
      );
    }
    if (
      memo?.p !== "nostos" ||
      memo.v !== 1 ||
      typeof memo.o !== "string" ||
      !/^n_[a-f0-9]{32}$/.test(memo.o) ||
      typeof memo.r !== "string" ||
      !addressOnNetwork(memo.r, payment.network ?? "testnet")
    )
      throw new NoirHandoffError(
        "Payment instructions are unavailable. Refresh the payment page.",
      );
    this.connecting = true;
    try {
      let account: unknown;
      try {
        account = await provider.request({ method: "zcash_getAccounts" });
      } catch {
        throw new NoirHandoffError(
          "Noir could not read its connection state. No payment was requested.",
        );
      }
      // Noir returns null when this origin has no authorization. Reuse an
      // existing account instead of reopening Connect before every payment.
      // Errors or malformed accounts must not be treated as disconnected.
      if (account === null) {
        try {
          account = await provider.request({ method: "zcash_requestAccounts" });
        } catch {
          throw new NoirHandoffError(
            "Noir could not connect. No payment was requested.",
          );
        }
      }
      const address = (account as { shielded?: unknown } | null)?.shielded;
      // A configured adapter network is not wallet network evidence. Require
      // the selected wallet to return a shielded testnet address before sending.
      if (
        typeof address !== "string" ||
        !addressOnNetwork(address, payment.network ?? "testnet")
      )
        throw new NoirHandoffError(
          "Noir did not return a shielded account on the payment network. No payment was requested.",
        );
      if (beforeSend) {
        try {
          await beforeSend();
        } catch {
          throw new NoirHandoffError(
            "Payment availability could not be confirmed. No payment was requested. Check your receipt before paying.",
          );
        }
      }
      this.requested = true;
      let txid: unknown;
      try {
        txid = await provider.request({
          method: "zcash_sendTransaction",
          params: [
            {
              to: payment.destination,
              amount: (payment.amountZat / 1e8).toFixed(8),
              memo: payment.memo,
              fundingSource: "shielded",
            },
          ],
        });
      } catch {
        // A rejected promise can follow broadcast. Never retry automatically or
        // turn it into a manual-send invitation, even if it looks like cancellation.
        throw new NoirHandoffError(
          "Noir did not report a completed send. Check your wallet and receipt before sending again.",
        );
      }
      if (typeof txid !== "string" || !/^[a-f0-9]{64}$/i.test(txid))
        throw new NoirHandoffError(
          "Noir did not return a transaction ID. Check your wallet and receipt before sending again.",
        );
      return txid;
    } finally {
      this.connecting = false;
    }
  }

  get busy() {
    return this.connecting;
  }

  get paymentRequested() {
    return this.requested;
  }
}
