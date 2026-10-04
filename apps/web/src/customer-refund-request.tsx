"use client";
import { useState, useRef } from "react";
import { requestJson, parseZec } from "./requests.js";
import { zec, date, type ReceiptData } from "./receipt-card.js";

export function CustomerRefundRequest({
  receipt,
  token,
  onRefresh,
}: {
  receipt: ReceiptData;
  token: string;
  onRefresh: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const requestId = useRef<string | undefined>(undefined);
  return (
    <section
      className="refund-request-panel panel"
      aria-label="Request a refund"
    >
      <h2>Need a refund?</h2>
      <p>
        Request a full or partial refund from the merchant. No new address is
        needed. Refunds use the route supplied with this payment.
      </p>
      {receipt.refundPolicy && (
        <div className="refund-policy">
          <h3>Store refund policy</h3>
          <p className="preserve-lines">{receipt.refundPolicy}</p>
        </div>
      )}
      {receipt.refundExpiresAt && (
        <p>Request window ends {date(receipt.refundExpiresAt)}.</p>
      )}
      {receipt.refundRequests?.map((r) => (
        <article className="refund-request" key={r.id}>
          <div className="section-head">
            <strong>{zec(r.amountZat)} ZEC requested</strong>
            <span className="status-chip">
              {r.status === "requested"
                ? "Awaiting merchant decision"
                : r.status === "settled"
                  ? "Refund confirmed"
                  : r.status === "approved"
                    ? "Approved, refund being checked"
                    : "Declined"}
            </span>
          </div>
          <p className="preserve-lines">{r.reason}</p>
          {r.decisionReason && (
            <p className="preserve-lines">
              <strong>Merchant response: </strong>
              {r.decisionReason}
            </p>
          )}
          {r.approvedZat !== null && (
            <p>Approved amount: {zec(r.approvedZat)} ZEC.</p>
          )}
        </article>
      ))}
      {receipt.canRequestRefund ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (submitting.current) return;
            const value = parseZec(amount);
            if (
              !value ||
              value > (receipt.remainingAmountZat ?? 0) ||
              reason.trim().length < 3
            ) {
              setMessage(
                "Enter an amount within the remaining value and a reason.",
              );
              return;
            }
            submitting.current = true;
            setBusy(true);
            setMessage("");
            requestId.current ??= crypto.randomUUID();
            try {
              await requestJson(
                "/api/product/refund-request",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    requestId: requestId.current,
                    amountZat: value,
                    reason: reason.trim(),
                  }),
                },
                15000,
              );
              setMessage("Request sent. Your merchant will review it here.");
              setAmount("");
              setReason("");
              requestId.current = undefined;
              onRefresh();
            } catch {
              setMessage(
                "Could not confirm the request. Refresh this receipt before trying again.",
              );
              onRefresh();
            } finally {
              submitting.current = false;
              setBusy(false);
            }
          }}
        >
          <label>
            Requested refund in ZEC
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                requestId.current = undefined;
              }}
              required
              disabled={busy}
            />
          </label>
          <p>
            Remaining payment value: {zec(receipt.remainingAmountZat ?? 0)} ZEC.
          </p>
          <label>
            Reason
            <textarea
              minLength={3}
              maxLength={1000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                requestId.current = undefined;
              }}
              required
              disabled={busy}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Sending request" : "Request refund"}
          </button>
        </form>
      ) : (
        <p className="privacy">
          {receipt.routeClosedReason === "expired"
            ? "The store's refund request window has ended."
            : receipt.refundRequests?.some((r) =>
                  ["requested", "approved"].includes(r.status),
                )
              ? "Your open request is shown above. This receipt will update when the merchant responds."
              : (receipt.remainingAmountZat ?? 0) > 0 &&
                  receipt.paymentConfirmations > 0
                ? "Refund requests are unavailable for this payment. Contact the merchant using your order reference."
                : receipt.paymentConfirmations > 0
                  ? "This payment has no remaining value to refund."
                  : "Refund requests become available after payment confirmation."}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <p className="privacy">
        Anyone holding this private receipt link can submit a request. Only the
        merchant can authorize a refund.
      </p>
    </section>
  );
}
