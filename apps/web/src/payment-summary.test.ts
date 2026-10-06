import { describe, expect, it } from "vitest";
import { paymentSummary } from "./payment-summary.js";

function record(
  overrides: Partial<Parameters<typeof paymentSummary>[0][number]> = {},
) {
  return {
    orderReference: "order",
    paymentAmountZat: 2000000,
    paymentStatus: "confirmed",
    paymentConfirmations: 3,
    refundAmountZat: 0,
    status: "confirmed",
    ...overrides,
  };
}

describe("merchant accounting presentation", () => {
  it("does not present detected or unconfirmed value as confirmed receipts", () => {
    expect(
      paymentSummary([
        record(),
        record({ paymentStatus: "broadcast", paymentConfirmations: 0 }),
        record({ paymentStatus: "confirmed", paymentConfirmations: 0 }),
        record({ paymentStatus: "unpaid", paymentConfirmations: 0 }),
      ]),
    ).toMatchObject({
      confirmedPayments: 1,
      receivedZat: 2000000,
      confirmedRefunds: 0,
    });
  });

  it("separates confirmed partial refunds from reserved sends and remaining capability", () => {
    const partial = {
      ...record({
        refundAmountZat: 1900000,
        confirmedRefundAmountZat: 1800000,
        status: "broadcast",
        refunds: [{ status: "confirmed" }, { status: "broadcast" }],
      }),
      payment: { canRefund: false, availableZat: 100000 },
    };
    const available = {
      ...record(),
      payment: { canRefund: true, availableZat: 2000000 },
    };
    expect(paymentSummary([partial, available])).toEqual({
      confirmedPayments: 2,
      receivedZat: 4000000,
      refundedZat: 1800000,
      availableZat: 2000000,
      confirmedRefunds: 1,
    });
  });

  it("counts a legacy confirmed refund only when an amount was refunded", () => {
    expect(
      paymentSummary([record(), record({ refundAmountZat: 1800000 })]),
    ).toMatchObject({ confirmedRefunds: 1, refundedZat: 1800000 });
  });
});
