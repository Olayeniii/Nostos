import { describe, expect, it, vi } from "vitest";
import type { PaymentRecord } from "../../../packages/core/src/index.js";
import { SqlitePaymentStore } from "../../../packages/database/src/index.js";
import { executePartialRefund } from "./refund.js";

const payment: PaymentRecord = {
  id: "a".repeat(64),
  merchantId: "merchant_001",
  orderReference: "order_001",
  paymentTxId: "a".repeat(64),
  amountZat: 2_000_000,
  refundAddress: `utest1${"b".repeat(80)}`,
  confirmations: 3,
  status: "confirmed",
};

function storeWithPayment(): SqlitePaymentStore {
  const store = new SqlitePaymentStore(":memory:");
  store.insertPayment(payment);
  return store;
}

describe("partial refund execution", () => {
  it("broadcasts once and returns the same txid on retry", async () => {
    const store = storeWithPayment();
    const sendFromAccount = vi.fn(async () => "c".repeat(64));
    const options = {
      broadcaster: { sendFromAccount },
      merchantAccountUuid: "merchant-account",
      paymentTxid: payment.paymentTxId,
      amountZat: 500_000,
      idempotencyKey: "payment_001_refund",
      store,
    };

    await expect(executePartialRefund(options)).resolves.toEqual({
      broadcast: true,
      txid: "c".repeat(64),
    });
    await expect(executePartialRefund(options)).resolves.toEqual({
      broadcast: false,
      txid: "c".repeat(64),
    });
    expect(sendFromAccount).toHaveBeenCalledTimes(1);
    expect(store.findRefundByPayment(payment.id)?.retryCount).toBe(1);
    store.close();
  });

  it("blocks retry when the broadcast result is unknown", async () => {
    const store = storeWithPayment();
    const sendFromAccount = vi.fn(async () => {
      throw new Error("connection closed");
    });
    const options = {
      broadcaster: { sendFromAccount },
      merchantAccountUuid: "merchant-account",
      paymentTxid: payment.paymentTxId,
      amountZat: 500_000,
      idempotencyKey: "payment_001_refund",
      store,
    };

    await expect(executePartialRefund(options)).rejects.toThrow(
      "connection closed",
    );
    await expect(executePartialRefund(options)).rejects.toThrow("unknown");
    expect(sendFromAccount).toHaveBeenCalledTimes(1);
    store.close();
  });

  it("rejects a refund larger than its payment", async () => {
    const store = storeWithPayment();
    await expect(
      executePartialRefund({
        broadcaster: { sendFromAccount: vi.fn() },
        merchantAccountUuid: "merchant-account",
        paymentTxid: payment.paymentTxId,
        amountZat: payment.amountZat + 1,
        idempotencyKey: "payment_001_refund",
        store,
      }),
    ).rejects.toThrow("cannot exceed");
    store.close();
  });
});
