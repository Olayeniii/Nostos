import type { PaymentRecord } from "../../../packages/core/src/index.js";
import type { SqlitePaymentStore } from "../../../packages/database/src/index.js";
import { ZalletRpcClient } from "../../../packages/zcash-adapter/src/index.js";

export async function confirmRecordedRefund(
  store: SqlitePaymentStore,
  payment: PaymentRecord,
) {
  const refund = store.findRefundByPayment(payment.id);
  const url = process.env.NOSTOS_CUSTOMER_WALLET_RPC_URL;
  const cookieFile = process.env.NOSTOS_CUSTOMER_WALLET_RPC_COOKIE_FILE;
  if (refund?.status !== "broadcast" || !refund.txid || !url || !cookieFile)
    return;
  try {
    const transaction = await new ZalletRpcClient({
      url,
      cookieFile,
      timeoutMs: 5000,
    }).viewTransaction(refund.txid);
    if (
      transaction.confirmations > 0 &&
      transaction.outputs.some(
        (output) =>
          output.address === payment.refundAddress &&
          output.valueZat === refund.amountZat &&
          output.outgoing === false,
      )
    )
      store.confirmRefund(payment.id);
  } catch {
    /* Keep saved broadcast state when receipt cannot be verified. */
  }
}
