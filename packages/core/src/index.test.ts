import { describe, expect, it } from "vitest";
import {
  DomainValidationError,
  RefundIdempotencyRegistry,
  parsePaymentRecord,
  parseRefundIntent,
  transitionPayment,
  type PaymentRecord,
} from "./index.js";

const paymentInput = {
  id: "payment_001",
  merchantId: "merchant_001",
  orderReference: "order_001",
  paymentTxId: "a".repeat(64),
  amountZat: 2_000_000,
  refundAddress: `utest1${"b".repeat(80)}`,
  confirmations: 2,
  status: "confirmed",
} as const;

function confirmedPayment(): PaymentRecord {
  return parsePaymentRecord(paymentInput);
}

describe("payment schema", () => {
  it("accepts a valid confirmed shielded payment", () => {
    expect(confirmedPayment()).toEqual(paymentInput);
  });

  it.each([
    ["fractional zatoshi", { amountZat: 1.5 }],
    ["negative confirmations", { confirmations: -1 }],
    ["unsafe order reference", { orderReference: "order 001" }],
    ["invalid transaction id", { paymentTxId: "not-a-txid" }],
    ["invalid refund address", { refundAddress: "transparent-address" }],
  ])("rejects %s", (_label, override) => {
    expect(() => parsePaymentRecord({ ...paymentInput, ...override })).toThrow(
      DomainValidationError,
    );
  });
});

describe("refund schema", () => {
  it("accepts a partial refund", () => {
    expect(
      parseRefundIntent(
        {
          id: "refund_001",
          paymentId: "payment_001",
          idempotencyKey: "payment_001_refund",
          amountZat: 500_000,
        },
        confirmedPayment(),
      ),
    ).toMatchObject({ amountZat: 500_000 });
  });

  it("rejects a refund greater than the payment", () => {
    expect(() =>
      parseRefundIntent(
        {
          id: "refund_001",
          paymentId: "payment_001",
          idempotencyKey: "payment_001_refund",
          amountZat: 2_000_001,
        },
        confirmedPayment(),
      ),
    ).toThrow("cannot exceed");
  });

  it("rejects refund creation after broadcast", () => {
    expect(() =>
      parseRefundIntent(
        {
          id: "refund_002",
          paymentId: "payment_001",
          idempotencyKey: "payment_001_second",
          amountZat: 1,
        },
        { ...confirmedPayment(), status: "refund_broadcast" },
      ),
    ).toThrow("not eligible");
  });
});

describe("payment state changes", () => {
  it("supports the successful refund path", () => {
    const pending = transitionPayment(confirmedPayment(), "refund_pending");
    const broadcast = transitionPayment(pending, "refund_broadcast");
    expect(transitionPayment(broadcast, "refunded").status).toBe("refunded");
  });

  it("requires reconciliation after unknown broadcast state", () => {
    const pending = transitionPayment(confirmedPayment(), "refund_pending");
    const unknown = transitionPayment(pending, "broadcast_unknown");
    expect(() => transitionPayment(unknown, "refund_pending")).toThrow(
      "Cannot transition",
    );
    expect(transitionPayment(unknown, "refund_broadcast").status).toBe(
      "refund_broadcast",
    );
  });

  it("rejects a second completed refund", () => {
    expect(() =>
      transitionPayment(
        { ...confirmedPayment(), status: "refunded" },
        "refund_pending",
      ),
    ).toThrow("Cannot transition");
  });
});

describe("refund idempotency", () => {
  const intent = {
    id: "refund_001",
    paymentId: "payment_001",
    idempotencyKey: "payment_001_refund",
    amountZat: 500_000,
  } as const;

  it("returns the original instruction for an exact retry", () => {
    const registry = new RefundIdempotencyRegistry();
    expect(registry.register(intent).created).toBe(true);
    expect(registry.register({ ...intent }).created).toBe(false);
  });

  it("blocks another instruction for the same payment", () => {
    const registry = new RefundIdempotencyRegistry();
    registry.register(intent);
    expect(() =>
      registry.register({
        ...intent,
        id: "refund_002",
        idempotencyKey: "payment_001_second",
      }),
    ).toThrow("already exists");
  });

  it("blocks reuse of a key with different terms", () => {
    const registry = new RefundIdempotencyRegistry();
    registry.register(intent);
    expect(() => registry.register({ ...intent, amountZat: 400_000 })).toThrow(
      "already used",
    );
  });
});
