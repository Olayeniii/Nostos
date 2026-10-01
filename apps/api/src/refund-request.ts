import {
  executePartialRefund,
  type RefundBroadcaster,
} from "../../worker/src/refund.js";
import type { SqlitePaymentStore } from "../../../packages/database/src/index.js";

export async function submitRefund(
  body: unknown,
  options: {
    store: SqlitePaymentStore;
    broadcaster: RefundBroadcaster;
    merchantAccountUuid: string;
  },
) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Invalid request");
  const input = body as Record<string, unknown>;
  if (
    typeof input.paymentTxid !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.paymentTxid) ||
    typeof input.amountZat !== "number" ||
    !Number.isSafeInteger(input.amountZat) ||
    input.amountZat <= 0
  ) {
    throw new Error("Invalid refund amount or payment identifier");
  }
  return executePartialRefund({
    ...options,
    paymentTxid: input.paymentTxid,
    amountZat: input.amountZat,
    idempotencyKey: `refund_${input.paymentTxid.slice(0, 48)}`,
  });
}
