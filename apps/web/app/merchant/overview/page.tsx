"use client";
import Link from "next/link";
import { AppFooter } from "../../../src/shell.js";
import { MerchantWorkspace } from "../../../src/merchant-workspace.js";
import { MerchantRecordList } from "../../../src/merchant-record-list.js";
import {
  type Dashboard,
  refundBucket,
  hasRefundActivity,
} from "../../../src/merchant-records.js";
import { useRecord } from "../../../src/use-record.js";
import { paymentSummary } from "../../../src/payment-summary.js";
import { zec } from "../../../src/receipt-card.js";
import { StateLabel } from "../../../src/status-label.js";
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
  return (
    <MerchantWorkspace name={data?.merchant.name}>
      <div className="dashboard-title">
        <div>
          <p className="eyebrow">WORKSPACE / OVERVIEW</p>
          <h1>Your store, at a glance.</h1>
          <p>Payments received. Orders to fulfill. Refunds to review.</p>
        </div>
        <Link
          className="primary"
          href={data?.merchant.ready ? "/merchant#new" : "/setup"}
        >
          {data?.merchant.ready ? "New payment +" : "Set up store"}
        </Link>
      </div>
      {(warning || data?.syncWarning) && (
        <p role="alert" className="warning">
          {warning ||
            "Wallet sync is unavailable. Saved records are shown. Refresh before taking action."}
        </p>
      )}
      {loading && <StateLabel state="loading" text="Checking store activity" />}
      <section className="studio-overview-grid" aria-label="Store summary">
        <article className="studio-received">
          <p className="eyebrow">CONFIRMED PAYMENTS</p>
          <h2>Total received</h2>
          <strong>
            {data ? zec(summary.receivedZat) : "..."} <small>ZEC</small>
          </strong>
          <p>
            {data
              ? `${summary.confirmedPayments} confirmed payments`
              : "Waiting for payment records"}
          </p>
          <span>
            Payment history total. For wallet funds, see{" "}
            <Link href="/merchant/funds">Funds</Link>.
          </span>
        </article>
        <section className="studio-attention" aria-labelledby="attention-title">
          <h2 id="attention-title">Up next</h2>
          <Link href="/merchant">
            <span>
              Orders to fulfill
              <small>Confirmed payments, fulfillment still open</small>
            </span>
            <strong>{data ? fulfillment.length : "..."}</strong>
          </Link>
          <Link href="/merchant/refunds">
            <span>
              Refund reviews<small>Customer requests awaiting a decision</small>
            </span>
            <strong>{data ? review.length : "..."}</strong>
          </Link>
          <Link href="/merchant/refunds">
            <span>
              Refunds processing
              <small>Awaiting confirmation or reconciliation</small>
            </span>
            <strong>{data ? processing.length : "..."}</strong>
          </Link>
        </section>
      </section>
      <section aria-labelledby="recent-title">
        <div className="section-head">
          <div>
            <h2 className="studio-list-heading" id="recent-title">
              Recent payments
            </h2>
            <p>From your merchant payment records</p>
          </div>
          <Link className="text-button" href="/merchant">
            View payments
          </Link>
        </div>
        {data && records.length === 0 ? (
          <div className="empty-state">
            <h3>Ready for your first payment.</h3>
            <p>
              Create a request and share the checkout link. Your customer needs
              no NOSTOS account.
            </p>
            <Link
              className="primary"
              href={data.merchant.ready ? "/merchant#new" : "/setup"}
            >
              {data.merchant.ready ? "Create payment" : "Set up store"}
            </Link>
          </div>
        ) : (
          <MerchantRecordList records={records.slice(0, 6)} />
        )}
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
