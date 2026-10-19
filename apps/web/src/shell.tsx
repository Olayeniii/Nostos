import { NetworkLabel, NetworkNotice } from "./network-context.js";
import Link from "next/link";
import { Mark } from "./mark.js";

export function AppHeader({ role }: { role?: "Merchant" | "Customer" }) {
  return (
    <header>
      <Link className="brand" href="/" aria-label="NOSTOS home">
        <Mark />
        <span>NOSTOS</span>
      </Link>
      <div className="header-context">
        {role && <span>{role}</span>}
        {!role && <Link href="/sign-in">Sign in</Link>}
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
        Shielded transactions protect on-chain details. The merchant and service
        operator can see the information needed to process your payment and
        refund.
      </p>
    </footer>
  );
}
