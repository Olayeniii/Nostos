import Link from "next/link";
import { AppHeader, AppFooter } from "../src/shell.js";
import { accountWorkspace } from "../src/account-workspace.server.js";
import "../src/public-surface.css";
import "../src/home.css";

const steps = [
  {
    title: "Pay privately",
    text: "Share a payment link. The customer pays shielded ZEC with a refund route included in the memo.",
    icon: "01",
  },
  {
    title: "Fulfill the order",
    text: "Track payment confirmation and record fulfillment from your merchant workspace.",
    icon: "02",
  },
  {
    title: "Refund if needed",
    text: "Review a request and refund to the usable route supplied with the original payment.",
    icon: "03",
  },
];
export default async function Home() {
  const accountHref = await accountWorkspace();
  return (
    <main className="product-app public-surface nostos-home">
      <AppHeader accountHref={accountHref} />
      <div className="public-body">
        <section className="home-opening">
          <p className="eyebrow">SHIELDED PAYMENTS. PRIVATE REFUNDS.</p>
          <h1>
            Private payments.
            <br />
            <span>A way back.</span>
          </h1>
          <p className="home-lede">
            Accept shielded ZEC. Refund to the return route included with the
            original payment.
          </p>
          <div className="home-entry-actions">
            <Link className="primary" href={accountHref ?? "/sign-up"}>
              {accountHref ? "Open workspace" : "Accept ZEC payments"}
              <span aria-hidden="true">↗</span>
            </Link>
            <a className="secondary" href="#how-it-works">
              See how it works
            </a>
          </div>
          <p className="home-accountless">
            Customers pay without a NOSTOS account.
          </p>
        </section>
        <section className="home-product" aria-label="Example receipt">
          <div className="home-example-heading">
            <span>ONE PAYMENT. A PRIVATE RETURN PATH.</span>
            <small>Example receipt</small>
          </div>
          <div className="home-receipt-heading">
            <div className="home-document" aria-hidden="true">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
                <path d="M14 3v6h6M8 13h8M8 17h5" />
              </svg>
            </div>
            <div>
              <h2>Studio consultation</h2>
              <p>Payment and refund history, together.</p>
            </div>
            <div className="home-example-amount">
              <strong>0.08 ZEC</strong>
              <span>Example amount</span>
            </div>
          </div>
          <ol className="home-payment-steps">
            <li>
              <span aria-hidden="true">✓</span>
              <strong>PAY</strong>
              <small>Payment confirmed</small>
            </li>
            <li>
              <span aria-hidden="true">02</span>
              <strong>FULFILL</strong>
              <small>Merchant reported</small>
            </li>
            <li>
              <span aria-hidden="true">↶</span>
              <strong>REFUND IF NEEDED</strong>
              <small>Usable route required</small>
            </li>
          </ol>
          <div className="home-refund-route">
            <span aria-hidden="true">↶</span>
            <div>
              <strong>A return route travels with the payment.</strong>
              <p>
                When valid and usable, it lets the merchant refund later without
                asking for another address.
              </p>
            </div>
          </div>
          <p className="home-example-note">
            Illustrative receipt. No live payment or balance is shown.
          </p>
        </section>
        <section
          className="home-process"
          id="how-it-works"
          aria-labelledby="home-process-title"
        >
          <div className="home-section-intro">
            <p className="eyebrow">HOW NOSTOS WORKS</p>
            <h2 id="home-process-title">From payment to resolution.</h2>
          </div>
          <div className="home-process-grid">
            {steps.map((step) => (
              <article key={step.icon}>
                <span className="home-step-number">{step.icon}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section
          className="home-questions"
          aria-labelledby="home-questions-title"
        >
          <div className="home-section-intro">
            <p className="eyebrow">BEFORE YOU START</p>
            <h2 id="home-questions-title">A few useful details.</h2>
          </div>
          <div>
            <details>
              <summary>Does the customer need an account?</summary>
              <p>
                No. Customers open the payment link and pay using a compatible
                shielded Zcash wallet. Their private receipt tracks the payment
                and any refund request.
              </p>
            </details>
            <details>
              <summary>Can every payment be refunded?</summary>
              <p>
                A refund needs a valid, usable shielded return route, sufficient
                funds, and eligibility under the merchant's refund terms. A
                missing or invalid route is not refundable through NOSTOS.
              </p>
            </details>
            <details>
              <summary>Is fulfillment verified by NOSTOS?</summary>
              <p>
                Fulfillment is reported by the merchant. Payment confirmation
                and fulfillment are separate states.
              </p>
            </details>
          </div>
        </section>
        <section className="home-last-action">
          <h2>
            Keep the payment.
            <br />
            Keep a way back.
          </h2>
          <Link className="primary" href={accountHref ?? "/sign-up"}>
            {accountHref ? "Open workspace" : "Create your merchant account"}
          </Link>
        </section>
      </div>
      <AppFooter />
    </main>
  );
}
