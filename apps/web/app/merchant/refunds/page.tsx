"use client";
import { useState } from "react";
import { AppFooter } from "../../../src/shell.js";
import { MerchantWorkspace } from "../../../src/merchant-workspace.js";
import { MerchantRecordList } from "../../../src/merchant-record-list.js";
import {
  type Dashboard,
  type RefundBucket,
  hasRefundActivity,
  refundBucket,
} from "../../../src/merchant-records.js";
import { useRecord } from "../../../src/use-record.js";
import { StateLabel } from "../../../src/status-label.js";
export default function Refunds() {
  const { data, loading, warning, refresh } = useRecord<Dashboard>(
    "/api/product/dashboard",
  );
  const [filter, setFilter] = useState<RefundBucket | "all">("all");
  const [query, setQuery] = useState("");
  const records = (data?.records ?? []).filter(hasRefundActivity);
  const shown = records.filter(
    (record) =>
      (filter === "all" || refundBucket(record) === filter) &&
      `${record.description ?? ""} ${record.orderReference}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const tabs = [
    ["all", "All"],
    ["review", "Needs review"],
    ["processing", "Processing"],
    ["history", "History"],
  ] as const;
  return (
    <MerchantWorkspace name={data?.merchant.name}>
      <div className="dashboard-title">
        <div>
          <p className="eyebrow">WORKSPACE / REFUNDS</p>
          <h1>Refunds</h1>
          <p>Customer requests and the return of payment value.</p>
        </div>
        <button
          className="secondary"
          disabled={loading}
          onClick={() => void refresh()}
        >
          Refresh refunds
        </button>
      </div>
      {(warning || data?.syncWarning) && (
        <p role="alert" className="warning">
          {warning ||
            "Wallet sync is unavailable. Saved records are shown. Refresh before taking action."}
        </p>
      )}
      <p className="studio-context">
        Open a payment to review its request, refund progress, and remaining
        value. Refund availability is checked in payment details. No new
        customer address is needed when a usable shielded route is available.
      </p>
      <div className="studio-tools">
        <div className="studio-tabs" aria-label="Filter refunds">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
              {data && (
                <span className="studio-tab-count">
                  {value === "all"
                    ? records.length
                    : records.filter((record) => refundBucket(record) === value)
                        .length}
                </span>
              )}
            </button>
          ))}
        </div>
        <label className="studio-search">
          <span className="sr-only">Find a refund</span>
          <input
            type="search"
            placeholder="Find a refund"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {loading && <StateLabel state="loading" text="Checking refunds" />}
      <MerchantRecordList records={shown} refunds />
      {data && !loading && shown.length === 0 && (
        <div className="empty-state">
          <h2>
            {records.length ? "No matching refunds" : "No refund activity yet."}
          </h2>
          <p>
            {records.length
              ? "Try another order name or filter."
              : "Customer requests and recorded refunds will appear here. You can review refund availability from any payment."}
          </p>
          {records.length > 0 && (
            <button
              className="secondary"
              onClick={() => {
                setFilter("all");
                setQuery("");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
      <AppFooter />
    </MerchantWorkspace>
  );
}
