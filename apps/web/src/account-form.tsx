"use client";
import { useState } from "react";
import Link from "next/link";
import { AppHeader, AppFooter } from "./shell.js";
import { StateLabel } from "./status-label.js";
import { requestJson } from "./requests.js";
export function AccountForm({ signup = false }: { signup?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return (
    <main className="product-app">
      <AppHeader />
      <section className="account-layout">
        <div className="account-context">
          <p className="eyebrow">NOSTOS FOR MERCHANTS</p>
          <h1>
            Accept privately.
            <br />
            Refund simply.
          </h1>
          <p>
            Create a payment request. Receive shielded ZEC. Send a refund to the
            return route that came with the payment.
          </p>
          <ul className="account-benefits">
            <li>Shielded testnet payments</li>
            <li>One encrypted return route per payment</li>
            <li>Payment and refund records in one workspace</li>
          </ul>
        </div>
        <form
          className="account-card"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const data = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              const result = await requestJson<{ ready: boolean }>(
                `/api/product/${signup ? "signup" : "login"}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    email: data.get("email"),
                    password: data.get("password"),
                  }),
                },
                15000,
              );
              if (signup) {
                setMessage(
                  "If verification is needed, an email has been sent. Open it to choose your password and activate merchant access.",
                );
                setBusy(false);
              } else
                window.location.assign(result.ready ? "/merchant" : "/setup");
            } catch {
              setError(
                signup
                  ? "Could not create your account. Check the details, or sign in if you already registered."
                  : "Could not sign in. Check your email, password, and connection.",
              );
              setBusy(false);
            }
          }}
        >
          <h2>{signup ? "Create your account" : "Welcome back"}</h2>
          <p>
            {signup
              ? "Start accepting refundable Zcash payments."
              : "Sign in to your merchant workspace."}
          </p>
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              disabled={busy}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              required
              minLength={12}
              maxLength={128}
              disabled={busy}
            />
          </label>
          <small>
            Use at least 12 characters. Merchant access requires a verified
            email.
          </small>
          {message && <p role="status">{message}</p>}
          <p>
            <Link href="/account-help">Verify email or reset password</Link>
          </p>
          {error && (
            <p className="warning" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {signup ? "Create account" : "Sign in"}
          </button>
          {busy && (
            <StateLabel
              state="loading"
              text={signup ? "Creating your account" : "Signing in"}
            />
          )}
          <p className="account-switch">
            {signup ? "Already have an account?" : "New to NOSTOS?"}{" "}
            <Link href={signup ? "/sign-in" : "/sign-up"}>
              {signup ? "Sign in" : "Create account"}
            </Link>
          </p>
        </form>
      </section>
      <AppFooter />
    </main>
  );
}
