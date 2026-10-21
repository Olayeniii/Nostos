"use client";
import { EmailField, PasswordField } from "./account-fields.js";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PublicSurface } from "./public-surface.js";
import { requestJson } from "./requests.js";
export function AccountHelp({
  link = false,
  reset = false,
}: {
  link?: boolean;
  reset?: boolean;
}) {
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
    <PublicSurface variant="help">
      <section className="account-card account-help">
        <h1>
          {link
            ? "Set your password"
            : reset
              ? "Reset your password"
              : "Verify your email"}
        </h1>
        <p>
          {link
            ? "Choose a password to finish. This link confirms your email and signs you in."
            : reset
              ? "Enter your verified merchant email. We will send a password reset link."
              : "Enter your merchant email. We will send a new verification link."}
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
                `/api/product/${link ? "account-link" : reset ? "recover-password" : "resend-verification"}`,
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
            <PasswordField label="New password" newPassword disabled={busy} />
          ) : (
            <EmailField disabled={busy} />
          )}
          <button className="primary" disabled={busy || (link && !token)}>
            {busy
              ? "Please wait"
              : link
                ? "Set password and sign in"
                : reset
                  ? "Send reset link"
                  : "Send verification email"}
          </button>
          {message && <p role="status">{message}</p>}
        </form>
        <p>
          <Link href={link ? "/account-help" : "/sign-in"}>
            {link ? "Resend verification email" : "Back to sign in"}
          </Link>
        </p>
        {link && (
          <p>
            <Link href="/account-help?purpose=reset">
              Request a new password reset link
            </Link>
          </p>
        )}
      </section>
    </PublicSurface>
  );
}
