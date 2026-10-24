"use client";
import Link from "next/link";
import { AppFooter } from "../../../src/shell.js";
import { MerchantWorkspace } from "../../../src/merchant-workspace.js";
import { OverviewIcon } from "../../../src/overview-icon.js";
import {
  type Dashboard,
  refundBucket,
  hasRefundActivity,
  paymentHref,
  paymentRecordStatus,
} from "../../../src/merchant-records.js";
import { useRecord } from "../../../src/use-record.js";
import { paymentSummary } from "../../../src/payment-summary.js";
import { zec, date } from "../../../src/receipt-card.js";
import { StateLabel } from "../../../src/status-label.js";
import "../../../src/overview.css";
export default function Overview() {
  const { data, loading, warning, refresh } = useRecord<Dashboard>(
    "/api/product/dashboard",
  );
  const records = data?.records ?? [];
  const summary = paymentSummary(records);
  const fulfillment = records.filter(
    (record) =>
      record.paymentStatus === "confirmed" &&
      record.fulfillment !== "fulfilled",
  );
  const review = records.filter(
    (record) => hasRefundActivity(record) && refundBucket(record) === "review",
  );
  const processing = records.filter(
    (record) =>
      hasRefundActivity(record) && refundBucket(record) === "processing",
  );
  const attention = new Set(
    [...fulfillment, ...review, ...processing].map((record) => record.id),
  ).size;
  const awaiting = records.filter((record) =>
    ["unpaid", "awaiting_payment", "pending"].includes(record.paymentStatus),
  ).length;
  return (
    <MerchantWorkspace
      name={data?.merchant.name}
      className="overview-workspace"
    >
      <div className="overview-title">
        <div>
          <h1>Your payments, in order.</h1>
          <p>Track payments. Fulfill orders. Handle refunds.</p>
        </div>
        <Link
          className="primary overview-create"
          href={
            data?.observerPreview && data.merchant.ready
              ? "/merchant/settings"
              : data?.merchant.ready
                ? "/merchant#new"
                : "/setup"
          }
        >
          <span aria-hidden="true">+</span>
          {data?.observerPreview && data.merchant.ready
            ? "Store settings"
            : data?.merchant.ready
              ? "Create payment link"
              : "Set up store"}
        </Link>
      </div>
      {(warning || data?.syncWarning) && (
        <p role="alert" className="warning">
          {warning ||
            "Wallet sync is unavailable. Saved records are shown. Refresh before taking action."}
        </p>
      )}
      {loading && <StateLabel state="loading" text="Checking store activity" />}
      <section className="overview-metrics" aria-label="Store summary">
        <article className="overview-metric overview-total">
          <h2>Confirmed payments</h2>
          <strong>
            {data ? zec(summary.receivedZat) : "..."}
            <small>ZEC</small>
          </strong>
          <span className="overview-metric-icon">
            <OverviewIcon kind="receipt" />
          </span>
          <p>
            {data
              ? `${summary.confirmedPayments} confirmed payments`
              : "Waiting for payment records"}
          </p>
        </article>
        <article className="overview-metric">
          <h2>Awaiting payment</h2>
          <strong>{data ? awaiting : "..."}</strong>
          <span className="overview-metric-icon">
            <OverviewIcon kind="clock" />
          </span>
          <p>Open payment requests</p>
        </article>
        <article className="overview-metric">
          <h2>Needs attention</h2>
          <strong>{data ? attention : "..."}</strong>
          <span className="overview-metric-icon">
            <OverviewIcon kind="attention" />
          </span>
          <p>Orders with open work</p>
        </article>
      </section>
      <p className="overview-accounting">
        Confirmed payments is a history total.{" "}
        <Link href="/merchant/funds">
          Open Funds for your withdrawable balance.
        </Link>
      </p>
      <section className="overview-attention" aria-labelledby="attention-title">
        <div className="overview-panel-heading">
          <h2 id="attention-title">
            <OverviewIcon kind="attention" />
            Needs your attention
          </h2>
          <Link href="/merchant/refunds">View refunds</Link>
        </div>
        <div className="overview-attention-grid">
          <Link href="/merchant" className="overview-task">
            <span className="overview-task-icon">
              <OverviewIcon kind="package" />
            </span>
            <span>
              <strong>
                {data ? fulfillment.length : "..."}{" "}
                {fulfillment.length === 1
                  ? "order to fulfill"
                  : "orders to fulfill"}
              </strong>
              <small>Payment received, fulfillment still open.</small>
            </span>
            <span className="overview-chevron" aria-hidden="true">
              ›
            </span>
          </Link>
          <Link href="/merchant/refunds" className="overview-task">
            <span className="overview-task-icon">
              <OverviewIcon kind="return" />
            </span>
            <span>
              <strong>
                {data ? review.length : "..."}{" "}
                {review.length === 1 ? "refund request" : "refund requests"}
              </strong>
              <small>
                {processing.length
                  ? `${processing.length} also processing or awaiting reconciliation.`
                  : "Customer requests awaiting your decision."}
              </small>
            </span>
            <span className="overview-chevron" aria-hidden="true">
              ›
            </span>
          </Link>
        </div>
      </section>
      <section className="overview-recent" aria-labelledby="recent-title">
        <div className="overview-panel-heading">
          <h2 id="recent-title">
            <OverviewIcon kind="receipt" />
            Recent payments
          </h2>
          <Link href="/merchant">View all payments</Link>
        </div>
        {data && records.length === 0 ? (
          <div className="empty-state">
            <OverviewIcon kind="receipt" />
            <h3>
              {data.observerPreview
                ? "Your store preview"
                : "Ready for your first payment."}
            </h3>
            <p>
              {data.observerPreview
                ? "Payment creation and signing remain disabled. You can review your store and check wallet sync in Settings."
                : "Create a request and share the checkout link. Your customer needs no NOSTOS account."}
            </p>
            <Link
              className="primary"
              href={
                data.observerPreview && data.merchant.ready
                  ? "/merchant/settings"
                  : data.merchant.ready
                    ? "/merchant#new"
                    : "/setup"
              }
            >
              {data.observerPreview && data.merchant.ready
                ? "Store settings"
                : data.merchant.ready
                  ? "Create payment"
                  : "Set up store"}
            </Link>
          </div>
        ) : (
          <>
            <div className="overview-columns" aria-hidden="true">
              <span>Order</span>
              <span>Amount</span>
              <span>Payment</span>
              <span>Next step</span>
            </div>
            <ul className="studio-record-list overview-records">
              {records.slice(0, 3).map((record) => {
                const bucket = hasRefundActivity(record)
                  ? refundBucket(record)
                  : undefined;
                const action =
                  bucket === "processing"
                    ? "Check refund"
                    : bucket === "review"
                      ? "Review refund"
                      : record.paymentStatus === "confirmed" &&
                          record.fulfillment !== "fulfilled"
                        ? "Mark fulfilled"
                        : "View payment";
                return (
                  <li key={record.id}>
                    <Link href={paymentHref(record.id)}>
                      <span className="overview-order">
                        <span className="overview-record-icon">
                          <OverviewIcon kind="receipt" />
                        </span>
                        <span>
                          <strong>
                            {record.description || record.orderReference}
                          </strong>
                          <small>{record.orderReference}</small>
                        </span>
                      </span>
                      <span className="overview-value">
                        {zec(record.paymentAmountZat)} <small>ZEC</small>
                      </span>
                      <span className="overview-payment">
                        <span
                          className={`overview-payment-label ${record.paymentStatus === "confirmed" ? "is-confirmed" : record.paymentStatus === "expired" ? "is-expired" : "is-pending"}`}
                        >
                          {paymentRecordStatus(record)}
                        </span>
                        <small>{date(record.createdAt)}</small>
                      </span>
                      <span
                        className={`overview-row-action ${action === "Mark fulfilled" ? "is-actionable" : ""}`}
                      >
                        {action}
                        <span aria-hidden="true">›</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      <section
        className="overview-lifecycle"
        aria-label="The payment lifecycle"
      >
        <h2>The payment lifecycle</h2>
        <ol>
          <li>
            <span className="overview-stage-icon">
              <OverviewIcon kind="check" />
            </span>
            <span>
              <strong>PAY</strong>
              <small>Payment confirmed</small>
            </span>
          </li>
          <li>
            <span className="overview-stage-icon">
              <OverviewIcon kind="bag" />
            </span>
            <span>
              <strong>FULFILL</strong>
              <small>Merchant reported</small>
            </span>
          </li>
          <li>
            <span className="overview-stage-icon">
              <OverviewIcon kind="return" />
            </span>
            <span>
              <strong>REFUND IF NEEDED</strong>
              <small>Usable route required</small>
            </span>
          </li>
        </ol>
        <p>
          A refund requires a valid shielded return route and eligibility under
          the merchant's terms.
        </p>
      </section>
      <button
        className="text-button studio-refresh"
        disabled={loading}
        onClick={() => void refresh()}
      >
        Refresh store activity
      </button>
      <AppFooter />
    </MerchantWorkspace>
  );
}
