import {
  receiptAccessConfigured,
  receiptAuthorized,
} from "../../../src/receipt-access.js";
import { confirmRecordedRefund } from "../../../src/refund-confirmation.js";
import { SqlitePaymentStore } from "../../../../../packages/database/src/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const secret = process.env.NOSTOS_RECEIPT_SECRET;
  const path = process.env.NOSTOS_DATABASE_PATH;
  if (!path || !receiptAccessConfigured(secret))
    return Response.json(
      { error: "Receipt access is unavailable" },
      { status: 503, headers },
    );
  // Reject unscoped access before opening storage. Never accept merchant access here.
  if (
    !/^Bearer [A-Za-z0-9_-]{43}$/.test(
      request.headers.get("authorization") ?? "",
    )
  )
    return Response.json(
      { error: "Private receipt access required" },
      { status: 401, headers },
    );
  let store: SqlitePaymentStore | undefined;
  try {
    store = new SqlitePaymentStore(path);
    const payment = store
      .listPayments()
      .find((p) => receiptAuthorized(request, p.id, secret));
    if (!payment)
      return Response.json(
        { error: "Private receipt access required" },
        { status: 401, headers },
      );
    await confirmRecordedRefund(store, payment);
    const refund = store.findRefundByPayment(payment.id);
    // Separate customer projection. No merchant list, destination or refund permission.
    return Response.json(
      {
        receipt: {
          orderReference: payment.orderReference,
          paymentTxid: payment.paymentTxId,
          paymentAmountZat: payment.amountZat,
          paymentConfirmations: payment.confirmations,
          refundAmountZat: refund?.amountZat ?? 0,
          status: refund?.status ?? "no_refund",
          ...(refund?.txid ? { refundTxid: refund.txid } : {}),
        },
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: "Service temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    store?.close();
  }
}
