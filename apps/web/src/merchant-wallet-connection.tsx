"use client";
import { useCommercePreview } from "./network-context.js";
import { SettingsIcon } from "./settings-icon.js";
import type { ObserverSyncStatus } from "./merchant-observer.js";
import "./merchant-wallet.css";
import { useEffect, useState } from "react";
import { requestJson } from "./requests.js";
import { useRecord } from "./use-record.js";
export function MerchantWalletConnection({
  onConnectionChange,
}: {
  onConnectionChange?: (connected: boolean) => void;
} = {}) {
  const commerce = useCommercePreview();
  const { data, refresh } = useRecord<{
    connection: { state: string; address: string; network: string } | null;
  }>("/api/product/wallet-connection");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [sync, setSync] = useState<ObserverSyncStatus>();
  const [checkedAt, setCheckedAt] = useState<string>();
  const [copied, setCopied] = useState("");
  const [showAddress, setShowAddress] = useState(false);
  const address = data?.connection?.address;
  const connected = data?.connection?.state === "connected";
  useEffect(() => {
    onConnectionChange?.(connected);
  }, [connected, onConnectionChange]);
  return (
    <article className="panel business-wallet" aria-label="Business wallet">
      <div className="business-wallet-heading">
        <h2>Business wallet</h2>
        {connected && (
          <span className="wallet-connected">
            <i aria-hidden="true" />
            Connected
          </span>
        )}
      </div>
      {connected && address && (
        <section className="wallet-address" aria-label="Receiving address">
          <span className="wallet-field-label">Receiving address</span>
          <div className="wallet-address-row">
            <code aria-label="Shortened receiving address">
              {address.slice(0, 12)}...{address.slice(-8)}
            </code>
            <button
              type="button"
              className="secondary"
              aria-label="Copy receiving address"
              onClick={async () => {
                setCopied("");
                try {
                  await navigator.clipboard.writeText(address);
                  setCopied("Address copied.");
                } catch {
                  setShowAddress(true);
                  setCopied("Could not copy. Select the full address below.");
                }
              }}
            >
              <SettingsIcon kind="copy" /> Copy
            </button>
          </div>
          <button
            type="button"
            className="text-button wallet-address-toggle"
            aria-expanded={showAddress}
            onClick={() => setShowAddress(!showAddress)}
          >
            {showAddress ? "Hide full address" : "Show full address"}
            <SettingsIcon kind="chevron" />
          </button>
          {showAddress && (
            <code className="wallet-full-address">{address}</code>
          )}
          {copied && (
            <p role="status" className="wallet-copy-feedback">
              {copied}
            </p>
          )}
        </section>
      )}
      {connected && (
        <section className="wallet-sync" aria-label="Observer sync readiness">
          <span className="wallet-sync-icon">
            <SettingsIcon kind="sync" />
          </span>
          <div>
            <strong role="status">
              {sync
                ? sync.state === "ready"
                  ? "Caught up at last check"
                  : "Wallet is syncing"
                : "Sync not checked"}
            </strong>
            <p>
              {sync
                ? sync.state === "syncing"
                  ? `Scanned block ${sync.scannedHeight ?? "not available"}; chain tip ${sync.nodeHeight}.`
                  : `Checked at ${checkedAt}`
                : "Check the latest wallet sync status."}
            </p>
          </div>
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setSync(undefined);
              setCheckedAt(undefined);
              setMessage("");
              try {
                const result = await requestJson<{
                  status: ObserverSyncStatus;
                }>("/api/product/wallet-status", { cache: "no-store" }, 20000);
                setSync(result.status);
                setCheckedAt(
                  new Date().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                );
              } catch {
                setMessage(
                  "Could not verify current sync readiness. Saved view access is unchanged. Try the status check again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Checking" : "Check sync"}
          </button>
        </section>
      )}
      {!connected && (
        <p className="wallet-intro">
          Connect your business account with view access. Your signing keys and
          recovery phrase stay in your wallet.
        </p>
      )}
      {data?.connection?.state === "importing" && (
        <p role="status">
          Connection pending. Use the same key and birthday when retrying.
        </p>
      )}
      <p className="wallet-preview-notice">
        <SettingsIcon kind="info" />
        <span>
          {commerce
            ? "Payment preview: your wallet signs every refund."
            : "Preview: payments are disabled."}
        </span>
      </p>
      <details className="wallet-privacy" open={!connected}>
        <summary>
          <SettingsIcon kind="lock" />
          <span>View access and privacy</span>
          <SettingsIcon kind="chevron" />
        </summary>
        <p>
          A full viewing key reveals account activity and payment memos. It
          cannot spend. Use a dedicated business account. Never enter a recovery
          phrase or spending key here.
        </p>
        <p>
          Hosted chain services may see the server network address and requested
          transaction IDs. This preview observes only the Orchard pool family;
          it does not import transparent view access.
        </p>
        <p>
          {commerce
            ? "Payments arrive in your connected business wallet. NOSTOS can verify them but cannot spend your funds. Approve refunds only after checking the address, amount, memo and fee in your wallet."
            : "Payment creation and signing remain disabled in this connection preview. Do not fund this receiving address during connection testing."}
        </p>
      </details>
      {data?.connection?.state !== "connected" && (
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
              scopeConsent: fields.get("consent") === "on",
            };
            form.reset();
            setBusy(true);
            setSync(undefined);
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
              setMessage("");
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
          <label className="consent-field">
            <input name="consent" type="checkbox" required disabled={busy} /> I
            grant NOSTOS view access to this dedicated business account and
            understand that account activity and memos are visible to its
            operator. For SDK preview, I authorize Orchard-family view access
            and the hosted chain queries described above.
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Checking view access" : "Connect view access"}
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </article>
  );
}
