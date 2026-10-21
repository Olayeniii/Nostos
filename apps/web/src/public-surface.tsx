import type { ReactNode } from "react";
import { AppHeader, AppFooter } from "./shell.js";
import "./public-surface.css";
export function PublicSurface({
  children,
  role,
  variant,
}: {
  children: ReactNode;
  role?: "Merchant" | "Customer";
  variant: "checkout" | "receipt" | "account" | "help" | "setup";
}) {
  return (
    <main className={`product-app public-surface public-${variant}`}>
      <AppHeader role={role} />
      <div className="public-body">{children}</div>
      <AppFooter />
    </main>
  );
}
