import type { ReceiptData } from "./receipt-types.js";
import type { PaymentView } from "../../api/src/index.js";
export type RecordData = ReceiptData & {
  id: string;
  paymentStatus: string;
  payment?: PaymentView;
};
export type Dashboard = {
  merchant: { name: string; ready: boolean };
  records: RecordData[];
  syncWarning: boolean;
  observerPreview?: boolean;
  observerCommerceEnabled?: boolean;
  observerRecordChecksEnabled?: boolean;
};
export function paymentRecordStatus(r: RecordData) {
  if (r.status === "broadcast_unknown") return "Refund outcome unknown";
  if (r.status === "broadcasting") return "Refund being submitted";
  if (r.status === "failed")
    return (r.confirmedRefundAmountZat ?? 0) > 0
      ? "Partially refunded"
      : "Refund attempt closed";
  if (r.paymentStatus === "expired") return "Payment expired";
  return r.refundAmountZat > 0
    ? r.status === "confirmed"
      ? (r.remainingAmountZat ?? 0) > 0
        ? "Partially refunded"
        : "Refund confirmed"
      : "Refund pending"
    : r.paymentStatus === "confirmed"
      ? "Paid"
      : r.paymentStatus === "broadcast"
        ? "Confirming"
        : "Awaiting payment";
}

export type RefundBucket = "review" | "processing" | "history";
const activeRefundStates = new Set([
  "pending",
  "broadcasting",
  "broadcast",
  "broadcast_unknown",
]);
export function hasRefundActivity(record: RecordData) {
  return !!(
    record.refundRequests?.length ||
    record.refunds?.length ||
    record.refundAmountZat > 0 ||
    record.status === "failed" ||
    activeRefundStates.has(record.status)
  );
}
export function refundBucket(record: RecordData): RefundBucket {
  if (
    record.refunds?.some((refund) => activeRefundStates.has(refund.status)) ||
    activeRefundStates.has(record.status)
  )
    return "processing";
  if (record.refundRequests?.some((request) => request.status === "requested"))
    return "review";
  return "history";
}
export const paymentHref = (id: string) =>
  `/merchant#payment=${encodeURIComponent(id)}`;

export function refundRecordLabel(record: RecordData) {
  const states = [
    record.status,
    ...(record.refunds ?? []).map((refund) => refund.status),
  ];
  if (states.includes("broadcast_unknown")) return "Refund outcome unknown";
  if (states.includes("broadcasting")) return "Refund being submitted";
  if (states.some((state) => activeRefundStates.has(state)))
    return "Refund pending";
  if (
    record.refundAmountZat > 0 ||
    record.refunds?.length ||
    record.status === "failed" ||
    activeRefundStates.has(record.status)
  )
    return paymentRecordStatus(record);
  const latest = [...(record.refundRequests ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];
  if (latest?.status === "requested") return "Awaiting review";
  if (latest?.status === "declined") return "Request declined";
  if (latest?.status === "approved") return "Request approved";
  if (latest?.status === "settled") return "Refund confirmed";
  return "No refund issued";
}
