"use client";
import { useEffect, useState } from "react";
import { AppHeader, AppFooter } from "../../src/shell.js";
import { requestJson, RequestError } from "../../src/requests.js";
import { StateLabel } from "../../src/status-label.js";
export default function Setup() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    void requestJson<{ merchant: { ready: boolean; setupPending: boolean } }>(
      "/api/product/me",
      { cache: "no-store" },
      12000,
    )
      .then((r) => {
        if (r.merchant.ready) window.location.assign("/merchant");
        setPending(r.merchant.setupPending);
      })
      .catch((e) => {
        if (e instanceof RequestError && e.status === 401)
          window.location.assign("/sign-in");
        else setMessage("Could not check store setup. Try refreshing.");
      });
  }, []);
  return (
    <main className="product-app">
      <AppHeader role="Merchant" />
      <section className="setup-card">
        <p className="eyebrow">STORE SETUP</p>
        <h1>Your store, ready for ZEC.</h1>
        <p>Customers see this name when they open your payment link.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || pending) return;
            const name = new FormData(e.currentTarget).get("name");
            setBusy(true);
            setMessage("");
            try {
              await requestJson(
                "/api/product/setup",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name }),
                },
                30000,
              );
              window.location.assign("/merchant");
            } catch {
              setPending(true);
              setMessage(
                "Setup could not be confirmed. Refresh to check its saved state; do not create another store.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Store name
            <input
              name="name"
              minLength={2}
              maxLength={80}
              required
              autoComplete="organization"
              disabled={busy || pending}
            />
          </label>
          <aside className="info-panel">
            <strong>Hosted merchant wallet</strong>
            <p>
              NOSTOS creates a separate wallet account for your store. This
              service holds the signing keys and can see payment and refund
              details. Do not use real funds.
            </p>
          </aside>
          {pending && (
            <p className="warning">
              Your store setup is being reconciled. Contact the operator if this
              persists.
            </p>
          )}
          {message && (
            <p className="warning" role="alert">
              {message}
            </p>
          )}
          <button className="primary" disabled={busy || pending}>
            Create store
          </button>
          {busy && (
            <StateLabel state="loading" text="Preparing your store wallet" />
          )}
        </form>
      </section>
      <AppFooter />
    </main>
  );
}
