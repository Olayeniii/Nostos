"use client";
import { NetworkLabel } from "../../../src/network-context.js";
import { DEFAULT_REFUND_WINDOW_DAYS } from "../../../src/refund-policy.js";
import { ChangeEmail } from "../../../src/change-email.js";
import { useState } from "react";
import { requestJson } from "../../../src/requests.js";
import Link from "next/link";
import { useRecord } from "../../../src/use-record.js";
import { AppHeader, AppFooter } from "../../../src/shell.js";
import { StateLabel } from "../../../src/status-label.js";
export default function Settings() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const { data, warning, loading, refresh } = useRecord<{
    merchant: {
      name: string;
      email: string;
      ready: boolean;
      setupPending: boolean;
      refundPolicy: string;
      refundWindowDays: number | null;
    };
  }>("/api/product/me");
  return (
    <main className="product-app">
      <AppHeader role="Merchant" />
      <nav className="workspace-nav">
        <Link href="/merchant">Payments</Link>
        <Link href="/merchant/settings" aria-current="page">
          Store settings
        </Link>
      </nav>
      <div className="dashboard-title">
        <div>
          <p className="eyebrow">STORE SETTINGS</p>
          <h1>Your store</h1>
          <p>Account, wallet and refund policy.</p>
        </div>
      </div>
      {warning && (
        <p role="alert" className="warning">
          {warning}
        </p>
      )}
      {loading && <StateLabel state="loading" text="Checking your store" />}
      {data && (
        <section className="settings-grid">
          <ChangeEmail />
          <article className="panel">
            <h2>Merchant profile</h2>
            <dl>
              <div>
                <dt>Store name</dt>
                <dd>{data.merchant.name || "Not set up"}</dd>
              </div>
              <div>
                <dt>Account email</dt>
                <dd>{data.merchant.email}</dd>
              </div>
            </dl>
            {!data.merchant.ready && (
              <Link className="primary" href="/setup">
                Complete store setup
              </Link>
            )}
          </article>
          <article className="panel">
            <h2>Wallet integration</h2>
            <dl>
              <div>
                <dt>Network</dt>
                <dd>
                  <NetworkLabel />
                </dd>
              </div>
              <div>
                <dt>Custody</dt>
                <dd>Hosted by NOSTOS</dd>
              </div>
              <div>
                <dt>Store wallet</dt>
                <dd>
                  {data.merchant.ready
                    ? "Provisioned"
                    : data.merchant.setupPending
                      ? "Reconciliation needed"
                      : "Not provisioned"}
                </dd>
              </div>
              <div>
                <dt>Refund policy</dt>
                <dd>
                  Full or partial refunds within the remaining payment value
                </dd>
              </div>
            </dl>
            <p className="privacy">
              Each store has a separate wallet account. The service operator
              controls the wallet keys and can view your payment and refund
              details. A private return route is kept encrypted in product
              storage.
            </p>
          </article>
          <article className="panel">
            <h2>Refund policy</h2>
            <p>
              Customers see this policy before paying and on their receipt.
              Changes apply only to new payment requests.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                const form = new FormData(e.currentTarget);
                const days = String(form.get("days")).trim();
                setBusy(true);
                setMessage("");
                try {
                  await requestJson(
                    "/api/product/policy",
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        policy: String(form.get("policy")),
                        windowDays: Number(days),
                      }),
                    },
                    15000,
                  );
                  setMessage("Policy saved for new payment requests.");
                  void refresh();
                } catch {
                  setMessage(
                    "Could not save the policy. Refresh before trying again.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Store refund policy
                <textarea
                  name="policy"
                  defaultValue={data.merchant.refundPolicy}
                  minLength={3}
                  maxLength={1000}
                  required
                  disabled={busy}
                />
              </label>
              <label>
                Request window in days
                <input
                  name="days"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={
                    data.merchant.refundWindowDays ?? DEFAULT_REFUND_WINDOW_DAYS
                  }
                  required
                  disabled={busy}
                />
              </label>
              <p className="privacy">
                Choose 1 to 365 days for new requests. The default is 30 days,
                beginning when payment confirms. Existing requests keep their
                original terms. Open requests and unresolved refunds keep their
                route until resolved.
              </p>
              <button className="primary" disabled={busy}>
                {busy ? "Saving policy" : "Save refund policy"}
              </button>
              {message && <p role="status">{message}</p>}
            </form>
          </article>
        </section>
      )}
      <AppFooter />
    </main>
  );
}
