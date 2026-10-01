import { timingSafeEqual } from "node:crypto";
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
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const expectedBytes = Buffer.from(token);
  const suppliedBytes = Buffer.from(provided);
  if (
    expectedBytes.length !== suppliedBytes.length ||
    !timingSafeEqual(expectedBytes, suppliedBytes)
  ) {
    return Response.json({ error: "Demo access is required" }, { status: 401 });
  }
  const store = new SqlitePaymentStore(path);
  try {
    return Response.json(
      {
        payments: store
          .listPayments()
          .map((payment) =>
            paymentView(payment, store.findRefundByPayment(payment.id)),
          ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    store.close();
  }
}
