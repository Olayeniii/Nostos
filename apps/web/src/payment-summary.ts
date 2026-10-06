type SummaryRecord = {
  paymentStatus: string;
  paymentConfirmations: number;
  paymentAmountZat: number;
  refundAmountZat: number;
  confirmedRefundAmountZat?: number;
  status: string;
  refunds?: { status: string }[];
  payment?: { canRefund: boolean; availableZat: number };
};

export function paymentSummary(records: SummaryRecord[]) {
  const confirmed = records.filter(
    (r) => r.paymentStatus === "confirmed" && r.paymentConfirmations > 0,
  );
  return {
    confirmedPayments: confirmed.length,
    receivedZat: confirmed.reduce((sum, r) => sum + r.paymentAmountZat, 0),
    availableZat: confirmed.reduce(
      (sum, r) => sum + (r.payment?.canRefund ? r.payment.availableZat : 0),
      0,
    ),
    refundedZat: records.reduce(
      (sum, r) =>
        sum +
        (r.confirmedRefundAmountZat ??
          (r.status === "confirmed" ? r.refundAmountZat : 0)),
      0,
    ),
    confirmedRefunds: records.reduce(
      (sum, r) =>
        sum +
        (r.refunds?.filter((f) => f.status === "confirmed").length ??
          (r.status === "confirmed" && r.refundAmountZat > 0 ? 1 : 0)),
      0,
    ),
  };
}
