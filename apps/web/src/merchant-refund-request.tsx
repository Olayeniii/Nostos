"use client";
import { ExternalWalletRefund } from "./external-wallet-refund.js";
import { useRef, useState } from "react";
import { requestJson, parseZec } from "./requests.js";
import { zec, type ReceiptData } from "./receipt-card.js";

type RequestData = NonNullable<ReceiptData["refundRequests"]>[number];
export function MerchantRefundRequest({
  request,
  refund,
  safe,
  externalWallet = false,
  onRefresh,
}: {
  request: RequestData;
  refund?: NonNullable<ReceiptData["refunds"]>[number];
  safe: boolean;
  externalWallet?: boolean;
  onRefresh: () => void;
}) {
  const [amount, setAmount] = useState(
    zec(request.approvedZat ?? request.amountZat).replaceAll(",", ""),
  );
  const [reason, setReason] = useState(request.decisionReason);
  const [review, setReview] = useState<"approve" | "decline">();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  async function decide(decision: "approve" | "decline") {
    if (!safe || submitting.current) return;
    const value = parseZec(amount);
    if (
      reason.trim().length < 3 ||
      (decision === "approve" && (!value || value > request.amountZat))
    ) {
      setMessage("Enter a reason and an approval amount within the request.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      await requestJson(
        "/api/product/refund-decision",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: request.id,
            decision,
            reason: reason.trim(),
            ...(decision === "approve" ? { amountZat: value } : {}),
          }),
        },
        130000,
      );
      setReview(undefined);
      onRefresh();
    } catch {
      setMessage(
        "The decision or send outcome is not confirmed. Refresh the recorded state before another action.",
      );
      onRefresh();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="refund-request-panel"
      aria-label="Customer refund request"
    >
      <div className="section-head">
        <h3>Customer refund request</h3>
        <span className="status-chip">
          {request.status === "settled" ? "Refund confirmed" : request.status}
        </span>
      </div>
      <strong>{zec(request.amountZat)} ZEC requested</strong>
      <p className="preserve-lines">{request.reason}</p>
      {request.status === "requested" ? (
        <>
          <label>
            Approval amount in ZEC
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setReview(undefined);
              }}
              disabled={busy || !!review}
            />
          </label>
          <label>
            Reason for your decision
            <textarea
              minLength={3}
              maxLength={1000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setReview(undefined);
              }}
              disabled={busy || !!review}
            />
          </label>
          {!review ? (
            <div className="refund-actions">
              <button
                className="primary"
                disabled={
                  !safe || busy || !parseZec(amount) || reason.trim().length < 3
                }
                onClick={() => setReview("approve")}
              >
                Review approval
              </button>
              <button
                className="secondary"
                disabled={!safe || busy || reason.trim().length < 3}
                onClick={() => setReview("decline")}
              >
                Review decline
              </button>
            </div>
          ) : (
            <div className="refund-review">
              <p>
                {review === "approve"
                  ? externalWallet
                    ? `Approve ${zec(parseZec(amount))} ZEC? You will review and sign separately in your wallet.`
                    : `Approve and send ${zec(parseZec(amount))} ZEC to the route supplied with this payment?`
                  : "Decline this request with the reason above? No funds will be sent."}
              </p>
              <button
                className="primary"
                disabled={!safe || busy}
                onClick={() => void decide(review)}
              >
                {busy
                  ? "Saving decision"
                  : review === "approve"
                    ? externalWallet
                      ? "Save approval"
                      : `Approve and send ${zec(parseZec(amount))} ZEC`
                    : "Confirm decline"}
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setReview(undefined)}
              >
                Change decision
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {request.decisionReason && (
            <p className="preserve-lines">
              Your response: {request.decisionReason}
            </p>
          )}
          {request.approvedZat !== null && (
            <p>Approved: {zec(request.approvedZat)} ZEC.</p>
          )}
          {request.status === "approved" && !refund && !externalWallet && (
            <button
              className="secondary"
              disabled={!safe || busy}
              onClick={() => void decide("approve")}
            >
              Resume approved refund
            </button>
          )}
          {request.status === "approved" && refund && !externalWallet && (
            <p>
              Refund{" "}
              {refund.status === "broadcast"
                ? "sent, awaiting confirmation"
                : "state being checked"}
              . Refresh before any further action.
            </p>
          )}
        </>
      )}
      {externalWallet && request.status === "approved" && (
        <ExternalWalletRefund
          requestId={request.id}
          observation={refund?.observation}
          safe={safe}
          onRefresh={onRefresh}
        />
      )}
      {message && (
        <p className="warning" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
