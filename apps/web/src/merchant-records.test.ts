import { describe, it, expect } from "vitest";
import {
  hasRefundActivity,
  refundBucket,
  refundRecordLabel,
  paymentHref,
  type RecordData,
} from "./merchant-records.js";
const record: RecordData = {
  id: "order/1",
  orderReference: "n_1",
  paymentStatus: "confirmed",
  paymentConfirmations: 12,
  paymentAmountZat: 2000000,
  refundAmountZat: 0,
  status: "no_refund",
};
const requested = {
  id: "r1",
  amountZat: 1000000,
  reason: "Wrong item",
  status: "requested",
  decisionReason: "",
  approvedZat: null,
  createdAt: "2026-10-20T00:00:00Z",
  decidedAt: null,
};
describe("merchant refund views", () => {
  it("does not present an ordinary paid order as refund activity", () => {
    expect(hasRefundActivity(record)).toBe(false);
  });
  it("separates a customer request from payment confirmation", () => {
    const r = { ...record, refundRequests: [requested] };
    expect(hasRefundActivity(r)).toBe(true);
    expect(refundBucket(r)).toBe("review");
    expect(refundRecordLabel(r)).toBe("Awaiting review");
  });
  it("keeps unknown sends in processing even when a request remains open", () => {
    const r = {
      ...record,
      status: "broadcast_unknown",
      refundRequests: [requested],
    };
    expect(refundBucket(r)).toBe("processing");
    expect(refundRecordLabel(r)).toBe("Refund outcome unknown");
  });
  it("uses the event ledger to retain processing work", () => {
    expect(
      refundBucket({
        ...record,
        refunds: [{ id: "f1", amountZat: 10, status: "broadcast" }],
      }),
    ).toBe("processing");
  });
  it("does not hide an active event behind an older record status", () => {
    expect(
      refundRecordLabel({
        ...record,
        status: "confirmed",
        refunds: [{ id: "f2", amountZat: 10, status: "broadcast_unknown" }],
      }),
    ).toBe("Refund outcome unknown");
  });
  it("retains declined requests as history without claiming a refund", () => {
    const r = {
      ...record,
      refundRequests: [{ ...requested, status: "declined" }],
    };
    expect(refundBucket(r)).toBe("history");
    expect(refundRecordLabel(r)).toBe("Request declined");
  });
  it("keeps partial confirmed refunds distinct from full settlement", () => {
    const r = {
      ...record,
      status: "confirmed",
      refundAmountZat: 1000000,
      confirmedRefundAmountZat: 1000000,
      remainingAmountZat: 1000000,
    };
    expect(refundBucket(r)).toBe("history");
    expect(refundRecordLabel(r)).toBe("Partially refunded");
  });
  it("encodes a payment reference for the existing detail screen", () => {
    expect(paymentHref(record.id)).toBe("/merchant#payment=order%2F1");
  });
});

it("uses verification stages while keeping confirmed partial refund labels", () => {
  const refund = {
    id: "r",
    amountZat: 50000,
    status: "broadcasting",
    observation: { stage: "output_unverified" as const },
  };
  const pending = {
    ...record,
    status: "broadcasting",
    refundAmountZat: 50000,
    refunds: [refund],
  };
  expect(refundRecordLabel(pending)).toBe(
    "Refund verification needs attention",
  );
  expect(
    refundRecordLabel({
      ...pending,
      status: "confirmed",
      remainingAmountZat: 50000,
      refunds: [{ ...refund, status: "confirmed" }],
    }),
  ).toBe("Partially refunded");
  expect(
    refundRecordLabel({
      ...pending,
      refunds: [{ ...refund, observation: { stage: "awaiting_detection" } }],
    }),
  ).toBe("Awaiting refund detection");
});
