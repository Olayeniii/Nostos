import { NetworkLabel, NetworkNotice } from "./network-context.js";
import Link from "next/link";
import { Mark } from "./mark.js";

export function AppHeader({
  role,
  accountHref,
}: {
  role?: "Merchant" | "Customer";
  accountHref?: string;
}) {
  return (
    <header className="app-header">
      <Link className="brand" href="/" aria-label="NOSTOS home">
        <Mark />
        <span>NOSTOS</span>
      </Link>
      <div className="header-context">
        {role && <span>{role}</span>}
        {!role && (
          <Link className="header-sign-in" href={accountHref ?? "/sign-in"}>
            {accountHref ? "Open workspace" : "Sign in"}
          </Link>
        )}
        <span className="network">
          <NetworkLabel />
        </span>
      </div>
    </header>
  );
}
export function AppFooter() {
  return (
    <footer>
      <span>
        <NetworkNotice />
      </span>
      <p>
        Shielded transactions protect on-chain details. The merchant and NOSTOS
        can see the information needed to process your payment and refund.
      </p>
    </footer>
  );
}
