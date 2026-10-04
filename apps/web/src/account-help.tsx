"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader, AppFooter } from "./shell.js";
import { requestJson } from "./requests.js";
export function AccountHelp({ link = false }: { link?: boolean }) {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (link) {
      setToken(window.location.hash.slice(1));
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [link]);
  return (
    <main className="product-app">
      <AppHeader />
      <section className="account-card account-help">
        <h1>{link ? "Confirm your email" : "Account access"}</h1>
        <p>
          {link
            ? "Choose your password to finish this account change. Existing sessions will be signed out."
            : "Request a verification email or recover access using your verified email."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setMessage("");
            const data = new FormData(e.currentTarget);
            try {
              const result = await requestJson<{
                message?: string;
                ready?: boolean;
              }>(
                `/api/product/${link ? "account-link" : data.get("purpose")}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(
                    link
                      ? { token, password: data.get("password") }
                      : { email: data.get("email") },
                  ),
                },
                15000,
              );
              if (link)
                window.location.assign(result.ready ? "/merchant" : "/setup");
              else setMessage(result.message ?? "Check your inbox.");
            } catch {
              setMessage(
                link
                  ? "Link unavailable or expired. Request a new email below."
                  : "Could not complete the request. Check the email and try again later.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {link ? (
            <label>
              New password
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                disabled={busy}
              />
            </label>
          ) : (
            <>
              <label>
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  disabled={busy}
                />
              </label>
              <label>
                Request
                <select name="purpose" disabled={busy}>
                  <option value="resend-verification">Verify email</option>
                  <option value="recover-password">Reset password</option>
                </select>
              </label>
            </>
          )}
          <button className="primary" disabled={busy || (link && !token)}>
            {busy ? "Checking" : "Continue"}
          </button>
          {message && <p role="status">{message}</p>}
        </form>
        <p>
          <Link href={link ? "/account-help" : "/sign-in"}>
            {link ? "Request a new email" : "Back to sign in"}
          </Link>
        </p>
      </section>
      <AppFooter />
    </main>
  );
}
