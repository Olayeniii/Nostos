import Link from "next/link";
import { AppHeader, AppFooter } from "../src/shell.js";

export default function Home() {
  return (
    <main>
      <AppHeader />
      <section className="intro product-entry">
        <p className="eyebrow">Private refunds for shielded ZEC payments</p>
        <h1>A private way back.</h1>
        <p className="lede">
          A private refund route travels with the payment. When a refund is due,
          the merchant can send it without asking for another address.
        </p>
        <div className="entry-actions">
          <Link className="primary" href="/merchant">
            Open merchant workspace
          </Link>
          <Link className="text-button" href="/receipt">
            View your receipt
          </Link>
        </div>
        <p className="privacy">
          Shielded payment. Encrypted return route. Shielded refund.
        </p>
      </section>
      <AppFooter />
    </main>
  );
}
