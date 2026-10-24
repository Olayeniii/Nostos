"use client";
import { useNetwork } from "../../../src/network-context.js";
import { OverviewIcon } from "../../../src/overview-icon.js";
import { useRef, useState } from "react";
import { AppFooter } from "../../../src/shell.js";
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
import { MerchantWorkspace } from "../../../src/merchant-workspace.js";
export default function FundsPage() {
  const network = useNetwork();
  const { data, warning, loading, refresh } = useRecord<Funds>(
    "/api/product/funds",
    "",
    network === "testnet",
  );
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
  if (network === "mainnet")
    return (
      <MerchantWorkspace>
        <section className="panel">
          <p className="eyebrow">YOUR BUSINESS WALLET</p>
          <h1>Your funds stay in your wallet</h1>
          <p>
            Payments go directly to the business account connected in Settings.
            Check your balance and make transfers in ZODL.
          </p>
          <p>
            NOSTOS has view access only. Review customer refund requests in
            Payments, then approve and sign each refund in your wallet.
          </p>
          <a className="primary" href="/merchant">
            Review payments
          </a>
        </section>
      </MerchantWorkspace>
    );
  return (
    <MerchantWorkspace>
      <div className="studio-funds">
        <p className="eyebrow">MERCHANT WORKSPACE / FUNDS</p>
        <h1>Your funds</h1>
        <p>
          Withdraw released earnings to your shielded wallet. Hosted merchant
          Zallet holds spending authority.
        </p>
        {(warning || error) && (
          <p role="alert" className="warning">
            {error ||
              "Funds are unavailable. Chain verification or wallet sync may need operator attention. Saved payment records remain available."}
          </p>
        )}
        {loading && <p role="status">Checking shielded funds...</p>}
        {data && (
          <>
            <section
              className="workspace-available panel"
              aria-label="Available withdrawal balance"
            >
              <span className="workspace-summary-icon">
                <OverviewIcon kind="bag" />
              </span>
              <div>
                <h2>Available before withdrawal fee</h2>
                <strong>
                  {zec(data.withdrawableBeforeFeeZat)} <small>ZEC</small>
                </strong>
                <p>
                  Refund reserves and their fee allowance are already set aside.
                </p>
              </div>
            </section>
            <dl className="payment-summary">
              <dt>Confirmed shielded funds</dt>
              <dd>{zec(data.spendableZat)} ZEC</dd>
              <dt>Reserved for refunds</dt>
              <dd>{zec(data.reservedForRefundsZat)} ZEC</dd>
              <dt>Refund fee allowance</dt>
              <dd>{zec(data.refundFeeAllowanceZat)} ZEC</dd>
            </dl>
            <p className="funds-explainer">
              The available amount is before the withdrawal fee. Review provides
              the exact fee and total debit before you authorize a send. Refund
              value stays reserved until its window closes and open requests are
              resolved. Older payments without a deadline keep their original
              terms. The fee allowance is a buffer, not a guarantee of future
              refund fees.
            </p>
            {data.fundingShortfallZat > 0 && (
              <p role="alert" className="warning">
                Add at least {zec(data.fundingShortfallZat)} ZEC to cover
                current refund reserves and the fee allowance. A refund still
                needs enough funds for its actual transaction fee.
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
              <h2>Withdraw released earnings</h2>
              <ol
                className="workspace-withdraw-steps"
                aria-label="Withdrawal steps"
              >
                <li>1. Enter details</li>
                <li>2. Review fee</li>
                <li>3. Confirm send</li>
              </ol>
              <label>
                Shielded destination
                <input
                  required
                  name="shielded-destination"
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
                  name="withdrawal-amount"
                  autoComplete="off"
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
                  Review expires in two minutes. Check the destination
                  carefully.
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
      </div>
      <AppFooter />
    </MerchantWorkspace>
  );
}
