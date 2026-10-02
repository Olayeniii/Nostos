import type {
  PaymentRecord,
  RefundRecord,
} from "../../../packages/core/src/index.js";

export interface PaymentView {
  id: string;
  orderReference: string;
  receivedZat: number;
  refundedZat: number;
  reservedZat: number;
  availableZat: number;
  confirmations: number;
  destination: string;
  status: string;
  canRefund: boolean;
  refundTxid?: string;
}

// Explicit allowlist: never spread wallet/domain records into browser responses.
export function paymentView(
  payment: PaymentRecord,
  refund?: RefundRecord,
): PaymentView {
  const refundedZat = refund?.status === "confirmed" ? refund.amountZat : 0;
  const reservedZat =
    refund && refund.status !== "confirmed" ? refund.amountZat : 0;
  return {
    id: payment.id,
    orderReference: payment.orderReference,
    receivedZat: payment.amountZat,
    refundedZat,
    reservedZat,
    availableZat: payment.amountZat - refundedZat - reservedZat,
    confirmations: payment.confirmations,
    destination: payment.refundAddress
      ? `${payment.refundAddress.slice(0, 8)}...${payment.refundAddress.slice(-8)}`
      : "Route removed after confirmed refund",
    status: refund?.status ?? payment.status,
    // The current core supports one refund instruction per payment.
    canRefund:
      !refund && payment.status === "confirmed" && payment.confirmations > 0,
    ...(refund?.txid ? { refundTxid: refund.txid } : {}),
  };
}
