"use client";
import { useEffect, useRef, useState } from "react";
import { requestJson } from "./requests.js";
import { zec } from "./receipt-card.js";
type Review = {
  recipient: string;
  amountZat: number;
  memo: string;
  feeCapZat: number;
  handoffStarted: boolean;
  uri?: string;
};
export function ExternalWalletRefund({
  requestId,
  safe,
  onRefresh,
}: {
  requestId: string;
  safe: boolean;
  onRefresh: () => void;
}) {
  const [feeCapZat, setFeeCapZat] = useState("10000");
  const [review, setReview] = useState<Review>();
  const [password, setPassword] = useState("");
  const [txid, setTxid] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(false);
  async function act(action: "review" | "handoff" | "candidate" | "check") {
    if (!safe || active.current) return;
    active.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await requestJson<Review>(
        `/api/product/refund-${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId,
            ...(action === "review" ? { feeCapZat: Number(feeCapZat) } : {}),
            ...(action === "handoff" ? { password } : {}),
            ...(action === "candidate" ? { txid: txid.trim() } : {}),
          }),
        },
        30000,
      );
      if (action === "review") setReview(result);
      if (action === "handoff") setReview({ ...result, handoffStarted: true });
      if (action === "candidate")
        setMessage(
          "Transaction reference saved. Check confirmation after three blocks. Do not send again.",
        );
      if (action === "check") {
        setMessage("Refund verified.");
        onRefresh();
      }
    } catch {
      if (action === "handoff")
        setReview(
          (previous) =>
            previous && { ...previous, handoffStarted: true, uri: undefined },
        );
      setMessage(
        action === "handoff"
          ? "Wallet handoff outcome is unknown. Review saved instructions and wallet history. Do not send again."
          : "Not verified yet. Keep the saved transaction and check again. Do not send again.",
      );
    } finally {
      setPassword("");
      setBusy(false);
      active.current = false;
    }
  }
  useEffect(() => {
    if (!safe || !review?.handoffStarted) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void act("check");
    }, 15000);
    return () => window.clearInterval(timer);
  }, [safe, review?.handoffStarted, requestId]);
  return (
    <div className="refund-review">
      <p>
        Your wallet signs this refund. NOSTOS verifies the exact outgoing
        payment after three confirmations.
      </p>
      {!review && (
        <label>
          Maximum wallet fee (zats)
          <input
            inputMode="numeric"
            value={feeCapZat}
            onChange={(e) => setFeeCapZat(e.target.value)}
          />
          <span>
            Set this before review. Check the fee in ZODL before signing. A
            saved refund limit cannot be changed.
          </span>
        </label>
      )}
      <button
        className="secondary"
        disabled={!safe || busy}
        onClick={() => void act("review")}
      >
        Review wallet refund
      </button>
      {review && (
        <>
          <label>
            Refund address
            <textarea readOnly value={review.recipient} />
          </label>
          <p>
            Refund: {zec(review.amountZat)} ZEC. Maximum verified fee:{" "}
            {zec(review.feeCapZat)} ZEC.
          </p>
          <label>
            Exact refund memo
            <textarea readOnly value={review.memo} />
          </label>
          {!review.handoffStarted ? (
            <>
              <label>
                NOSTOS account password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <p>
                Continue once, then review the address, amount and memo in ZODL.
                Use shielded funds. Cancel if the fee exceeds the maximum above.
              </p>
              <button
                className="primary"
                disabled={!safe || busy || !password}
                onClick={() => void act("handoff")}
              >
                Continue to wallet approval
              </button>
            </>
          ) : (
            <>
              {review.uri && (
                <a className="primary" href={review.uri}>
                  Open refund in wallet
                </a>
              )}
              <p>
                Wallet approval was requested. Check wallet history before
                taking any further action. A missing confirmation is not
                permission to resend.
              </p>
            </>
          )}
          {review.handoffStarted && (
            <details>
              <summary>Refund recovery</summary>
              <label>
                Refund transaction ID
                <input
                  value={txid}
                  maxLength={64}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => setTxid(e.target.value)}
                />
              </label>
              <button
                className="secondary"
                disabled={!safe || busy || !/^[a-f0-9]{64}$/.test(txid.trim())}
                onClick={() => void act("candidate")}
              >
                Save transaction reference
              </button>
              <button
                className="secondary"
                disabled={!safe || busy}
                onClick={() => void act("check")}
              >
                Check refund confirmation
              </button>
            </details>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
