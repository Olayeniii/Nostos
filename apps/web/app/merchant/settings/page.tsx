"use client";
import { SettingsIcon } from "../../../src/settings-icon.js";
import "../../../src/settings-preview.css";
import { MerchantWalletConnection } from "../../../src/merchant-wallet-connection.js";
import { NetworkLabel, useNetwork } from "../../../src/network-context.js";
import { DEFAULT_REFUND_WINDOW_DAYS } from "../../../src/refund-policy.js";
import { ChangeEmail } from "../../../src/change-email.js";
import { useState } from "react";
import { requestJson } from "../../../src/requests.js";
import Link from "next/link";
import { useRecord } from "../../../src/use-record.js";
import { AppFooter } from "../../../src/shell.js";
import { StateLabel } from "../../../src/status-label.js";
import { MerchantWorkspace } from "../../../src/merchant-workspace.js";
export default function Settings() {
  const network = useNetwork();
  const [profileOpen, setProfileOpen] = useState(false);
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
    <MerchantWorkspace
      name={data?.merchant.name}
      className="settings-workspace"
    >
      <div className="dashboard-title">
        <div>
          <p className="eyebrow">STORE SETTINGS</p>
          <h1>Settings</h1>
          <p>Manage your store and wallet.</p>
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
          <article
            className="panel settings-profile"
            aria-label="Merchant profile"
          >
            <button
              className="settings-profile-button"
              type="button"
              aria-expanded={profileOpen}
              aria-controls="settings-account-details"
              aria-label="Manage merchant profile"
              onClick={() => setProfileOpen(!profileOpen)}
            >
              <span className="settings-store-icon">
                <SettingsIcon kind="store" />
              </span>
              <span className="settings-profile-text">
                <strong>{data.merchant.name || "Set up your store"}</strong>
                <span>{data.merchant.email}</span>
              </span>
              <SettingsIcon kind="chevron" />
            </button>
            {!data.merchant.ready && (
              <Link className="text-button" href="/setup">
                Complete store setup
              </Link>
            )}
          </article>
          {network === "mainnet" ? (
            <MerchantWalletConnection />
          ) : network === "testnet" ? (
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
          ) : (
            <StateLabel state="loading" text="Checking wallet network" />
          )}
          <section
            id="settings-account-details"
            className="settings-account-details"
            hidden={!profileOpen}
          >
            <ChangeEmail />
          </section>
          <details className="settings-policy">
            <summary>
              Refund policy
              <SettingsIcon kind="chevron" />
            </summary>
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
                      data.merchant.refundWindowDays ??
                      DEFAULT_REFUND_WINDOW_DAYS
                    }
                    required
                    disabled={busy}
                  />
                </label>
                <p className="privacy">
                  Choose 1 to 365 days for new requests. The default is 30 days,
                  beginning when payment confirms. Existing requests keep their
                  original terms. Open requests and unresolved refunds keep
                  their route until resolved.
                </p>
                <button className="primary" disabled={busy}>
                  {busy ? "Saving policy" : "Save refund policy"}
                </button>
                {message && <p role="status">{message}</p>}
              </form>
            </article>
          </details>
        </section>
      )}
      <AppFooter />
    </MerchantWorkspace>
  );
}
