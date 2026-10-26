"use client";
import { useEffect, useRef, useState } from "react";
import { requestJson, RequestError } from "./requests.js";
import { refundCheckMessages, type RefundCheckCode } from "./refund-status.js";
import QRCode from "qrcode";
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
  observation,
}: {
  requestId: string;
  safe: boolean;
  onRefresh: () => void;
  observation?: { stage: RefundCheckCode; checkedAt?: string };
}) {
  const [feeCapZat, setFeeCapZat] = useState("10000");
  const [review, setReview] = useState<Review>();
  const [qr, setQr] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
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
    } catch (error) {
      if (action === "handoff")
        setReview(
          (previous) =>
            previous && { ...previous, handoffStarted: true, uri: undefined },
        );
      setMessage(
        action === "handoff"
          ? "Wallet handoff outcome is unknown. Review saved instructions and wallet history. Do not send again."
          : error instanceof RequestError && error.code
            ? refundCheckMessages[error.code]
            : action === "candidate"
              ? "The reference could not be saved. Refresh the refund and check the transaction ID. No send was requested."
              : action === "review"
                ? "The saved refund could not be opened. Refresh its current status before continuing."
                : "The refund check could not finish. Your reservation is preserved. Check the connection and try verification again. Do not send again.",
      );
      if (action === "check") onRefresh();
    } finally {
      setPassword("");
      setBusy(false);
      active.current = false;
    }
  }
  useEffect(() => {
    let current = true;
    setQr("");
    if (review?.handoffStarted && review.uri) {
      void QRCode.toDataURL(review.uri, { width: 320, margin: 4 })
        .then((value) => {
          if (current) setQr(value);
        })
        .catch(() => {
          if (current)
            setCopyStatus("QR unavailable. Use the exact saved details below.");
        });
    }
    return () => {
      current = false;
    };
  }, [review?.handoffStarted, review?.uri]);
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label} copied.`);
    } catch {
      setCopyStatus("Could not copy. Select and copy the saved value shown.");
    }
  }
  // Durable dashboard/receipt polling performs checks even after this panel closes.
  return (
    <div className="refund-review">
      <p>
        Your wallet signs this refund. NOSTOS verifies the exact outgoing
        payment after three confirmations.
      </p>
      {observation && (
        <p role="status">{refundCheckMessages[observation.stage]}</p>
      )}
      <p>
        ZODL may reject requests opened from another app. Save the QR and use
        ZODL's own image scanner. Cake Wallet may omit the memo when opening a
        request. Before confirming, check that the wallet includes the exact
        memo shown here. If it has no transaction memo field, cancel.
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
          <button
            className="secondary"
            type="button"
            onClick={() => void copy(review.memo, "Refund memo")}
          >
            Copy exact refund memo
          </button>
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
                <>
                  <p>
                    ZODL requires its own scanner for external payment requests.
                    Save this QR, then select the image in ZODL's scanner. Check
                    the refund amount and memo before signing once.
                  </p>
                  {qr && (
                    <>
                      <img
                        src={qr}
                        width={320}
                        height={320}
                        style={{ maxWidth: "100%", height: "auto" }}
                        alt="Saved refund request QR including recipient, amount and memo"
                      />
                      <a
                        className="secondary"
                        href={qr}
                        download="nostos-refund-qr.png"
                      >
                        Save refund QR
                      </a>
                    </>
                  )}
                  <a className="secondary" href={review.uri}>
                    Open in a compatible wallet
                  </a>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => void copy(review.uri!, "Refund request")}
                  >
                    Copy complete refund request
                  </button>
                  <p>
                    Cake Wallet may fill the address and amount without the
                    memo. Paste the exact refund memo into its transaction memo
                    field before signing. If no transaction memo field is
                    available, cancel.
                  </p>
                </>
              )}
              <p>
                Wallet approval was requested. Check wallet history before
                taking any further action. A missing confirmation is not
                permission to resend.
              </p>
            </>
          )}
          {(review.handoffStarted ||
            (observation && observation.stage !== "awaiting_wallet")) && (
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
      {!review && observation && observation.stage !== "awaiting_wallet" && (
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
      {copyStatus && <p role="status">{copyStatus}</p>}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
