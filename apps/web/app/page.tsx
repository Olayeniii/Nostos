import { Mark } from "../src/mark.js";
import Link from "next/link";
import { AppHeader, AppFooter } from "../src/shell.js";
import { accountWorkspace } from "../src/account-workspace.server.js";
export default async function Home() {
  const accountHref = await accountWorkspace();
  return (
    <main className="product-app">
      <AppHeader accountHref={accountHref} />
      <section className="product-home">
        <div className="home-hero">
          <div className="home-intro">
            <p className="eyebrow">SHIELDED PAYMENTS. PRIVATE REFUNDS.</p>
            <h1>
              Private payments.
              <br />
              <span>A way back.</span>
            </h1>
            <p className="lede">
              Pay privately. The merchant fulfills your order. If something goes
              wrong, refund privately using the route supplied with the original
              payment.
            </p>
            <div className="home-actions">
              <Link className="primary" href={accountHref ?? "/sign-up"}>
                Accept ZEC payments
              </Link>
              <Link className="secondary" href={accountHref ?? "/sign-in"}>
                {accountHref ? "Open workspace" : "Sign in"}
              </Link>
            </div>
          </div>
          <aside className="home-route-card" aria-label="How a refund returns">
            <div className="route-card-head">
              <Mark />
              <span>PAY, FULFILL, REFUND</span>
            </div>
            <div className="route-card-step">
              <span className="route-dot" />
              <div>
                <small>Customer</small>
                <h2>Pay shielded.</h2>
                <p>Include a refund route in the payment memo.</p>
              </div>
            </div>
            <div className="route-card-step">
              <span className="route-dot" />
              <div>
                <small>Merchant</small>
                <h2>Fulfill. Refund if needed.</h2>
                <p>Approve a request. Send to the supplied route.</p>
              </div>
            </div>
            <div className="route-card-note">
              One payment. One private receipt.
              <br />A shielded return path.
            </div>
          </aside>
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
              The shielded payment memo carries the refund route supplied for
              that payment.
            </p>
          </article>
          <article>
            <span>03</span>
            <h2>Review and refund</h2>
            <p>
              Customers can request a refund from their receipt. You review the
              amount and give a decision.
            </p>
          </article>
        </div>
        <p className="home-note">
          Customers pay using a wallet that supports shielded Zcash payments and
          memos on the network displayed above.
        </p>
      </section>
      <AppFooter />
    </main>
  );
}
