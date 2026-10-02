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
        <span className="network">Zcash testnet</span>
      </div>
    </header>
  );
}
export function AppFooter() {
  return (
    <footer>
      <span>Testnet only. No real funds.</span>
      <p>
        Shielded transactions protect on-chain details. The merchant and service
        operator can see the information needed to process your payment and
        refund.
      </p>
    </footer>
  );
}
