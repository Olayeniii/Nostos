"use client";
import { MerchantWalletConnection } from "../../src/merchant-wallet-connection.js";
import { useNetwork } from "../../src/network-context.js";
import { useEffect, useState } from "react";
import { PublicSurface } from "../../src/public-surface.js";
import { requestJson, RequestError } from "../../src/requests.js";
import { StateLabel } from "../../src/status-label.js";
export default function Setup() {
  const network = useNetwork();
  const hostedSetupAllowed = network === "testnet";
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
    <PublicSurface variant="setup" role="Merchant">
      <section className="setup-card">
        <p className="eyebrow">STORE SETUP</p>
        <h1>Your store, ready for ZEC.</h1>
        <p>Customers see this name when they open your payment link.</p>
        {network === "mainnet" && <MerchantWalletConnection />}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || pending || !hostedSetupAllowed) return;
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
              disabled={busy || pending || !hostedSetupAllowed}
            />
          </label>
          <aside className="info-panel">
            <strong>
              {network === "mainnet"
                ? "Merchant wallet connection pending"
                : "Hosted testnet wallet"}
            </strong>
            <p>
              {network === "mainnet"
                ? "Mainnet store setup is paused until you can connect a wallet whose signing keys you control. Do not enter a recovery phrase or spending key into NOSTOS."
                : "The testnet demo creates an account in the operator wallet. NOSTOS holds its signing keys and can see payment and refund details. Use testnet funds only."}
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
          <button
            className="primary"
            disabled={busy || pending || !hostedSetupAllowed}
          >
            Create store
          </button>
          {busy && (
            <StateLabel state="loading" text="Preparing your store wallet" />
          )}
        </form>
      </section>
    </PublicSurface>
  );
}
