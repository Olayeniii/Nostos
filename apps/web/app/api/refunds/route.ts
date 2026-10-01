import { submitRefund } from "../../../../api/src/refund-request.js";
import { SqlitePaymentStore } from "../../../../../packages/database/src/index.js";
import { ZalletRpcClient } from "../../../../../packages/zcash-adapter/src/index.js";
import { authorized } from "../../../src/auth.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!authorized(request, process.env.NOSTOS_WEB_TOKEN))
    return Response.json({ error: "Demo access required" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    return Response.json({ error: "Request origin rejected" }, { status: 403 });
  const path = process.env.NOSTOS_DATABASE_PATH;
  const url = process.env.NOSTOS_MERCHANT_WALLET_RPC_URL;
  const cookieFile = process.env.NOSTOS_MERCHANT_WALLET_RPC_COOKIE_FILE;
  const account = process.env.NOSTOS_MERCHANT_ACCOUNT_UUID;
  if (!path || !url || !cookieFile || !account)
    return Response.json(
      { error: "Refund service is not configured" },
      { status: 503 },
    );
  const text = await request.text();
  if (text.length > 2048)
    return Response.json({ error: "Request too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const allowedPayment = process.env.NOSTOS_WEB_ALLOWED_PAYMENT_TXID;
  if (
    !allowedPayment ||
    !body ||
    typeof body !== "object" ||
    (body as Record<string, unknown>).paymentTxid !== allowedPayment
  ) {
    return Response.json(
      { error: "This payment is not enabled for the controlled demo" },
      { status: 403 },
    );
  }
  const store = new SqlitePaymentStore(path);
  try {
    const result = await submitRefund(body, {
      store,
      broadcaster: new ZalletRpcClient({ url, cookieFile }),
      merchantAccountUuid: account,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Never return raw wallet errors, which may contain destinations or memos.
    return Response.json(
      {
        error:
          "Refund was not completed. Refresh the recorded status before any retry.",
      },
      { status: 409 },
    );
  } finally {
    store.close();
  }
}
