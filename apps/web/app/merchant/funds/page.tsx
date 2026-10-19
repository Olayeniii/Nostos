"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { AppHeader, AppFooter } from "../../../src/shell.js";
import { useRecord } from "../../../src/use-record.js";
import { parseZec, requestJson } from "../../../src/requests.js";
import { zec } from "../../../src/receipt-card.js";
type Withdrawal = {
  id: string;
  destination: string;
  amountZat: number;
  feeZat: number;
  network: string;
  expiresAt: number;
  status: string;
  txid: string | null;
};
type Funds = {
  network: string;
  spendableZat: number;
  reservedForRefundsZat: number;
  refundFeeAllowanceZat: number;
  fundingShortfallZat: number;
  withdrawableBeforeFeeZat: number;
  spendingBlocked: boolean;
  history: Withdrawal[];
};
export default function FundsPage() {
  const { data, warning, loading, refresh } =
    useRecord<Funds>("/api/product/funds");
  const [destination, setDestination] = useState(""),
    [amount, setAmount] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const [review, setReview] = useState<Withdrawal>();
  const sending = useRef(false);
  const ready =
    !!data &&
    !warning &&
    !loading &&
    !busy &&
    !uncertain &&
    !data.spendingBlocked;
  async function post(action: string, body: unknown) {
    return requestJson<Withdrawal>(
      `/api/product/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      180000,
    );
  }
  return (
    <main className="product-app dashboard-app funds-app">
      <AppHeader role="Merchant" />
      <nav className="workspace-nav">
        <Link href="/merchant">Payments</Link>
        <Link aria-current="page" href="/merchant/funds">
          Funds
        </Link>
        <Link href="/merchant/settings">Store settings</Link>
      </nav>
      <h1>Your funds</h1>
      <p>
        Withdraw released earnings to your shielded wallet. Hosted merchant
        Zallet holds spending authority.
      </p>
      {(warning || error) && (
        <p role="alert">
          {error ||
            "Funds are unavailable. Chain verification or wallet sync may need operator attention. Saved payment records remain available."}
        </p>
      )}
      {data && (
        <>
          <dl className="payment-summary">
            <dt>Confirmed shielded funds</dt>
            <dd>{zec(data.spendableZat)} ZEC</dd>
            <dt>Reserved for refunds</dt>
            <dd>{zec(data.reservedForRefundsZat)} ZEC</dd>
            <dt>Refund fee allowance</dt>
            <dd>{zec(data.refundFeeAllowanceZat)} ZEC</dd>
            <dt>Available before withdrawal fee</dt>
            <dd>{zec(data.withdrawableBeforeFeeZat)} ZEC</dd>
          </dl>
          <p>
            Refund value stays reserved until its window closes and open
            requests are resolved. Older payments without a deadline keep their
            original terms. The fee allowance is a buffer, not a guarantee of
            future refund fees.
          </p>
          {data.fundingShortfallZat > 0 && (
            <p role="alert">
              Add at least {zec(data.fundingShortfallZat)} ZEC to cover current
              refund reserves and the fee allowance. A refund still needs enough
              funds for its actual transaction fee.
            </p>
          )}
          {data.spendingBlocked && (
            <p role="status">
              A recorded refund or withdrawal needs confirmation or
              reconciliation before another withdrawal.
            </p>
          )}
          <form
            className="funds-withdrawal panel"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!ready || sending.current) return;
              sending.current = true;
              setBusy(true);
              setError("");
              try {
                setReview(
                  await post("withdrawal-quote", {
                    destination,
                    amountZat: parseZec(amount),
                    password,
                  }),
                );
              } catch {
                setReview(undefined);
                setError(
                  "Could not prepare withdrawal. Check the amount, shielded address, password and available funds.",
                );
              } finally {
                setBusy(false);
                sending.current = false;
              }
            }}
          >
            <label>
              Shielded destination
              <input
                required
                autoComplete="off"
                value={destination}
                onChange={(e) => {
                  setDestination(e.target.value);
                  setReview(undefined);
                }}
                disabled={busy || uncertain}
              />
            </label>
            <label>
              Amount in ZEC
              <input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setReview(undefined);
                }}
                disabled={busy || uncertain}
              />
            </label>
            <label>
              Current password
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy || uncertain}
              />
            </label>
            <button className="primary" disabled={!ready || !!review}>
              Review withdrawal
            </button>
          </form>
          {review && (
            <section
              className="funds-review panel"
              aria-label="Withdrawal review"
            >
              <h2>Confirm withdrawal</h2>
              <p>
                {zec(review.amountZat)} ZEC on {review.network}
              </p>
              <code className="break-reference">{review.destination}</code>
              <p>
                Transaction fee: {zec(review.feeZat)} ZEC. Total debit:{" "}
                {zec(review.amountZat + review.feeZat)} ZEC.
              </p>
              <p>
                Review expires in two minutes. Check the destination carefully.
              </p>
              <button
                className="primary"
                disabled={!ready || review.expiresAt <= Date.now()}
                onClick={async () => {
                  if (!ready || sending.current) return;
                  sending.current = true;
                  setBusy(true);
                  setError("");
                  try {
                    const result = await post("withdrawal-confirm", {
                      id: review.id,
                      password,
                    });
                    setReview(undefined);
                    setPassword("");
                    setUncertain(
                      !["broadcast", "confirmed"].includes(result.status),
                    );
                    await refresh();
                  } catch {
                    setUncertain(true);
                    setPassword("");
                    setError(
                      "The send outcome is not confirmed. Refresh history and do not submit another withdrawal or refund.",
                    );
                  } finally {
                    setBusy(false);
                    sending.current = false;
                  }
                }}
              >
                Confirm and send
              </button>
              <button
                className="secondary"
                disabled={busy || uncertain}
                onClick={() => setReview(undefined)}
              >
                Cancel review
              </button>
            </section>
          )}
          <h2>Withdrawal history</h2>
          {data.history.length === 0 ? (
            <p>No withdrawals recorded.</p>
          ) : (
            data.history.map((w) => (
              <article className="withdrawal-record panel" key={w.id}>
                <strong>{zec(w.amountZat)} ZEC</strong>
                <p>
                  {w.status === "review" && w.expiresAt <= Date.now()
                    ? "Review expired, no send authorized"
                    : w.status}
                </p>
                <p>Fee: {zec(w.feeZat)} ZEC</p>
                {w.txid && <code className="break-reference">{w.txid}</code>}
              </article>
            ))
          )}
        </>
      )}
      <button
        className="secondary"
        disabled={busy || loading}
        onClick={() => void refresh()}
      >
        Refresh funds and history
      </button>
      <AppFooter />
    </main>
  );
}
