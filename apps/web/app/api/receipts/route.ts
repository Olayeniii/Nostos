import { authorized } from "../../../src/auth.js";
import { trustedOrigin } from "../../../src/origin.js";
import {
  receiptAccessConfigured,
  receiptToken,
} from "../../../src/receipt-access.js";
import { SqlitePaymentStore } from "../../../../../packages/database/src/index.js";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!authorized(request, process.env.NOSTOS_WEB_TOKEN))
    return Response.json(
      { error: "Merchant access required" },
      { status: 401, headers },
    );
  if (
    !trustedOrigin(
      request.headers.get("origin"),
      process.env.NOSTOS_WEB_TRUSTED_ORIGINS,
    )
  )
    return Response.json(
      { error: "Request origin rejected" },
      { status: 403, headers },
    );
  const secret = process.env.NOSTOS_RECEIPT_SECRET;
  const path = process.env.NOSTOS_DATABASE_PATH;
  if (!path || !receiptAccessConfigured(secret))
    return Response.json(
      { error: "Receipt access is not configured" },
      { status: 503, headers },
    );
  const text = await request.text();
  if (text.length > 2048)
    return Response.json(
      { error: "Request too large" },
      { status: 413, headers },
    );
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json(
      { error: "Invalid request" },
      { status: 400, headers },
    );
  }
  const id =
    body && typeof body === "object" && "paymentTxid" in body
      ? body.paymentTxid
      : undefined;
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
    return Response.json(
      { error: "Invalid request" },
      { status: 400, headers },
    );
  const store = new SqlitePaymentStore(path);
  try {
    if (!store.findByTxid(id))
      return Response.json(
        { error: "Payment unavailable" },
        { status: 404, headers },
      );
    return Response.json(
      { receiptPath: `/receipt#${receiptToken(id, secret)}` },
      { headers },
    );
  } finally {
    store.close();
  }
}
