import { describe, expect, it } from "vitest";
import { paymentView } from "./index.js";
import type {
  PaymentRecord,
  RefundRecord,
} from "../../../packages/core/src/index.js";

const payment: PaymentRecord = {
  id: "a".repeat(64),
  merchantId: "merchant",
  orderReference: "order-001",
  paymentTxId: "a".repeat(64),
  amountZat: 1_000_000,
  refundAddress: `utest1${"b".repeat(80)}`,
  confirmations: 3,
  status: "confirmed",
};
const refund: RefundRecord = {
  id: "refund",
  paymentId: payment.id,
  idempotencyKey: "private-key",
  amountZat: 300_000,
  status: "confirmed",
  retryCount: 1,
  txid: "c".repeat(64),
};

describe("browser payment projection", () => {
  it("excludes the full refund destination and internal identifiers", () => {
    const response = JSON.stringify(paymentView(payment, refund));
    expect(response).not.toContain(payment.refundAddress);
    expect(response).not.toContain("idempotencyKey");
    expect(response).not.toContain("merchantId");
  });
  it("shows accurate amounts but blocks another refund under the current core", () => {
    expect(paymentView(payment, refund)).toMatchObject({
      refundedZat: 300_000,
      availableZat: 700_000,
      canRefund: false,
    });
  });
  it("holds value while broadcast is unknown", () => {
    expect(
      paymentView(payment, { ...refund, status: "broadcast_unknown" }),
    ).toMatchObject({
      reservedZat: 300_000,
      refundedZat: 0,
      canRefund: false,
    });
  });
});
