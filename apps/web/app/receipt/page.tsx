"use client";

import { useEffect, useRef, useState } from "react";
import { PublicSurface } from "../../src/public-surface.js";
import "../../src/receipt.css";
import { StateLabel } from "../../src/status-label.js";
import { requestJson, RequestError } from "../../src/requests.js";

import { CustomerRefundRequest } from "../../src/customer-refund-request.js";
import { ReceiptCard, type ReceiptData } from "../../src/receipt-card.js";
type Receipt = ReceiptData;
export default function CustomerReceipt() {
  const [draft, setDraft] = useState("");
  const [access, setAccess] = useState("");
  const [receipt, setReceipt] = useState<Receipt>();
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState("");
  const [initialized, setInitialized] = useState(false);
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
    setInitialized(true);
  }, []);
  async function refresh() {
    if (!access || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const current = ++version.current;
    setLoading(true);
    try {
      const options = {
        headers: { Authorization: `Bearer ${access}` },
        cache: "no-store" as const,
      };
      let result: { receipt: Receipt; syncWarning?: boolean };
      try {
        result = await requestJson<{ receipt: Receipt }>(
          "/api/product/checkout",
          options,
          12000,
          controller.signal,
        );
      } catch (error) {
        if (
          !(error instanceof RequestError) ||
          ![401, 503].includes(error.status)
        )
          throw error;
        result = await requestJson<{ receipt: Receipt }>(
          "/api/receipt",
          {
            headers: { Authorization: `Bearer ${access}` },
            cache: "no-store",
          },
          12000,
          controller.signal,
        );
      }
      if (current !== version.current) return;
      setReceipt(result.receipt);
      saved.current = true;
      setWarning(
        result.syncWarning
          ? "Wallet sync is temporarily unavailable. The last recorded receipt status is shown."
          : "",
      );
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
  return (
    <PublicSurface variant="receipt" role="Customer">
      <section className="workspace-intro">
        <h1>Your private receipt.</h1>
        <p className="lede">
          Check the refund status for your payment. No wallet connection is
          needed to view this receipt.
        </p>
      </section>
      {initialized && !access && !receipt && (
        <form
          className="access"
          onSubmit={(event) => {
            event.preventDefault();
            const token = accessFrom(draft.trim());
            if (!token) {
              setWarning("Enter the private receipt link saved from checkout.");
              return;
            }
            if (token === access) void refresh();
            else setAccess(token);
          }}
        >
          <label>
            Private receipt link
            <input
              name="receiptLink"
              spellCheck={false}
              type="password"
              autoComplete="off"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Paste your receipt link"
              disabled={loading}
            />
          </label>
          <p className="privacy">
            Use the private link saved from your payment checkout.
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
        <section className="receipt-container">
          <ReceiptCard
            receipt={receipt}
            loading={loading}
            onRefresh={() => void refresh()}
          />
          <CustomerRefundRequest
            receipt={receipt}
            token={access}
            onRefresh={() => void refresh()}
          />
          <p className="privacy">
            This private link lets its holder view this receipt and request a
            refund. Save it somewhere safe.
          </p>
        </section>
      )}
      {loading && !receipt && (
        <StateLabel state="loading" text="Checking your private receipt" />
      )}
    </PublicSurface>
  );
}
