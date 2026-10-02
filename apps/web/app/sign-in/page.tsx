"use client";
import { useState } from "react";
import { AppHeader, AppFooter } from "../../src/shell.js";
import { StateLabel } from "../../src/status-label.js";
export default function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main>
      <AppHeader role="Merchant" />
      <section className="sign-in">
        <p className="eyebrow">Merchant workspace</p>
        <h1>Welcome back.</h1>
        <p className="lede">
          Sign in to review payments and manage private refunds.
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            const password = new FormData(event.currentTarget).get("password");
            setBusy(true);
            setError("");
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            try {
              const response = await fetch("/api/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
                signal: controller.signal,
              });
              const data = await response.json();
              if (!response.ok) {
                setError(data.error ?? "Could not sign in. Try again.");
                return;
              }
              window.location.replace("/merchant");
            } catch {
              setError(
                "Connection interrupted. Check your connection and try signing in again.",
              );
            } finally {
              clearTimeout(timer);
              setBusy(false);
            }
          }}
        >
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={12}
            maxLength={128}
            disabled={busy}
            aria-describedby={error ? "sign-in-error" : undefined}
            aria-invalid={!!error}
          />
          {error && (
            <p id="sign-in-error" role="alert" className="warning">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Signing in" : "Sign in"}
          </button>
          {busy && <StateLabel state="loading" text="Opening your workspace" />}
        </form>
        <p className="privacy">
          Your session stays signed in for up to eight hours.
        </p>
      </section>
      <AppFooter />
    </main>
  );
}
