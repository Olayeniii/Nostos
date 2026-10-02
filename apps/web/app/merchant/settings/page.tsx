import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validSession } from "../../../src/session.js";
import { AppHeader, AppFooter } from "../../../src/shell.js";
export const dynamic = "force-dynamic";
export default async function Settings() {
  const jar = await cookies();
  if (
    !validSession(
      new Request("https://nostos.invalid", {
        headers: { cookie: jar.toString() },
      }),
    )
  )
    redirect("/sign-in");
  return (
    <main>
      <AppHeader role="Merchant" />
      <nav className="workspace-nav" aria-label="Merchant pages">
        <a href="/merchant">Payments</a>
        <a href="/merchant/settings" aria-current="page">
          Settings
        </a>
      </nav>
      <section className="workspace-intro">
        <h1>Settings</h1>
        <p className="lede">Your payment service and access settings.</p>
      </section>
      <section className="settings-panel">
        <h2>Payment service</h2>
        <dl>
          <div>
            <dt>Network</dt>
            <dd>Zcash testnet</dd>
          </div>
          <div>
            <dt>Wallet connection</dt>
            <dd>Managed by the service</dd>
          </div>
          <div>
            <dt>Refund route</dt>
            <dd>Recovered from the payment memo</dd>
          </div>
          <div>
            <dt>Customer receipts</dt>
            <dd>Private links for individual payments</dd>
          </div>
        </dl>
        <p className="privacy">
          Wallet credentials stay on the server. Connection changes are managed
          by the operator.
        </p>
      </section>
      <AppFooter />
    </main>
  );
}
