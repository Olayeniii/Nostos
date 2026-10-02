"use client";
import Link from "next/link";
import { useRecord } from "../../../src/use-record.js";
import { AppHeader, AppFooter } from "../../../src/shell.js";
import { StateLabel } from "../../../src/status-label.js";
export default function Settings() {
  const { data, warning, loading } = useRecord<{
    merchant: {
      name: string;
      email: string;
      ready: boolean;
      setupPending: boolean;
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
          <p>Account and wallet integration details.</p>
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
                <dd>Zcash testnet</dd>
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
                <dd>One instruction per payment</dd>
              </div>
            </dl>
            <p className="privacy">
              Each store has a separate wallet account. The service operator
              controls the wallet keys and can view your payment and refund
              details. A private return route is kept encrypted in product
              storage.
            </p>
          </article>
        </section>
      )}
      <AppFooter />
    </main>
  );
}
