"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { AppFooter } from "../../src/shell.js";
import { OverviewIcon } from "../../src/overview-icon.js";
import { MerchantWorkspace } from "../../src/merchant-workspace.js";
import { StateLabel } from "../../src/status-label.js";
import { useRecord } from "../../src/use-record.js";
import { requestJson, parseZec } from "../../src/requests.js";
import { zec, date } from "../../src/receipt-card.js";
import { paymentSummary } from "../../src/payment-summary.js";
import { MerchantRefundRequest } from "../../src/merchant-refund-request.js";
import {
  type Dashboard,
  paymentRecordStatus as status,
} from "../../src/merchant-records.js";
export default function Merchant() {
  const { data, loading, warning, refresh } = useRecord<Dashboard>(
    "/api/product/dashboard",
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const shareRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const selectedRow = useRef<HTMLButtonElement | null>(null);
  const [share, setShare] = useState("");
  const [qr, setQr] = useState("");
  const [draft, setDraft] = useState("");
  const [review, setReview] = useState<{
    id: string;
    amountZat: number;
    instructionId: string;
  }>();
  const [uncertain, setUncertain] = useState(false);
  const submitting = useRef(false);
  const records = data?.records ?? [];
  const filteredRecords = records.filter((record) => {
    const match = `${record.description ?? ""} ${record.orderReference}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
    return (
      match &&
      (filter === "all" ||
        (filter === "confirmed"
          ? record.paymentStatus === "confirmed"
          : record.paymentStatus !== "confirmed" &&
            record.paymentStatus !== "expired"))
    );
  });
  const current = records.find((r) => r.id === selected);
  const summary = paymentSummary(records);
  const entryHandled = useRef(false);
  useEffect(() => {
    if (!data || entryHandled.current) return;
    entryHandled.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const paymentId = params.get("payment");
    if (paymentId && data.records.some((record) => record.id === paymentId))
      setSelected(paymentId);
    if (params.has("new") && data.merchant.ready) setCreating(true);
  }, [data]);

  useEffect(() => {
    if (!selected) {
      selectedRow.current?.focus();
      return;
    }
    detailRef.current?.focus();
    if (window.matchMedia("(max-width: 900px)").matches)
      detailRef.current?.scrollIntoView({ block: "start" });
  }, [selected]);
  function clearPaymentHash() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (params.has("payment") || params.has("new"))
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
  }
  function closeDetail() {
    setSelected("");
    clearPaymentHash();
  }
  const safe =
    !warning && !data?.syncWarning && !loading && !busy && !uncertain;
  async function post<T>(action: string, body: unknown) {
    return requestJson<T>(
      `/api/product/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      30000,
    );
  }
  useEffect(() => {
    if (share) {
      shareRef.current?.focus();
      shareRef.current?.scrollIntoView({ block: "start" });
    }
  }, [share]);
  async function showLink(token: string) {
    clearPaymentHash();
    setSelected("");
    setCopyNotice("");
    const link = `${window.location.origin}/checkout#${token}`;
    setShare(link);
    setQr(
      await QRCode.toDataURL(link, {
        width: 220,
        margin: 2,
        color: { dark: "#0b1514", light: "#f3efe6" },
      }),
    );
  }
  return (
    <MerchantWorkspace
      name={data?.merchant.name || "Merchant workspace"}
      detailOpen={!!current}
      onPaymentsHome={() => {
        if (busy) return;
        closeDetail();
        setCreating(false);
        setShare("");
      }}
      onSignOut={async () => {
        try {
          await post("logout", {});
          window.location.assign("/sign-in");
        } catch {
          setError("Could not sign out. Try again.");
        }
      }}
    >
      <div className="dashboard-title">
        <div>
          <p className="eyebrow">WORKSPACE / PAYMENTS</p>
          <h1>Payments</h1>
          <p>Private in. A way back.</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setCreating(true);
            setShare("");
            setError("");
          }}
          disabled={!data?.merchant.ready}
        >
          New payment +
        </button>
      </div>
      {data && !data.merchant.ready && (
        <aside className="info-panel">
          Finish setting up your store before accepting payments.{" "}
          <Link href="/setup">Set up store</Link>
        </aside>
      )}
      <section className="summary-grid" aria-label="Payment totals">
        <article>
          <span>Total received</span>
          <i className="workspace-metric-icon">
            <OverviewIcon kind="receipt" />
          </i>
          <strong>
            {data ? zec(summary.receivedZat) : "..."} <small>ZEC</small>
          </strong>
          <p>
            {data
              ? `${summary.confirmedPayments} confirmed payments`
              : "Waiting for payment records"}
          </p>
        </article>
        <article>
          <span>Available to refund</span>
          <i className="workspace-metric-icon">
            <OverviewIcon kind="return" />
          </i>
          <strong>
            {data ? zec(summary.availableZat) : "..."} <small>ZEC</small>
          </strong>
          <p>Payment value, subject to wallet funding</p>
        </article>
        <article>
          <span>Refunded</span>
          <i className="workspace-metric-icon">
            <OverviewIcon kind="check" />
          </i>
          <strong>
            {data ? zec(summary.refundedZat) : "..."} <small>ZEC</small>
          </strong>
          <p>
            {data
              ? `${summary.confirmedRefunds} confirmed refunds`
              : "Waiting for refund records"}
          </p>
        </article>
      </section>
      {(warning || data?.syncWarning) && (
        <p role="alert" className="warning">
          {warning ||
            "Wallet sync is unavailable. Saved records are shown. Refresh before refunding."}
        </p>
      )}
      {error && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
      {creating && (
        <section className="new-payment panel">
          <div className="section-head">
            <h2>Create payment request</h2>
            <button
              className="text-button"
              onClick={() => {
                setCreating(false);
                clearPaymentHash();
              }}
              disabled={busy}
            >
              Close
            </button>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const form = new FormData(e.currentTarget);
              const amountZat = parseZec(String(form.get("amount")));
              if (!amountZat || amountZat > 1e8) {
                setError("Enter an amount from 0.00000001 to 1 ZEC.");
                return;
              }
              setBusy(true);
              setError("");
              try {
                const result = await post<{ id: string; token: string }>(
                  "requests",
                  { description: form.get("description"), amountZat },
                );
                await showLink(result.token);
                setCreating(false);
                setSelected("");
                void refresh();
              } catch {
                setError(
                  "Could not confirm creation. Check the payment list before creating another request.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label>
                What is this payment for?
                <input
                  name="description"
                  placeholder="Order, item, or service"
                  minLength={2}
                  maxLength={160}
                  required
                  disabled={busy}
                />
              </label>
              <label>
                Amount in ZEC
                <input
                  name="amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.01"
                  required
                  disabled={busy}
                />
              </label>
            </div>
            <button className="primary" disabled={busy}>
              Create payment link
            </button>
            {busy && (
              <StateLabel state="loading" text="Creating payment request" />
            )}
          </form>
        </section>
      )}
      {share && (
        <section
          className="share-panel panel"
          aria-label="Private payment link"
          ref={shareRef}
          tabIndex={-1}
        >
          <div>
            <h2>Payment link ready</h2>
            <p>
              Send this private link to your customer. It opens the amount,
              payment instructions, and their receipt.
            </p>
            <input aria-label="Private payment link" readOnly value={share} />
            <button
              className="primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(share);
                  setCopyNotice("Payment link copied.");
                } catch {
                  setCopyNotice("Select and copy the link above.");
                }
              }}
            >
              Copy payment link
            </button>
            <p role="status" className="copy-notice">
              {copyNotice}
            </p>
            <a
              className="text-button"
              href={share}
              target="_blank"
              rel="noreferrer"
            >
              Open checkout
            </a>
          </div>
          {qr && (
            <img
              width={220}
              height={220}
              src={qr}
              alt="QR code for this private payment link"
            />
          )}
        </section>
      )}
      <div className={`ledger-layout ${current ? "has-selection" : ""}`}>
        <section className="ledger panel">
          <div className="section-head">
            <div>
              <h2 className="studio-list-heading">Payment ledger</h2>
              <p>
                {data
                  ? `${filteredRecords.length} of ${records.length} payment requests`
                  : "Waiting for records"}
              </p>
            </div>
            <button
              className="text-button"
              disabled={loading}
              onClick={() => void refresh()}
            >
              Refresh
            </button>
          </div>
          <div className="studio-tools">
            <div className="studio-tabs" aria-label="Filter payments">
              {[
                ["all", "All"],
                ["awaiting", "Awaiting"],
                ["confirmed", "Confirmed"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="studio-search">
              <span className="sr-only">Find a payment</span>
              <input
                type="search"
                placeholder="Find a payment"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          {loading && <StateLabel state="loading" text="Checking payments" />}
          <div className="ledger-columns" aria-hidden="true">
            <span>Order</span>
            <span>Amount</span>
            <span>Payment</span>
            <span>Fulfillment</span>
            <span>Refund</span>
            <span>Date</span>
          </div>
          {records.length === 0 && !loading && !!data ? (
            <div className="empty-state">
              <h3>Your first payment starts here.</h3>
              <p>
                Create a payment request and share the link with your customer.
                Confirmed payments appear here automatically.
              </p>
              <button
                className="secondary"
                onClick={() => setCreating(true)}
                disabled={!data?.merchant.ready}
              >
                Create payment
              </button>
            </div>
          ) : (
            filteredRecords.map((r) => (
              <button
                key={r.id}
                className={`ledger-row ${selected === r.id ? "selected" : ""}`}
                aria-pressed={selected === r.id}
                onClick={(event) => {
                  selectedRow.current = event.currentTarget;
                  setSelected(r.id);
                  setReview(undefined);
                  setDraft("");
                  setError("");
                  setUncertain(false);
                }}
              >
                <span className="ledger-order">
                  <strong>{r.description || r.orderReference}</strong>
                  <small>
                    {r.orderReference.length > 22
                      ? `${r.orderReference.slice(0, 18)}...`
                      : r.orderReference}
                  </small>
                </span>
                <span className="ledger-amount">
                  {zec(r.paymentAmountZat)} <small>ZEC</small>
                </span>
                <span
                  className={`status-chip payment-state ${r.paymentStatus}`}
                >
                  {r.paymentStatus.replaceAll("_", " ")}
                </span>
                <span
                  className={`status-chip fulfillment-state ${r.fulfillment ?? "pending"}`}
                >
                  <span className="mobile-label">Fulfillment</span>
                  {r.fulfillment ?? "pending"}
                </span>
                <span className={`status-chip refund-state ${r.status}`}>
                  <span className="mobile-label">Refund</span>
                  {r.refundAmountZat > 0 ? status(r) : "No refund"}
                </span>
                <span className="ledger-date">{date(r.createdAt)}</span>
              </button>
            ))
          )}
          {data && records.length > 0 && filteredRecords.length === 0 && (
            <div className="empty-state">
              <h3>No matching payments</h3>
              <p>Try another order name, reference, or payment filter.</p>
              <button
                className="secondary"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </section>
        {current && (
          <aside
            className="payment-detail panel"
            ref={detailRef}
            tabIndex={-1}
            aria-label="Payment details"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) closeDetail();
            }}
          >
            <div className="section-head">
              <p className="eyebrow">PAYMENT DETAILS</p>
              <button
                className="text-button"
                onClick={closeDetail}
                disabled={busy}
              >
                Back to payments
              </button>
            </div>
            <button
              className="text-button"
              disabled={loading}
              onClick={() => void refresh()}
            >
              Refresh payment
            </button>
            {loading && <StateLabel state="loading" text="Checking payment" />}
            <h2>{current.description}</h2>
            <div className="detail-amount">
              {zec(current.paymentAmountZat)} <span>ZEC</span>
            </div>
            <span
              className={`status-chip ${current.status === "failed" || current.refundAmountZat > 0 ? current.status : current.paymentStatus}`}
            >
              {status(current)}
            </span>
            <ol className="payment-lifecycle" aria-label="Payment lifecycle">
              <li
                data-state={
                  current.paymentStatus === "confirmed" ? "complete" : "waiting"
                }
              >
                <span>01</span>
                <strong>Pay</strong>
                <small>
                  {current.paymentStatus === "confirmed"
                    ? "Confirmed"
                    : current.paymentStatus === "expired"
                      ? "Expired"
                      : "Awaiting confirmation"}
                </small>
              </li>
              <li
                data-state={
                  current.fulfillment === "fulfilled" ? "complete" : "waiting"
                }
              >
                <span>02</span>
                <strong>Fulfill</strong>
                <small>{current.fulfillment ?? "pending"}</small>
              </li>
              <li
                data-state={
                  (current.confirmedRefundAmountZat ?? 0) > 0
                    ? "complete"
                    : "waiting"
                }
              >
                <span>03</span>
                <strong>Refund</strong>
                <small>
                  {current.refundAmountZat > 0 || current.status === "failed"
                    ? status(current)
                    : current.payment?.canRefund
                      ? "Available if needed"
                      : "Not currently available"}
                </small>
              </li>
            </ol>
            <dl>
              <div>
                <dt>Received</dt>
                <dd>{zec(current.payment?.receivedZat ?? 0)} ZEC</dd>
              </div>
              <div>
                <dt>Refunded</dt>
                <dd>{zec(current.payment?.refundedZat ?? 0)} ZEC</dd>
              </div>
              {!!current.payment?.reservedZat && (
                <div>
                  <dt>Refund pending</dt>
                  <dd>{zec(current.payment.reservedZat)} ZEC</dd>
                </div>
              )}
              <div>
                <dt>Remaining payment value</dt>
                <dd>{zec(current.payment?.availableZat ?? 0)} ZEC</dd>
              </div>
              <div>
                <dt>Refund capability</dt>
                <dd>
                  {current.payment?.canRefund
                    ? "Route supplied with this payment"
                    : current.payment
                      ? current.routeClosedReason === "expired"
                        ? "Refund window ended"
                        : "Not currently available"
                      : "Waiting for payment"}
                </dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{date(current.createdAt)}</dd>
              </div>
            </dl>
            {current.paymentStatus === "confirmed" && (
              <section className="fulfillment-panel">
                <h3>02 / Fulfillment</h3>
                <p>
                  Merchant-reported state: {current.fulfillment ?? "pending"}. A
                  failed fulfillment does not send a refund automatically.
                </p>
                <div className="home-actions">
                  {(["pending", "fulfilled", "failed"] as const).map(
                    (state) => (
                      <button
                        key={state}
                        className="secondary"
                        disabled={!safe || current.fulfillment === state}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await post("fulfillment", {
                              id: current.id,
                              state,
                            });
                            void refresh();
                          } catch {
                            setError(
                              "Could not confirm fulfillment update. Refresh before trying again.",
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Mark {state}
                      </button>
                    ),
                  )}
                </div>
              </section>
            )}
            {current.canRecoverRoute && (
              <div className="info-panel">
                <h3>Restore remaining refund capability</h3>
                <p>
                  An earlier version removed this route after a partial refund.
                  Check the original payment memo before refunding the remaining
                  value.
                </p>
                <button
                  className="secondary"
                  disabled={!safe}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await post("recover-route", { id: current.id });
                      void refresh();
                    } catch {
                      setError(
                        "Could not verify the original return route. No refund was sent.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Check original payment route
                </button>
              </div>
            )}
            <h3 className="refund-section-title">03 / Refund if needed</h3>
            {current.refundRequests?.map((r) => (
              <MerchantRefundRequest
                key={r.id}
                request={r}
                refund={current.refunds?.find((f) => f.id === `refund_${r.id}`)}
                safe={safe}
                onRefresh={() => void refresh()}
              />
            ))}
            {(current.refunds?.length ?? 0) > 0 && (
              <section className="refund-history" aria-label="Recorded refunds">
                <h4>Recorded refunds</h4>
                {current.refunds!.map((refund) => (
                  <div key={refund.id}>
                    <strong>{zec(refund.amountZat)} ZEC</strong>
                    <p>
                      {refund.status === "confirmed"
                        ? "Confirmed"
                        : refund.status === "failed"
                          ? "Closed without settlement"
                          : refund.status === "broadcast_unknown"
                            ? "Outcome unknown, awaiting reconciliation"
                            : "Processing, awaiting confirmation"}
                    </p>
                  </div>
                ))}
              </section>
            )}
            {current.payment?.canRefund && (
              <p className="refund-instructions">
                NOSTOS uses the refund route supplied with this payment. No
                customer address is needed.{" "}
                <button
                  className="text-button"
                  disabled={!safe}
                  onClick={() =>
                    setDraft(String(current.payment!.availableZat / 1e8))
                  }
                >
                  Use full remaining amount
                </button>
              </p>
            )}
            {current.payment?.canRefund ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = parseZec(draft);
                  if (
                    !safe ||
                    !value ||
                    value > current.payment!.availableZat
                  ) {
                    setError(
                      "Enter a valid amount within the remaining value. Refresh if the connection is interrupted.",
                    );
                    return;
                  }
                  setReview({
                    id: current.id,
                    amountZat: value,
                    instructionId: crypto.randomUUID(),
                  });
                }}
              >
                <label>
                  Full or partial refund in ZEC
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setReview(undefined);
                    }}
                    disabled={busy || !!review || uncertain}
                    placeholder="Enter refund amount"
                  />
                </label>
                {!review && (
                  <button
                    className="primary"
                    disabled={!safe || !parseZec(draft)}
                  >
                    Review refund
                  </button>
                )}
                {review && (
                  <div className="refund-review">
                    <h3>Review private refund</h3>
                    <strong>{zec(review.amountZat)} ZEC</strong>
                    <p>
                      To the refund route supplied with this payment. No new
                      customer address is needed.
                    </p>
                    <button
                      type="button"
                      className="primary"
                      disabled={!safe || submitting.current}
                      onClick={async () => {
                        if (
                          submitting.current ||
                          !safe ||
                          review.id !== current.id ||
                          review.amountZat !== parseZec(draft)
                        )
                          return;
                        submitting.current = true;
                        setBusy(true);
                        setError("");
                        try {
                          await post("refund", review);
                          setReview(undefined);
                          void refresh();
                        } catch {
                          setUncertain(true);
                          setError(
                            "The send outcome is not confirmed. Refresh the saved payment state. Do not send again.",
                          );
                          setReview(undefined);
                          void refresh();
                        } finally {
                          setBusy(false);
                          submitting.current = false;
                        }
                      }}
                    >
                      Send {zec(review.amountZat)} ZEC privately
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => setReview(undefined)}
                    >
                      Change amount
                    </button>
                    {busy && (
                      <StateLabel state="loading" text="Submitting refund" />
                    )}
                  </div>
                )}
              </form>
            ) : (
              <p className="privacy">
                {current.payment?.refundTxid
                  ? current.routeClosedReason === "expired"
                    ? "The refund window has ended."
                    : current.canRecoverRoute
                      ? "Verify the original route to refund the remaining value."
                      : "The recorded refund history is shown above. Open requests need a merchant decision."
                  : (current.pendingRefundAmountZat ?? 0) > 0
                    ? "A refund is already processing. Wait for confirmation or reconciliation before another refund. Do not send again."
                    : current.routeClosedReason === "expired"
                      ? "The refund window has ended. No refund is available."
                      : current.paymentStatus === "confirmed"
                        ? "No refund is currently available. A valid shielded route and an open refund window are required."
                        : "Refund eligibility is checked after payment confirmation."}
              </p>
            )}
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await post<{ token: string }>("link", {
                    id: current.id,
                  });
                  await showLink(r.token);
                } catch {
                  setError("Could not load the private payment link.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              View payment link
            </button>
            <details>
              <summary>Payment reference</summary>
              <code className="break-reference">
                {current.paymentTxid || current.orderReference}
              </code>
            </details>
          </aside>
        )}
      </div>
      <AppFooter />
    </MerchantWorkspace>
  );
}
