"use client";

import { useEffect, useRef, useState } from "react";

type Status =
  | "ready"
  | "loading"
  | "confirmed"
  | "broadcast"
  | "broadcast_unknown"
  | "failed";
type Payment = {
  id: string;
  orderReference: string;
  receivedZat: number;
  refundedZat: number;
  availableZat: number;
  destination: string;
  status: string;
  canRefund: boolean;
  refundTxid?: string;
};

function Mark({ loading = false }: { loading?: boolean }) {
  return (
    <svg
      className={loading ? "mark looping" : "mark"}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <g fill="currentColor">
        <path d="M 12.7 33.6 C 16.5 33.3 19.7 34.7 22.6 36.7 L 27.5 40.1 C 29.9 41.8 31.1 44.4 31.1 47.2 L 31.1 80.1 C 31.1 81.4 30.1 82.4 28.8 82.4 L 13.2 82.4 C 10.3 82.4 7.9 80.0 7.9 77.1 L 7.9 38.8 C 7.9 36.0 10.0 33.7 12.7 33.6 Z" />
        <path d="M 12.7 30.0 L 22.8 20.5 C 25.3 18.3 28.7 17.2 31.7 17.7 C 34.7 18.0 37.0 19.0 41.4 21.7 L 87.7 54.2 C 91.1 56.7 92.5 60.9 91.3 64.8 C 90.7 67.0 89.2 69.0 87.2 70.5 C 80.6 75.5 75.5 78.8 71.3 80.6 C 65.8 83.0 60.7 82.7 55.3 80.2 L 36.6 67.4 C 35.8 66.8 35.4 65.9 35.4 64.9 L 35.4 55.1 C 35.4 53.3 37.4 52.2 38.9 53.3 L 63.8 69.4 C 66.4 71.1 69.6 70.5 70.8 68.5 C 72.3 66.2 71.1 63.8 69.4 62.4 L 25.8 33.0 C 21.5 30.2 17.5 29.1 12.7 30.0 Z" />
        <path d="M 74.0 21.5 L 87.0 21.5 C 89.8 21.5 92.1 23.8 92.1 26.6 L 91.8 54.0 L 88.1 50.1 L 72.0 38.5 C 71.5 38.1 71.2 37.6 71.2 36.9 L 71.2 24.4 C 71.2 22.8 72.4 21.5 74.0 21.5 Z" />
      </g>
      <path
        className="return-line"
        d="M0 48 H32 M67 57 H100"
        fill="none"
        stroke="#53E3A6"
        strokeWidth="3"
      />
    </svg>
  );
}

function StateLabel({ state, text }: { state: Status; text: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    if (state !== "loading" && state !== "broadcast") return;
    const timer = setTimeout(() => setVisible(true), 250);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <div role="status" aria-live="polite" className={`state ${state}`}>
      {visible ? <Mark loading /> : <span className="status-dot" />}
      <span>{text}</span>
    </div>
  );
}

const zec = (amount: number) =>
  (amount / 100_000_000).toLocaleString("en", { maximumFractionDigits: 8 });

export default function Home() {
  const [role, setRole] = useState("merchant");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selected, setSelected] = useState<Payment>();
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("Loading payments");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState(false);
  const reviewed = useRef<{ paymentId: string; amountZat: number } | undefined>(
    undefined,
  );
  const [connectionError, setConnectionError] = useState("");
  const [access, setAccess] = useState("");
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);

  async function refresh(quiet = false) {
    if (sending.current && !quiet) return;
    if (!quiet && payments.length === 0) {
      setStatus("loading");
      setMessage("Loading payments");
    }
    try {
      const response = await fetch("/api/payments", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!response.ok)
        throw new Error(
          "Payment service is unavailable. No action was submitted.",
        );
      const data = await response.json();
      const records = data.payments as Payment[];
      setConnectionError("");
      setPayments(records);
      setSelected((current) =>
        current
          ? records.find((record) => record.id === current.id)
          : undefined,
      );
      const unresolved = records.find(
        (record) =>
          record.status === "broadcast_unknown" ||
          record.status === "broadcasting",
      );
      const waiting = records.some((record) => record.status === "broadcast");
      setStatus(
        unresolved ? "broadcast_unknown" : waiting ? "broadcast" : "ready",
      );
      setMessage(
        unresolved
          ? "Reconciliation required before retry"
          : waiting
            ? "Refund sent, waiting for confirmation"
            : "Payment records are up to date",
      );
    } catch {
      if (payments.length === 0 && !sending.current) setStatus("failed");
      setConnectionError(
        "Connection interrupted. Last saved status is shown. Reconnect and refresh before taking action.",
      );
    }
  }
  useEffect(() => {
    if (!access) {
      setStatus("ready");
      setMessage("Enter private demo access to load records");
      return;
    }
    const timer = setInterval(() => {
      if (!sending.current) void refresh(true);
    }, 8000);
    return () => clearInterval(timer);
  }, [access]);

  async function sendRefund() {
    if (
      sending.current ||
      !selected ||
      !valid ||
      connectionError ||
      !reviewed.current ||
      reviewed.current.paymentId !== selected.id
    )
      return;
    const instruction = reviewed.current;
    sending.current = true;
    setBusy(true);
    setStatus("loading");
    setMessage("Preparing shielded refund");
    try {
      const response = await fetch("/api/refunds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access}`,
        },
        body: JSON.stringify({
          paymentTxid: instruction.paymentId,
          amountZat: instruction.amountZat,
        }),
      });
      if (!response.ok)
        throw new Error("Refund requires a status check before retry");
      setReview(false);
      await refresh(true);
    } catch {
      setStatus("broadcast_unknown");
      setMessage("Checking refund state. Do not send again.");
      // Lock this record in the browser even if the subsequent status read fails.
      setSelected((current) =>
        current
          ? { ...current, canRefund: false, status: "broadcast_unknown" }
          : current,
      );
      setReview(false);
      await refresh(true);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function choose(payment: Payment) {
    if (sending.current) return;
    reviewed.current = undefined;
    setSelected(payment);
    setReview(false);
    setAmount(zec(payment.availableZat));
  }
  const validAmount = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(amount);
  const amountZat = validAmount ? Math.round(Number(amount) * 100_000_000) : 0;
  const valid =
    selected?.canRefund &&
    Number.isSafeInteger(amountZat) &&
    amountZat > 0 &&
    amountZat <= selected.availableZat;

  return (
    <main>
      <header>
        <a className="brand" href="/">
          <Mark />
          <span>NOSTOS</span>
        </a>
        <span className="network">Zcash testnet</span>
      </header>
      <section className="intro">
        <p className="eyebrow">A PRIVATE WAY BACK</p>
        <h1>
          The return is
          <br />
          part of the payment.
        </h1>
        <p className="lede">
          Private refunds for shielded ZEC payments.
          <br />
          No address request. No support ticket.
        </p>
      </section>
      <nav aria-label="Demo role" className="roles">
        <button
          aria-pressed={role === "merchant"}
          onClick={() => setRole("merchant")}
        >
          Merchant
        </button>
        <button
          aria-pressed={role === "customer"}
          onClick={() => {
            setRole("customer");
            setReview(false);
          }}
        >
          Customer receipt
        </button>
        <span>Isolated demo wallets</span>
      </nav>
      <StateLabel state={status} text={message} />
      {connectionError && (
        <p role="alert" className="warning">
          {connectionError}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void refresh();
        }}
        className="access"
      >
        <label>
          Private demo access
          <input
            type="password"
            autoComplete="off"
            value={access}
            onChange={(event) => setAccess(event.target.value)}
            placeholder="Access token"
          />
        </label>
        <button className="text-button" type="submit">
          Load records
        </button>
      </form>
      {role === "merchant" ? (
        <section className="workspace">
          <div className="list">
            <div className="section-head">
              <h2>Payments</h2>
              <button
                className="text-button"
                disabled={status === "loading"}
                onClick={() => void refresh()}
              >
                Refresh
              </button>
            </div>
            {payments.length === 0 && status !== "loading" && (
              <p className="empty">
                No payment records available. Nothing is being simulated.
              </p>
            )}
            {payments.map((payment) => (
              <button
                key={payment.id}
                className={`payment-row ${selected?.id === payment.id ? "selected" : ""}`}
                onClick={() => choose(payment)}
              >
                <span>
                  <strong>{payment.orderReference}</strong>
                  <small>{payment.status.replaceAll("_", " ")}</small>
                </span>
                <span className="row-amount">
                  {zec(payment.receivedZat)}
                  <small>ZEC</small>
                </span>
              </button>
            ))}
          </div>
          <article className="detail">
            {selected ? (
              <>
                <p className="eyebrow">
                  {review ? "REVIEW REFUND" : "PAYMENT DETAILS"}
                </p>
                <h2>{selected.orderReference}</h2>
                <div className="amount">
                  {review && reviewed.current
                    ? zec(reviewed.current.amountZat)
                    : zec(selected.receivedZat)}{" "}
                  <span>ZEC</span>
                </div>
                <dl>
                  <div>
                    <dt>Received</dt>
                    <dd>{zec(selected.receivedZat)} ZEC</dd>
                  </div>
                  <div>
                    <dt>Refunded</dt>
                    <dd>{zec(selected.refundedZat)} ZEC</dd>
                  </div>
                  <div>
                    <dt>Remaining value</dt>
                    <dd>{zec(selected.availableZat)} ZEC</dd>
                  </div>
                  <div>
                    <dt>Private return route</dt>
                    <dd className="mono">{selected.destination}</dd>
                  </div>
                </dl>
                <StateLabel
                  state={
                    busy
                      ? "loading"
                      : selected.status === "broadcast"
                        ? "broadcast"
                        : selected.refundedZat > 0
                          ? "confirmed"
                          : selected.status === "broadcast_unknown" ||
                              selected.status === "broadcasting"
                            ? "broadcast_unknown"
                            : "ready"
                  }
                  text={
                    busy
                      ? "Preparing shielded refund. Do not send again."
                      : selected.refundedZat > 0
                        ? `Refund confirmed: ${zec(selected.refundedZat)} ZEC`
                        : selected.status === "broadcast"
                          ? "Refund sent, waiting for confirmation"
                          : selected.status === "broadcast_unknown" ||
                              selected.status === "broadcasting"
                            ? "Checking refund state. Sending is blocked."
                            : "No refund sent for this payment"
                  }
                />
                {connectionError && (
                  <p className="warning">{connectionError}</p>
                )}
                {selected.canRefund ? (
                  <>
                    {!review && (
                      <label>
                        Refund amount in ZEC
                        <input
                          inputMode="decimal"
                          value={amount}
                          onChange={(event) => setAmount(event.target.value)}
                        />
                      </label>
                    )}
                    <p className="privacy">
                      The destination stays inside the trusted service. The
                      browser receives only this masked reference.
                    </p>
                    {review ? (
                      <>
                        <p className="warning">
                          This sends a real testnet refund. Review the amount
                          and masked destination before continuing.
                        </p>
                        <button
                          className="primary"
                          disabled={busy || !valid || !!connectionError}
                          onClick={() => void sendRefund()}
                        >
                          {busy ? "Preparing refund" : "Send private refund"}
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => setReview(false)}
                        >
                          Go back
                        </button>
                      </>
                    ) : (
                      <button
                        className="primary"
                        disabled={!valid || busy || !!connectionError}
                        onClick={() => {
                          reviewed.current = {
                            paymentId: selected.id,
                            amountZat,
                          };
                          setReview(true);
                        }}
                      >
                        Review refund
                      </button>
                    )}
                  </>
                ) : (
                  <p className="privacy">
                    {selected.status === "broadcast_unknown" ||
                    selected.status === "broadcasting"
                      ? "Reconciliation required before retry. Sending is blocked."
                      : "Refunding is unavailable for this record. Existing refunds and historical demo payments cannot be sent again."}
                  </p>
                )}
              </>
            ) : (
              <div className="empty-detail">
                <Mark />
                <h2>Choose a payment</h2>
                <p>Review its private return route and refund status.</p>
              </div>
            )}
          </article>
        </section>
      ) : (
        <section className="receipts">
          <h2>Your refund receipts</h2>
          {payments
            .filter((payment) => payment.refundedZat > 0)
            .map((payment) => (
              <article className="receipt" key={payment.id}>
                <StateLabel
                  state="confirmed"
                  text="Refund received privately"
                />
                <div className="amount">
                  {zec(payment.refundedZat)} <span>ZEC</span>
                </div>
                <p>{payment.orderReference}</p>
                <p className="mono">
                  {payment.refundTxid?.slice(0, 12)}...
                  {payment.refundTxid?.slice(-8)}
                </p>
              </article>
            ))}
          <p className="privacy">
            This demo role switch shows the isolated test wallets. It is not a
            public customer receipt link.
          </p>
        </section>
      )}
      <footer>
        <span>Testnet only. No real funds.</span>
        <p>
          Shielded transactions protect on-chain details. NOSTOS does not hide
          information from the merchant or the server operator.
        </p>
      </footer>
    </main>
  );
}
