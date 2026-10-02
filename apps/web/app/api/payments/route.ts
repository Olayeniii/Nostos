import { authorized } from "../../../src/auth.js";
import { confirmRecordedRefund } from "../../../src/refund-confirmation.js";
import { paymentView } from "../../../../api/src/index.js";
import { SqlitePaymentStore } from "../../../../../packages/database/src/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = process.env.NOSTOS_WEB_TOKEN;
  const path = process.env.NOSTOS_DATABASE_PATH;
  if (!token || !path)
    return Response.json(
      { error: "Service is not configured" },
      { status: 503 },
    );
  if (!authorized(request, token)) {
    return Response.json(
      { error: "Merchant access is required" },
      { status: 401 },
    );
  }
  const store = new SqlitePaymentStore(path);
  try {
    for (const payment of store.listPayments())
      await confirmRecordedRefund(store, payment);
    return Response.json(
      {
        payments: store.listPayments().map((payment) => {
          const view = paymentView(
            payment,
            store.findRefundByPayment(payment.id),
          );
          return {
            ...view,
            canRefund:
              view.canRefund &&
              payment.id === process.env.NOSTOS_WEB_ALLOWED_PAYMENT_TXID,
          };
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    store.close();
  }
}
