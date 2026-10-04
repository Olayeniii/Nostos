"use client";
import { useState } from "react";
import { requestJson } from "./requests.js";
export function ChangeEmail() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <article className="panel">
      <h2>Change account email</h2>
      <p>
        Your current verified email stays active until the new address is
        verified. Verification replaces your password and signs out existing
        sessions.
      </p>
      <form
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
            form.reset();
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
        <label>
          New email
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            disabled={busy}
          />
        </label>
        <label>
          Current password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={12}
            maxLength={128}
            required
            disabled={busy}
          />
        </label>
        <button className="secondary" disabled={busy}>
          Verify new email
        </button>
        {message && <p role="status">{message}</p>}
      </form>
    </article>
  );
}
