"use client";

import { Mark } from "../../src/mark.js";
import { StateLabel, type Status } from "../../src/status-label.js";
import { AppHeader, AppFooter } from "../../src/shell.js";

import { useEffect, useRef, useState } from "react";
import {
  requestJson,
  RequestError,
  parseZec,
  matchesReview,
  hasRecordedRefund,
} from "../../src/requests.js";

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

const zec = (amount: number) =>
  (amount / 100_000_000).toLocaleString("en", { maximumFractionDigits: 8 });

export default function Merchant() {
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
  const [access, setAccess] = useState(false);
  const detailRef = useRef<HTMLElement | null>(null);
  const [receiptMessage, setReceiptMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const refreshRequest = useRef<AbortController | undefined>(undefined);
  const refreshVersion = useRef(0);
  const recordsPresent = useRef(false);
  const uncertainPayments = useRef(new Set<string>());
  const [refreshing, setRefreshing] = useState(false);

  function cancelRefresh() {
    refreshVersion.current += 1;
    refreshRequest.current?.abort();
    refreshRequest.current = undefined;
    setRefreshing(false);
  }

  async function refresh(quiet = false) {
    if (!access || (sending.current && !quiet) || refreshRequest.current)
      return;
    const controller = new AbortController();
    refreshRequest.current = controller;
    const version = ++refreshVersion.current;
    setRefreshing(true);
    if (!quiet && payments.length === 0) {
      setStatus("loading");
      setMessage("Loading payments");
    }
    try {
      const data = await requestJson<{ payments: Payment[] }>(
        "/api/payments",
        {
          cache: "no-store",
        },
        12_000,
        controller.signal,
      );
      if (version !== refreshVersion.current) return;
      const records = data.payments.map((record) => {
        if (!uncertainPayments.current.has(record.id)) return record;
        if (hasRecordedRefund(record)) {
          uncertainPayments.current.delete(record.id);
          return record;
        }
        return { ...record, canRefund: false, status: "broadcast_unknown" };
      });
      setConnectionError("");
      recordsPresent.current = records.length > 0;
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
    } catch (error) {
      if (version !== refreshVersion.current) return;
      if (error instanceof RequestError && error.status === 401) {
        window.location.replace("/sign-in");
        return;
      }
      if (!recordsPresent.current && !sending.current) setStatus("failed");
      setConnectionError(
        "Connection interrupted. Last saved status is shown. Reconnect and refresh before taking action.",
      );
    } finally {
      if (version === refreshVersion.current) {
        refreshRequest.current = undefined;
        setRefreshing(false);
      }
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void requestJson<{ authenticated: boolean }>(
      "/api/session",
      { cache: "no-store" },
      12000,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          if (data.authenticated) setAccess(true);
          else window.location.replace("/sign-in");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setConnectionError(
            "Could not check your session. Refresh when your connection returns.",
          );
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    cancelRefresh();
    recordsPresent.current = false;
    setPayments([]);
    setSelected(undefined);
    reviewed.current = undefined;
    setReview(false);
    setConnectionError("");
    if (!access) {
      setStatus("ready");
      setStatus("loading");
      setMessage("Opening merchant workspace");
      return;
    }
    void refresh();
    const timer = setInterval(() => {
      if (!sending.current) void refresh(true);
    }, 8000);
    return () => {
      clearInterval(timer);
      cancelRefresh();
    };
  }, [access]);

  async function sendRefund() {
    if (
      sending.current ||
      !selected ||
      !valid ||
      connectionError ||
      !reviewed.current ||
      !matchesReview(reviewed.current, selected.id, amountZat) ||
      uncertainPayments.current.has(selected.id)
    )
      return;
    const instruction = reviewed.current;
    cancelRefresh();
    uncertainPayments.current.add(instruction.paymentId);
    sending.current = true;
    setBusy(true);
    setStatus("loading");
    setMessage("Preparing shielded refund");
    try {
      await requestJson(
        "/api/refunds",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            paymentTxid: instruction.paymentId,
            amountZat: instruction.amountZat,
          }),
        },
        130_000,
      );
      setStatus("broadcast");
      setMessage("Refund sent, waiting for confirmation");
      setSelected((current) =>
        current
          ? { ...current, canRefund: false, status: "broadcast" }
          : current,
      );
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

  async function shareReceipt() {
    if (!selected || !access || sharing || busy || connectionError) return;
    setSharing(true);
    setReceiptMessage("");
    try {
      const result = await requestJson<{ receiptPath: string }>(
        "/api/receipts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ paymentTxid: selected.id }),
        },
        12000,
      );
      await navigator.clipboard.writeText(
        new URL(result.receiptPath, window.location.origin).href,
      );
      setReceiptMessage("Customer receipt link copied.");
    } catch {
      setReceiptMessage(
        "Could not copy the receipt link. Check the connection and receipt access configuration.",
      );
    } finally {
      setSharing(false);
    }
  }

  useEffect(() => {
    if (!selected || !window.matchMedia("(max-width: 700px)").matches) return;
    detailRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    detailRef.current?.focus({ preventScroll: true });
  }, [selected?.id]);

  function choose(payment: Payment) {
    if (sending.current || sharing) return;
    reviewed.current = undefined;
    setReceiptMessage("");
    setSelected(payment);
    setReview(false);
    setAmount(
      (payment.availableZat / 100000000).toLocaleString("en", {
        maximumFractionDigits: 8,
        useGrouping: false,
      }),
    );
  }
  const amountZat = parseZec(amount);
  const valid =
    selected?.canRefund &&
    !uncertainPayments.current.has(selected.id) &&
    Number.isSafeInteger(amountZat) &&
    amountZat > 0 &&
    amountZat <= selected.availableZat;

  return (
    <main>
      <AppHeader role="Merchant" />
      <nav className="workspace-nav" aria-label="Merchant pages">
        <a href="/merchant" aria-current="page">
          Payments
        </a>
        <a href="/merchant/settings">Settings</a>
        <button
          className="text-button"
          disabled={busy || sharing}
          onClick={async () => {
            if (sending.current) return;
            try {
              await requestJson("/api/session", { method: "DELETE" }, 12000);
              window.location.replace("/sign-in");
            } catch {
              setConnectionError(
                "Could not sign out. Check your connection and try again.",
              );
            }
          }}
        >
          Sign out
        </button>
      </nav>
      <section className="workspace-intro">
        <h1>Payments</h1>
        <p className="lede">
          Review a payment and return funds through its private refund route.
        </p>
      </section>
      {status !== "ready" && <StateLabel state={status} text={message} />}
      {access && payments.length > 0 && (
        <div className="payment-summary" aria-label="Payment summary">
          <span>
            <strong>
              {payments.filter((payment) => payment.canRefund).length}
            </strong>{" "}
            refundable
          </span>
          <span>
            <strong>
              {
                payments.filter((payment) => payment.status === "broadcast")
                  .length
              }
            </strong>{" "}
            awaiting confirmation
          </span>
          <span>
            <strong>
              {payments.filter((payment) => payment.refundedZat > 0).length}
            </strong>{" "}
            refunded
          </span>
        </div>
      )}
      {connectionError && (
        <p role="alert" className="warning">
          {connectionError}
        </p>
      )}
      {access && (
        <section className="workspace">
          <div className="list">
            <div className="section-head">
              <h2>Payments</h2>
              <button
                className="text-button"
                disabled={refreshing || busy || !access}
                onClick={() => void refresh()}
              >
                Refresh
              </button>
            </div>
            {payments.length === 0 && status !== "loading" && (
              <p className="empty">No NOSTOS payments yet.</p>
            )}
            {payments.map((payment) => (
              <button
                key={payment.id}
                aria-pressed={selected?.id === payment.id}
                disabled={busy || sharing}
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
          <article
            className="detail"
            ref={detailRef}
            tabIndex={-1}
            aria-label="Selected payment"
          >
            {selected ? (
              <>
                <p className="eyebrow">
                  {review ? "Review refund" : "Payment details"}
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
                    <dt>
                      {review ? "Remaining after refund" : "Remaining value"}
                    </dt>
                    <dd>
                      {zec(
                        review && reviewed.current
                          ? selected.availableZat - reviewed.current.amountZat
                          : selected.availableZat,
                      )}{" "}
                      ZEC
                    </dd>
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
                <div className="receipt-access">
                  <button
                    className="text-button"
                    disabled={
                      busy || sharing || refreshing || !!connectionError
                    }
                    onClick={() => void shareReceipt()}
                  >
                    {sharing
                      ? "Preparing receipt link"
                      : "Copy customer receipt link"}
                  </button>
                  <p className="privacy">
                    Anyone with this link can view this payment's receipt. Share
                    it privately with the customer.
                  </p>
                  {sharing && (
                    <StateLabel
                      state="loading"
                      text="Preparing private receipt access"
                    />
                  )}
                  {receiptMessage && (
                    <p role="status" className="privacy">
                      {receiptMessage}
                    </p>
                  )}
                </div>
                {connectionError && (
                  <p className="warning">{connectionError}</p>
                )}
                {selected.canRefund ? (
                  <>
                    {!review && (
                      <label>
                        Refund amount in ZEC
                        <input
                          name="refundAmount"
                          autoComplete="off"
                          inputMode="decimal"
                          value={amount}
                          onChange={(event) => {
                            reviewed.current = undefined;
                            setAmount(event.target.value);
                          }}
                        />
                      </label>
                    )}
                    {!review && (
                      <>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            reviewed.current = undefined;
                            setAmount(
                              (
                                selected.availableZat / 100000000
                              ).toLocaleString("en", {
                                maximumFractionDigits: 8,
                                useGrouping: false,
                              }),
                            );
                          }}
                        >
                          Use full remaining amount
                        </button>
                        {!valid && (
                          <p role="alert" className="warning">
                            {amountZat > selected.availableZat
                              ? "Refund cannot exceed the remaining amount."
                              : "Enter a valid amount greater than zero, with at most eight decimal places."}
                          </p>
                        )}
                      </>
                    )}
                    <p className="privacy">
                      The refund returns to the shielded destination included
                      with this payment.
                    </p>
                    {review ? (
                      <>
                        <p className="warning">
                          Review the amount and private return route. Sending a
                          refund cannot be undone.
                        </p>
                        <button
                          className="primary"
                          disabled={
                            busy || !valid || refreshing || !!connectionError
                          }
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
                        disabled={
                          !valid || busy || refreshing || !!connectionError
                        }
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
                      : "This payment cannot be refunded through NOSTOS."}
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
      )}
      <AppFooter />
    </main>
  );
}
