import Link from "next/link";
import { date, zec } from "./receipt-card.js";
import {
  refundBucket,
  refundRecordLabel,
  paymentHref,
  paymentRecordStatus,
  type RecordData,
} from "./merchant-records.js";
export function MerchantRecordList({
  records,
  refunds = false,
}: {
  records: RecordData[];
  refunds?: boolean;
}) {
  return (
    <ul className="studio-record-list">
      {records.map((record) => {
        const requested =
          record.refundRequests
            ?.filter((request) => request.status === "requested")
            .reduce((sum, request) => sum + request.amountZat, 0) ?? 0;
        const confirmed =
          record.confirmedRefundAmountZat ??
          (record.status === "confirmed" ? record.refundAmountZat : 0);
        const pending =
          record.pendingRefundAmountZat ??
          (refundBucket(record) === "processing"
            ? Math.max(0, record.refundAmountZat - confirmed)
            : 0);
        return (
          <li key={record.id}>
            <Link href={paymentHref(record.id)}>
              <span className="studio-record-name">
                <strong>{record.description || record.orderReference}</strong>
                <small>{record.orderReference}</small>
              </span>
              <span className="studio-record-value">
                {zec(
                  refunds
                    ? pending || requested || confirmed
                    : record.paymentAmountZat,
                )}{" "}
                <small>ZEC</small>
                {refunds && (
                  <small>
                    {pending
                      ? "In progress"
                      : requested
                        ? "Requested"
                        : "Confirmed refunds"}
                  </small>
                )}
              </span>
              <span className="studio-record-state">
                <span
                  className={`status-chip ${refunds && refundBucket(record) === "review" ? "pending" : record.status === "no_refund" ? record.paymentStatus : record.status}`}
                >
                  {refunds
                    ? refundRecordLabel(record)
                    : paymentRecordStatus(record)}
                </span>
                <small>
                  {refunds && requested
                    ? "Customer request open"
                    : `Fulfillment: ${record.fulfillment ?? "pending"}`}
                </small>
              </span>
              <span className="studio-record-date">
                {date(record.createdAt)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
