"use client";
import { EmailField, PasswordField } from "./account-fields.js";
import { useState } from "react";
import { requestJson } from "./requests.js";
export function ChangeEmail() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [formKey, setFormKey] = useState(0);
  return (
    <article className="panel">
      <h2>Change account email</h2>
      <p>
        Your current verified email stays active until the new address is
        verified. Verification replaces your password and signs out existing
        sessions.
      </p>
      <form
        key={formKey}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const form = e.currentTarget,
            data = new FormData(form);
          setBusy(true);
          try {
            const r = await requestJson<{ message: string }>(
              "/api/product/change-email",
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
            setFormKey((key) => key + 1);
            setMessage(r.message);
          } catch {
            setMessage(
              "Could not request the change. Check the email and password, then try later.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <EmailField label="New email" disabled={busy} />
        <PasswordField label="Current password" disabled={busy} />
        <button className="secondary" disabled={busy}>
          Verify new email
        </button>
        {message && <p role="status">{message}</p>}
      </form>
    </article>
  );
}
