"use client";

import { useEffect, useRef, useState } from "react";
import { AppHeader, AppFooter } from "../../src/shell.js";
import { StateLabel, type Status } from "../../src/status-label.js";
import { requestJson } from "../../src/requests.js";

type Receipt = {
  orderReference: string;
  paymentAmountZat: number;
  paymentConfirmations: number;
  refundAmountZat: number;
  status: string;
  refundTxid?: string;
};
const zec = (amount: number) =>
  (amount / 100000000).toLocaleString("en", { maximumFractionDigits: 8 });
function receiptState(receipt: Receipt): { state: Status; text: string } {
  if (receipt.status === "confirmed")
    return { state: "confirmed", text: "Refund received privately" };
  if (receipt.status === "broadcast")
    return {
      state: "broadcast",
      text: "Refund sent, waiting for confirmation",
    };
  if (["broadcast_unknown", "broadcasting"].includes(receipt.status))
    return { state: "broadcast_unknown", text: "Checking refund state" };
  if (receipt.status === "pending")
    return { state: "loading", text: "Preparing refund" };
  return { state: "ready", text: "No refund issued for this payment" };
}
export default function CustomerReceipt() {
  const [draft, setDraft] = useState("");
  const [access, setAccess] = useState("");
  const [receipt, setReceipt] = useState<Receipt>();
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const request = useRef<AbortController | undefined>(undefined);
  const version = useRef(0);
  const saved = useRef(false);
  function accessFrom(value: string) {
    if (/^[A-Za-z0-9_-]{43}$/.test(value)) return value;
    try {
      const url = new URL(value);
      if (url.origin !== window.location.origin || url.pathname !== "/receipt")
        return "";
      const token = url.hash.slice(1);
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : "";
    } catch {
      return "";
    }
  }
  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) setAccess(token);
  }, []);
  async function refresh() {
    if (!access || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const current = ++version.current;
    setLoading(true);
    try {
      const result = await requestJson<{ receipt: Receipt }>(
        "/api/receipt",
        {
          headers: { Authorization: `Bearer ${access}` },
          cache: "no-store",
        },
        12000,
        controller.signal,
      );
      if (current !== version.current) return;
      setReceipt(result.receipt);
      saved.current = true;
      setWarning("");
    } catch {
      if (current !== version.current) return;
      setWarning(
        saved.current
          ? "Connection interrupted. Your last saved receipt is shown."
          : "Could not load this receipt. Check your private link and connection.",
      );
    } finally {
      if (current === version.current) {
        request.current = undefined;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    version.current++;
    request.current?.abort();
    request.current = undefined;
    saved.current = false;
    setReceipt(undefined);
    setWarning("");
    setLoading(false);
    if (!access) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 8000);
    return () => {
      clearInterval(timer);
      version.current++;
      request.current?.abort();
      request.current = undefined;
    };
  }, [access]);
  const state = receipt
    ? receiptState(receipt)
    : { state: "ready" as const, text: "Private receipt access" };
  return (
    <main>
      <AppHeader role="Customer" />
      <section className="workspace-intro">
        <p className="eyebrow">YOUR PAYMENT</p>
        <h1>Your private receipt.</h1>
        <p className="lede">
          Check the refund status for your payment. No wallet connection is
          needed to view this receipt.
        </p>
      </section>
      {!receipt && (
        <form
          className="access"
          onSubmit={(event) => {
            event.preventDefault();
            const token = accessFrom(draft.trim());
            if (!token) {
              setWarning(
                "Enter the private receipt link supplied by the merchant.",
              );
              return;
            }
            if (token === access) void refresh();
            else setAccess(token);
          }}
        >
          <label>
            Private receipt link
            <input
              type="password"
              autoComplete="off"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Paste your receipt link"
              disabled={loading}
            />
          </label>
          <p className="privacy">
            Use the link for your payment. Merchant access codes cannot open
            customer receipts.
          </p>
          <button className="primary" disabled={loading || !draft.trim()}>
            Open receipt
          </button>
        </form>
      )}
      {warning && (
        <p role="alert" className="warning">
          {warning}
        </p>
      )}
      {receipt && (
        <section className="receipts">
          <article className="receipt">
            <StateLabel state={state.state} text={state.text} />
            <h2>{receipt.orderReference}</h2>
            {receipt.refundAmountZat > 0 && (
              <div className="amount">
                {zec(receipt.refundAmountZat)} <span>ZEC</span>
              </div>
            )}
            <dl>
              <div>
                <dt>Original payment</dt>
                <dd>{zec(receipt.paymentAmountZat)} ZEC</dd>
              </div>
              <div>
                <dt>Payment status</dt>
                <dd>
                  {receipt.paymentConfirmations > 0
                    ? "Confirmed"
                    : "Waiting for confirmation"}
                </dd>
              </div>
            </dl>
            {receipt.refundTxid && (
              <details>
                <summary>Transaction details</summary>
                <p className="mono transaction-reference">
                  {receipt.refundTxid.slice(0, 12)}...
                  {receipt.refundTxid.slice(-8)}
                </p>
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(receipt.refundTxid!);
                      setCopyMessage("Transaction reference copied.");
                    } catch {
                      setCopyMessage(
                        "Could not copy the transaction reference.",
                      );
                    }
                  }}
                >
                  Copy transaction reference
                </button>
                {copyMessage && (
                  <p role="status" className="privacy">
                    {copyMessage}
                  </p>
                )}
              </details>
            )}
            <button
              className="text-button"
              disabled={loading}
              onClick={() => void refresh()}
            >
              Refresh receipt
            </button>
            {loading && (
              <StateLabel state="loading" text="Checking your receipt" />
            )}
          </article>
          <p className="privacy">
            This link grants read-only access to this payment's receipt. Keep it
            private.
          </p>
        </section>
      )}
      {loading && !receipt && (
        <StateLabel state="loading" text="Checking your private receipt" />
      )}
      <AppFooter />
    </main>
  );
}
