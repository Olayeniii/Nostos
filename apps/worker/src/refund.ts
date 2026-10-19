import type { SqlitePaymentStore } from "../../../packages/database/src/index.js";
import { orchardRefundReceiver } from "../../../packages/zcash-adapter/src/refund-route.js";

export interface RefundBroadcaster {
  spendableShieldedBalanceZat(account: string): Promise<number>;
  decodeUnifiedAddress?(address: string): Promise<Record<string, string>>;
  sendFromAccount(
    account: string,
    pool: "orchard" | "sapling",
    recipients: Array<{ address: string; amount: number }>,
  ): Promise<string>;
}

export class RefundFundingError extends Error {
  constructor() {
    super(
      "The merchant wallet cannot cover this refund plus its transaction fee. No refund was sent. Fund the merchant wallet before trying again.",
    );
  }
}

export async function executePartialRefund(options: {
  broadcaster: RefundBroadcaster;
  merchantAccountUuid: string;
  paymentTxid: string;
  amountZat: number;
  idempotencyKey: string;
  store: SqlitePaymentStore;
  allowMultiple?: boolean;
  authorizeBeforePrepare?: () => void;
}): Promise<{ broadcast: boolean; txid: string }> {
  const payment = options.store.findByTxid(options.paymentTxid);
  if (!payment) throw new Error("Refund payment was not found.");
  const existing = options.store.findRefundByKey(options.idempotencyKey);
  if (existing) {
    if (
      existing.paymentId !== payment.id ||
      existing.amountZat !== options.amountZat
    )
      throw new Error(
        "Refund instruction key conflicts with recorded payment or amount.",
      );
    if (existing.status === "broadcast" || existing.status === "confirmed") {
      const retried = options.store.recordRefundRetry(payment.id, existing.id);
      if (!retried.txid)
        throw new Error("Broadcast refund has no transaction ID.");
      return { broadcast: false, txid: retried.txid };
    }
    if (existing.status === "failed")
      throw new Error(
        "This refund instruction was closed without settlement. A new instruction requires fresh merchant authorization.",
      );
    if (existing.status === "broadcast_unknown")
      throw new Error("Refund broadcast state is unknown; retry is blocked.");
    if (existing.status === "broadcasting")
      throw new Error(
        "Refund broadcast is already in progress; reconcile before retrying.",
      );
  }
  // Fail before creating an instruction when receiver validation is unavailable.
  if (!options.broadcaster.decodeUnifiedAddress)
    throw new Error("Refund receiver validation is unavailable.");
  await orchardRefundReceiver(payment.refundAddress, {
    decodeUnifiedAddress: (address) =>
      options.broadcaster.decodeUnifiedAddress!(address),
  });
  const balance = await options.broadcaster.spendableShieldedBalanceZat(
    options.merchantAccountUuid,
  );
  if (!Number.isSafeInteger(balance) || balance < 0)
    throw new Error("Wallet balance is unavailable.");
  // This rules out a known funding shortfall. It is not a fee quote: even a
  // larger balance may be insufficient for the transaction selected by Zallet.
  if (balance <= options.amountZat) throw new RefundFundingError();
  options.authorizeBeforePrepare?.();

  const prepared = options.store.prepareRefund(
    options.paymentTxid,
    {
      id: options.allowMultiple
        ? options.idempotencyKey
        : `refund_${payment.id.slice(0, 48)}`,
      paymentId: payment.id,
      idempotencyKey: options.idempotencyKey,
      amountZat: options.amountZat,
    },
    options.allowMultiple,
  );
  const refundId = prepared.refund.id;
  const claimed = options.store.claimRefundBroadcast(payment.id, refundId);

  if (claimed.status === "broadcast" || claimed.status === "confirmed") {
    if (!claimed.txid)
      throw new Error("Broadcast refund has no transaction ID.");
    const retried = options.store.recordRefundRetry(payment.id, refundId);
    if (!retried.txid)
      throw new Error("Broadcast refund has no transaction ID.");
    return { broadcast: false, txid: retried.txid };
  }
  if (claimed.status === "broadcast_unknown") {
    throw new Error("Refund broadcast state is unknown; retry is blocked.");
  }
  if (claimed.status !== "broadcasting") {
    throw new Error(`Refund cannot broadcast from state ${claimed.status}.`);
  }

  try {
    const txid = await options.broadcaster.sendFromAccount(
      options.merchantAccountUuid,
      "orchard",
      [
        {
          address: payment.refundAddress,
          amount: options.amountZat / 100_000_000,
        },
      ],
    );
    options.store.recordRefundBroadcast(payment.id, txid, refundId);
    return { broadcast: true, txid };
  } catch (error) {
    options.store.markRefundBroadcastUnknown(payment.id, refundId);
    throw error;
  }
}
