import type { SqlitePaymentStore } from "../../../packages/database/src/index.js";

export interface RefundBroadcaster {
  sendFromAccount(
    account: string,
    pool: "orchard" | "sapling",
    recipients: Array<{ address: string; amount: number }>,
  ): Promise<string>;
}

export async function executePartialRefund(options: {
  broadcaster: RefundBroadcaster;
  merchantAccountUuid: string;
  paymentTxid: string;
  amountZat: number;
  idempotencyKey: string;
  store: SqlitePaymentStore;
}): Promise<{ broadcast: boolean; txid: string }> {
  const payment = options.store.findByTxid(options.paymentTxid);
  if (!payment) throw new Error("Refund payment was not found.");

  options.store.prepareRefund(options.paymentTxid, {
    id: `refund_${payment.id.slice(0, 48)}`,
    paymentId: payment.id,
    idempotencyKey: options.idempotencyKey,
    amountZat: options.amountZat,
  });
  const claimed = options.store.claimRefundBroadcast(payment.id);

  if (claimed.status === "broadcast" || claimed.status === "confirmed") {
    if (!claimed.txid)
      throw new Error("Broadcast refund has no transaction ID.");
    return { broadcast: false, txid: claimed.txid };
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
    options.store.recordRefundBroadcast(payment.id, txid);
    return { broadcast: true, txid };
  } catch (error) {
    options.store.markRefundBroadcastUnknown(payment.id);
    throw error;
  }
}
