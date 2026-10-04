"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { AppHeader, AppFooter } from "../../src/shell.js";
import { StateLabel } from "../../src/status-label.js";
import { requestJson } from "../../src/requests.js";
import { useRecord } from "../../src/use-record.js";
import { zec, type ReceiptData } from "../../src/receipt-card.js";
type Prepared = {
  uri: string;
  destination: string;
  memo: string;
  amountZat: number;
};
export default function Checkout() {
  const [token, setToken] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<Prepared>();
  const [qr, setQr] = useState("");
  const { data, loading, warning, refresh } = useRecord<{
    receipt: ReceiptData;
    syncWarning: boolean;
  }>("/api/product/checkout", token, !!token);
  useEffect(() => {
    const t = window.location.hash.slice(1);
    if (/^[A-Za-z0-9_-]{43}$/.test(t)) setToken(t);
    setInitialized(true);
  }, []);
  const r = data?.receipt;
  const paid = (r?.paymentConfirmations ?? 0) > 0;
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setError("Copied.");
    } catch {
      setError("Select and copy the value shown.");
    }
  }
  return (
    <main className="product-app">
      <AppHeader role="Customer" />
      <section className="checkout-layout">
        <aside className="checkout-summary">
          <p className="eyebrow">PRIVATE PAYMENT</p>
          <h1>{r?.merchantName || "Your payment"}</h1>
          <p>
            {r?.description ||
              "Open the payment link supplied by your merchant."}
          </p>
          {r && (
            <div className="checkout-total">
              {zec(r.paymentAmountZat)} <span>ZEC</span>
            </div>
          )}
          {r?.refundPolicy && (
            <div className="refund-policy">
              <h3>Store refund policy</h3>
              <p className="preserve-lines">{r.refundPolicy}</p>
            </div>
          )}
          <div className="checkout-assurance">
            <strong>A private route back.</strong>
            <p>
              The refund route you supply travels inside the shielded payment
              memo. The merchant can refund to that route without asking for
              another address.
            </p>
          </div>
          <p className="privacy">
            Zcash testnet only. Pay from a wallet that supports shielded testnet
            payments and custom memos. The website does not hold your customer
            wallet keys.
          </p>
        </aside>
        <section className="checkout-card panel">
          {initialized && !token ? (
            <>
              <h2>Payment link required</h2>
              <p>
                Ask your merchant for the private payment link. It contains the
                request and your receipt access.
              </p>
            </>
          ) : !r ? (
            <>
              <h2>Opening your payment</h2>
              {loading && (
                <StateLabel state="loading" text="Checking payment request" />
              )}
            </>
          ) : paid ? (
            <>
              <span className="status-chip success">Payment confirmed</span>
              <h2>Your payment is complete.</h2>
              <p>
                Save your private receipt link to check payment and refund
                status later.
              </p>
              <a className="primary" href={`/receipt#${token}`}>
                Open your receipt
              </a>
            </>
          ) : (
            <>
              <h2>Pay with shielded ZEC</h2>
              <p>
                Supply a fresh shielded testnet address from a wallet that you
                control. NOSTOS uses its Orchard receiver for the refund route.
              </p>
              {!prepared ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (busy || warning || data?.syncWarning) return;
                    const route = new FormData(e.currentTarget).get("route");
                    setBusy(true);
                    setError("");
                    try {
                      const p = await requestJson<Prepared>(
                        "/api/product/prepare",
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                          },
                          body: JSON.stringify({ route }),
                        },
                        15000,
                      );
                      setPrepared(p);
                      setQr(
                        await QRCode.toDataURL(p.uri, {
                          width: 248,
                          margin: 2,
                          color: { dark: "#0b1514", light: "#f3efe6" },
                        }),
                      );
                    } catch {
                      setError(
                        "Could not prepare the payment. Check the testnet address and connection. Once attached, the return address cannot be changed.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label>
                    Your fresh refund address
                    <input
                      name="route"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      minLength={26}
                      maxLength={506}
                      placeholder="utest1..."
                      required
                      disabled={busy}
                    />
                  </label>
                  <p className="privacy">
                    Use an address you control. NOSTOS checks Orchard
                    capability, not ownership or prior use. The hosted service
                    and merchant wallet can read this route; the receipt omits
                    it.
                  </p>
                  <button
                    className="primary"
                    disabled={busy || loading || !!warning || data?.syncWarning}
                  >
                    Prepare payment
                  </button>
                  {busy && (
                    <StateLabel
                      state="loading"
                      text="Preparing your private return route"
                    />
                  )}
                </form>
              ) : (
                <>
                  <div className="wallet-payment">
                    <img
                      width={248}
                      height={248}
                      src={qr}
                      alt="Zcash payment request QR code, including amount and memo"
                    />
                    <a className="primary" href={prepared.uri}>
                      Open in your wallet
                    </a>
                    <button
                      className="secondary"
                      onClick={() => void copy(prepared.uri)}
                    >
                      Copy complete payment request
                    </button>
                  </div>
                  <p className="privacy">
                    Check that your wallet includes the exact amount and memo
                    before sending. QR and URI support varies by wallet.
                  </p>
                  <details className="manual-payment">
                    <summary>Enter payment details manually</summary>
                    <p>
                      Send a shielded payment. Copy all three fields; the memo
                      is required for the refund route.
                    </p>
                    <label>
                      Merchant payment address
                      <textarea
                        aria-label="Merchant payment address"
                        readOnly
                        value={prepared.destination}
                      />
                    </label>
                    <button
                      className="text-button"
                      onClick={() => void copy(prepared.destination)}
                    >
                      Copy address
                    </button>
                    <label>
                      Amount
                      <input
                        readOnly
                        value={`${zec(prepared.amountZat)} ZEC`}
                      />
                    </label>
                    <label>
                      Payment memo
                      <textarea
                        aria-label="Payment memo"
                        readOnly
                        value={prepared.memo}
                      />
                    </label>
                    <button
                      className="text-button"
                      onClick={() => void copy(prepared.memo)}
                    >
                      Copy memo
                    </button>
                  </details>
                  <aside className="info-panel">
                    <strong>Sent from your wallet?</strong>
                    <p>
                      Keep this page open. Your receipt becomes available when
                      the merchant wallet confirms the payment. Do not send
                      again while waiting.
                    </p>
                    <button
                      className="text-button"
                      disabled={loading}
                      onClick={() => void refresh()}
                    >
                      Check payment
                    </button>
                    {loading && (
                      <StateLabel
                        state="loading"
                        text="Checking shielded payment"
                      />
                    )}
                  </aside>
                  <a className="text-button" href={`/receipt#${token}`}>
                    Save or view your receipt
                  </a>
                </>
              )}
            </>
          )}
          {(warning || data?.syncWarning) && (
            <p className="warning" role="alert">
              {warning ||
                "Wallet sync is temporarily unavailable. Do not repeat a payment that you already sent."}
            </p>
          )}
          {error && (
            <p className="warning" role="status">
              {error}
            </p>
          )}
        </section>
      </section>
      <AppFooter />
    </main>
  );
}
