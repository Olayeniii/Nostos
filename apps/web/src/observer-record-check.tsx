"use client";
import { useRef, useState } from "react";
import type { RecordData } from "./merchant-records.js";
import { requestJson } from "./requests.js";

export function ObserverRecordCheck({
  record,
  onRefresh,
}: {
  record: RecordData;
  onRefresh: () => void;
}) {
  const [txid, setTxid] = useState(record.paymentTxid ?? "");
  const [pool, setPool] = useState("ironwood");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(false);
  async function check(action: string, body: unknown) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setMessage("");
    try {
      await requestJson(
        `/api/product/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        45000,
      );
      setMessage(
        "Matching confirmed output verified. Saved records have been refreshed.",
      );
    } catch {
      setMessage(
        "The output could not be verified. No send was requested. Refresh saved records before another check; do not send again.",
      );
    } finally {
      active.current = false;
      setBusy(false);
      onRefresh();
    }
  }
  return (
    <section
      className="refund-request-panel"
      aria-label="Observer transaction checks"
    >
      <details>
        <summary>Payment recovery</summary>
        <p>
          Payments are checked automatically. Use these recovery checks only if
          a sent payment has not appeared. They verify saved details and cannot
          sign or send.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void check("observer-payment-check", {
              id: record.id,
              txid: txid.trim(),
              pool,
            });
          }}
        >
          <label>
            Payment transaction reference
            <input
              value={txid}
              onChange={(e) => setTxid(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              minLength={64}
              maxLength={64}
              pattern="[a-f0-9]{64}"
              required
              disabled={busy}
            />
          </label>
          <label>
            Shielded output pool
            <select
              value={pool}
              onChange={(e) => setPool(e.target.value)}
              disabled={busy}
            >
              <option value="ironwood">Ironwood</option>
              <option value="orchard">Orchard</option>
            </select>
          </label>
          <button
            className="secondary"
            disabled={busy || !/^[a-f0-9]{64}$/.test(txid.trim())}
          >
            {busy ? "Checking output" : "Verify payment output"}
          </button>
        </form>
        {record.refundRequests
          ?.filter((r) => r.status === "approved" || r.status === "settled")
          .map((r) => (
            <div key={r.id}>
              <p>
                Refund request: <code>{r.id}</code>
              </p>
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void check("observer-refund-check", { requestId: r.id })
                }
              >
                Check saved refund output
              </button>
            </div>
          ))}
        <p className="privacy">
          Refund checks use the saved instruction and look for matching outgoing
          transactions. This screen does not authorize another send.
        </p>
        {message && <p role="status">{message}</p>}
      </details>
    </section>
  );
}
