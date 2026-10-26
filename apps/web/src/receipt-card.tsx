"use client";
import { refundStageLabel, refundCheckMessages } from "./refund-status.js";
import { useState } from "react";
import { Mark } from "./mark.js";
import { StateLabel } from "./status-label.js";
import type { ReceiptData } from "./receipt-types.js";
export type { ReceiptData } from "./receipt-types.js";
export const zec = (amount: number) =>
  (amount / 1e8).toLocaleString("en", { maximumFractionDigits: 8 });
export function date(value?: string | null) {
  return value
    ? new Date(value).toLocaleString("en", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not recorded";
}
export function ReceiptCard({
  receipt,
  loading,
  onRefresh,
}: {
  receipt: ReceiptData;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState("");
  const refundConfirmed = receipt.status === "confirmed";
  const hasRefund = receipt.refundAmountZat > 0;
  const paid = receipt.paymentConfirmations > 0;
  const refundUnknown = ["broadcast_unknown", "broadcasting"].includes(
    receipt.status,
  );
  const refundFailed = receipt.status === "failed";
  const observation = receipt.refunds?.at(-1)?.observation;
  const refundText =
    observation && !refundConfirmed && !refundFailed
      ? refundStageLabel(observation.stage)
      : refundFailed
        ? hasRefund
          ? "Partially refunded"
          : "Refund attempt closed"
        : refundConfirmed
          ? (receipt.remainingAmountZat ?? 0) > 0
            ? "Partially refunded"
            : "Refund confirmed"
          : refundUnknown
            ? "Refund state being checked"
            : receipt.status === "broadcast"
              ? "Refund sent, awaiting confirmation"
              : receipt.status === "pending"
                ? "Refund being prepared"
                : "No refund issued";
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("Reference copied.");
    } catch {
      setCopied("Could not copy. Select the reference below.");
    }
  }
  return (
    <article className="receipt-card">
      <div className="receipt-top">
        <div className="receipt-brand">
          <Mark />
          <span>
            NOSTOS
            <br />
            <small>Private payment receipt</small>
          </span>
        </div>
        <span className="receipt-network">
          {receipt.network === "mainnet" ? "MAINNET" : "TESTNET"}
        </span>
      </div>
      <div className="receipt-total">
        <span>{paid ? "Payment received" : "Payment request"}</span>
        <h2>
          {zec(receipt.paymentAmountZat)} <small>ZEC</small>
        </h2>
        <span className={`receipt-pill ${paid ? "success" : ""}`}>
          {paid
            ? "Confirmed"
            : receipt.paymentStatus === "expired"
              ? "Payment request expired"
              : receipt.paymentStatus === "broadcast"
                ? "Confirming payment"
                : "Awaiting payment"}
        </span>
      </div>
      <div className="receipt-divider" />
      <dl className="receipt-facts">
        <div>
          <dt>Merchant</dt>
          <dd>{receipt.merchantName || "Merchant name not recorded"}</dd>
        </div>
        {receipt.description && (
          <div>
            <dt>For</dt>
            <dd>{receipt.description}</dd>
          </div>
        )}
        <div>
          <dt>Fulfillment</dt>
          <dd>
            {receipt.fulfillment
              ? `${receipt.fulfillment} (merchant reported)`
              : "Not reported"}
          </dd>
        </div>
        <div>
          <dt>{receipt.paidAt ? "Confirmed at" : "Created"}</dt>
          <dd>{date(receipt.paidAt ?? receipt.createdAt)}</dd>
        </div>
        <div>
          <dt>Order reference</dt>
          <dd className="mono">
            {receipt.orderReference.length > 24
              ? `${receipt.orderReference.slice(0, 12)}...${receipt.orderReference.slice(-6)}`
              : receipt.orderReference}
          </dd>
        </div>
      </dl>
      <section
        className={`receipt-refund ${refundConfirmed ? "complete" : ""}`}
        aria-label="Refund status"
      >
        <div className="receipt-refund-heading">
          <span className="refund-icon" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12" />
            </svg>
          </span>
          <h3>{refundText}</h3>
        </div>
        {hasRefund ? (
          <>
            <p className="refund-total">
              {zec(receipt.refundAmountZat)} <span>ZEC</span>
            </p>
            <p>
              {refundFailed
                ? "The latest attempt was closed without settlement. This total includes earlier confirmed refunds only."
                : refundConfirmed
                  ? "The shielded refund transaction is confirmed. Your wallet can verify receipt."
                  : observation
                    ? refundCheckMessages[observation.stage]
                    : refundUnknown
                      ? "Do not request another send while this transaction is being reconciled."
                      : "Sent to the refund route supplied with this payment."}
            </p>
          </>
        ) : (
          <p>
            {receipt.routeClosedReason === "expired"
              ? "The refund request window has ended. The return route has been removed from active product records."
              : receipt.canRequestRefund
                ? "You can request a refund to the shielded route supplied with this payment. The merchant reviews each request."
                : "Refund availability depends on the confirmed payment, its original shielded route and the refund window. Check the status below."}
          </p>
        )}
        {receipt.refundExpiresAt ? (
          <p className="privacy">
            Refund request window ends {date(receipt.refundExpiresAt)}.
          </p>
        ) : receipt.refundWindowDays ? (
          <p className="privacy">
            Refund request window: {receipt.refundWindowDays} days from payment
            confirmation.
          </p>
        ) : receipt.refundWindowDays === null ? (
          <p className="privacy">
            No refund deadline was set for this payment.
          </p>
        ) : null}
      </section>
      {receipt.confirmedRefundAmountZat !== undefined &&
        receipt.refundAmountZat > 0 && (
          <dl className="receipt-facts">
            <div>
              <dt>Refund confirmed</dt>
              <dd>{zec(receipt.confirmedRefundAmountZat)} ZEC</dd>
            </div>
            {!!receipt.pendingRefundAmountZat && (
              <div>
                <dt>Refund pending</dt>
                <dd>{zec(receipt.pendingRefundAmountZat)} ZEC</dd>
              </div>
            )}
            <div>
              <dt>Remaining payment value</dt>
              <dd>{zec(receipt.remainingAmountZat ?? 0)} ZEC</dd>
            </div>
          </dl>
        )}
      <details className="receipt-details">
        <summary>Payment and transaction details</summary>
        <div className="receipt-tx">
          <span>Order reference</span>
          <code>{receipt.orderReference}</code>
        </div>
        <dl className="receipt-facts">
          <div>
            <dt>Payment confirmations</dt>
            <dd>{receipt.paymentConfirmations}</dd>
          </div>
        </dl>
        {[
          ["Payment", receipt.paymentTxid],
          ["Refund", receipt.refundTxid],
        ].map(
          ([label, txid]) =>
            txid && (
              <div className="receipt-tx" key={label}>
                <span>{label} transaction</span>
                <code>{txid}</code>
                <button className="text-button" onClick={() => void copy(txid)}>
                  Copy reference
                </button>
              </div>
            ),
        )}
        {(receipt.refunds?.length ?? 0) > 1 && (
          <div className="refund-history">
            <h4>Refund history</h4>
            {receipt.refunds!.map((r) => (
              <div key={r.id}>
                <p>
                  {zec(r.amountZat)} ZEC,{" "}
                  {r.status === "failed"
                    ? "closed without payment"
                    : r.status === "confirmed"
                      ? "confirmed"
                      : "being checked"}
                </p>
                {r.txid && <code>{r.txid}</code>}
              </div>
            ))}
          </div>
        )}
        <p>
          This is NOSTOS application status, not a cryptographic payment
          disclosure. A transaction reference alone does not prove the amount or
          payer identity.
        </p>
        <p role="status">{copied}</p>
      </details>
      <div className="receipt-bottom">
        <span>Keep this receipt link private.</span>
        <button className="text-button" disabled={loading} onClick={onRefresh}>
          Refresh status
        </button>
      </div>
      {loading && <StateLabel state="loading" text="Checking receipt" />}
    </article>
  );
}
