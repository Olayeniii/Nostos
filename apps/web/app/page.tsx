import Link from "next/link";
import { AppHeader, AppFooter } from "../src/shell.js";
export default function Home() {
  return (
    <main className="product-app">
      <AppHeader />
      <section className="product-home">
        <p className="eyebrow">SHIELDED PAYMENTS. PRIVATE REFUNDS.</p>
        <h1>
          Private Zcash payments
          <br />
          that can be refunded.
        </h1>
        <p className="lede">
          The return route travels with the payment, encrypted in its memo. When
          a refund is due, you already know where to send it.
        </p>
        <div className="home-actions">
          <Link className="primary" href="/sign-up">
            Accept ZEC payments
          </Link>
          <Link className="secondary" href="/sign-in">
            Sign in
          </Link>
        </div>
        <div className="product-steps">
          <article>
            <span>01</span>
            <h2>Create a payment request</h2>
            <p>
              Share a private link with the amount and what the payment is for.
            </p>
          </article>
          <article>
            <span>02</span>
            <h2>Customer pays shielded ZEC</h2>
            <p>
              The payment memo carries an encrypted, fresh refund destination.
            </p>
          </article>
          <article>
            <span>03</span>
            <h2>Refund from your workspace</h2>
            <p>Use the recovered return route. No address request afterward.</p>
          </article>
        </div>
        <p className="home-note">
          Built for Zcash testnet. Customers pay using a wallet that supports
          shielded testnet payments and memos.
        </p>
      </section>
      <AppFooter />
    </main>
  );
}
