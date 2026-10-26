export type ReceiptData = {
  network?: "mainnet" | "testnet";
  id?: string;
  merchantName?: string;
  description?: string;
  orderReference: string;
  paymentAmountZat: number;
  paymentConfirmations: number;
  refundAmountZat: number;
  status: string;
  paymentStatus?: string;
  requestDropped?: boolean;
  fulfillment?: "pending" | "fulfilled" | "failed";
  paymentTxid?: string | null;
  refundTxid?: string;
  createdAt?: string;
  paidAt?: string | null;
  confirmedRefundAmountZat?: number;
  pendingRefundAmountZat?: number;
  remainingAmountZat?: number;
  refunds?: {
    id: string;
    amountZat: number;
    status: string;
    txid?: string;
    observation?: {
      stage: import("./refund-status.js").RefundCheckCode;
      checkedAt?: string;
    };
  }[];
  refundRequests?: {
    id: string;
    amountZat: number;
    reason: string;
    status: string;
    decisionReason: string;
    approvedZat: number | null;
    createdAt: string;
    decidedAt: string | null;
  }[];
  canRequestRefund?: boolean;
  canRecoverRoute?: boolean;
  refundPolicy?: string;
  refundExpiresAt?: string | null;
  refundWindowDays?: number | null;
  routeClosedReason?: string | null;
};
