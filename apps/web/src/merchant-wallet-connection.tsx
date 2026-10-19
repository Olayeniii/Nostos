"use client";
import { useState } from "react";
import { requestJson } from "./requests.js";
import { useRecord } from "./use-record.js";
export function MerchantWalletConnection() {
  const { data, refresh } = useRecord<{
    connection: { state: string; address: string; network: string } | null;
  }>("/api/product/wallet-connection");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <article className="panel">
      <h2>Connect your business wallet</h2>
      <p>
        You keep the signing keys and recovery phrase in your wallet. Grant
        NOSTOS view access to a dedicated business account so it can check
        payments and refunds.
      </p>
      <p className="privacy">
        A full viewing key reveals account activity and payment memos. It cannot
        spend. Use a dedicated business account. Never enter a recovery phrase
        or spending key here.
      </p>
      {data?.connection && (
        <p role="status">
          {data.connection.state === "connected"
            ? "View access connected. Wallet sync and merchant signing still need verification. Payments remain disabled."
            : "Connection pending. Use the same key and birthday when retrying."}
        </p>
      )}
      {data?.connection?.address && (
        <p className="privacy">
          Observer receiving address: <code>{data.connection.address}</code>. Do
          not fund it during connection testing.
        </p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const form = event.currentTarget,
            fields = new FormData(form);
          const payload = {
            viewingKey: String(fields.get("viewingKey") ?? "").trim(),
            birthday: Number(fields.get("birthday")),
            password: String(fields.get("password") ?? ""),
            consent: fields.get("consent") === "on",
          };
          form.reset();
          setBusy(true);
          setMessage("");
          try {
            await requestJson(
              "/api/product/wallet-connection",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              },
              45000,
            );
            setMessage(
              "View access recorded. Payments remain disabled until sync and merchant signing are proved.",
            );
            await refresh();
          } catch {
            setMessage(
              "Could not verify the connection. Check the key, birthday and password. A pending import is retained; retry only the same details.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Unified full viewing key
          <input
            name="viewingKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            maxLength={3008}
            required
            disabled={busy}
          />
        </label>
        <label>
          Wallet birthday block
          <input
            name="birthday"
            type="number"
            min={1}
            max={4294967295}
            step={1}
            required
            disabled={busy}
          />
        </label>
        <label>
          NOSTOS account password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            required
            disabled={busy}
          />
        </label>
        <label>
          <input name="consent" type="checkbox" required disabled={busy} /> I
          grant NOSTOS view access to this dedicated business account and
          understand that account activity and memos are visible to its
          operator.
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Checking view access" : "Connect view access"}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </article>
  );
}
