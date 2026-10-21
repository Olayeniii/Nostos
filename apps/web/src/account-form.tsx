"use client";
import { EmailField, PasswordField } from "./account-fields.js";
import { useState } from "react";
import Link from "next/link";
import { PublicSurface } from "./public-surface.js";
import { StateLabel } from "./status-label.js";
import { requestJson, RequestError } from "./requests.js";
export function AccountForm({ signup = false }: { signup?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationRequired, setVerificationRequired] = useState(false);
  return (
    <PublicSurface variant="account">
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
            <li>Shielded Zcash payments</li>
            <li>One encrypted return route per payment</li>
            <li>Payment and refund records in one workspace</li>
          </ul>
        </div>
        {verificationEmail ? (
          <section className="account-card">
            <h2>Check your email</h2>
            <p>
              Open the verification link sent to {verificationEmail} to set your
              password and finish creating your account.
            </p>
            <p>If you already have a verified account, sign in instead.</p>
            <p>Check your spam folder if the email has not arrived.</p>
            {message && <p role="status">{message}</p>}
            {error && (
              <p className="warning" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await requestJson(
                    "/api/product/resend-verification",
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ email: verificationEmail }),
                    },
                    15000,
                  );
                  setMessage(
                    "If verification is needed, another email has been sent.",
                  );
                } catch {
                  setError(
                    "Could not resend the email. Please wait before trying again.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Sending" : "Resend verification email"}
            </button>
            <p className="account-switch">
              <button
                className="text-button"
                onClick={() => {
                  setVerificationEmail("");
                  setMessage("");
                  setError("");
                }}
                disabled={busy}
              >
                Use a different email
              </button>
            </p>
            <p className="account-switch">
              <Link href="/sign-in">Back to sign in</Link>
            </p>
          </section>
        ) : (
          <form
            className="account-card"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const data = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              setVerificationRequired(false);
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
                  setVerificationEmail(String(data.get("email") ?? ""));
                  setBusy(false);
                } else
                  window.location.assign(result.ready ? "/merchant" : "/setup");
              } catch (failure) {
                setVerificationRequired(
                  !signup &&
                    failure instanceof RequestError &&
                    failure.status === 403,
                );
                setError(
                  !signup &&
                    failure instanceof RequestError &&
                    failure.status === 503
                    ? "Sign in is temporarily unavailable. Please try again shortly."
                    : !signup &&
                        failure instanceof RequestError &&
                        failure.status === 429
                      ? "Too many attempts. Please wait ten minutes before trying again."
                      : signup
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
            <EmailField disabled={busy} />
            {!signup && <PasswordField disabled={busy} />}
            {signup && (
              <small>Verify your email, then set your password.</small>
            )}
            {message && <p role="status">{message}</p>}
            {!signup && (
              <p>
                <Link href="/account-help?purpose=reset">Forgot password?</Link>
              </p>
            )}
            {error && (
              <p className="warning" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {signup ? "Send verification email" : "Sign in"}
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
            {!signup && verificationRequired && (
              <p className="account-switch">
                <Link href="/account-help">Verify your email</Link>
              </p>
            )}
          </form>
        )}
      </section>
    </PublicSurface>
  );
}
