import type { SqlitePaymentStore } from "../../../packages/database/src/index.js";
import { orchardRefundReceiver } from "../../../packages/zcash-adapter/src/refund-route.js";

export interface RefundBroadcaster {
  decodeUnifiedAddress?(address: string): Promise<Record<string, string>>;
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
  // Fail before creating an instruction when receiver validation is unavailable.
  if (!options.broadcaster.decodeUnifiedAddress)
    throw new Error("Refund receiver validation is unavailable.");
  await orchardRefundReceiver(payment.refundAddress, {
    decodeUnifiedAddress: (address) =>
      options.broadcaster.decodeUnifiedAddress!(address),
  });

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
    const retried = options.store.recordRefundRetry(payment.id);
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
    options.store.recordRefundBroadcast(payment.id, txid);
    return { broadcast: true, txid };
  } catch (error) {
    options.store.markRefundBroadcastUnknown(payment.id);
    throw error;
  }
}
