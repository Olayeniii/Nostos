"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { requestJson } from "./requests.js";
import { Mark } from "./mark.js";
import { NetworkLabel } from "./network-context.js";
import "./merchant-workspace.css";

function WorkspaceIcon({
  kind,
}: {
  kind: "overview" | "payments" | "refunds" | "funds" | "settings";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "overview" ? (
        <>
          <rect x="3" y="3" width="7" height="10" rx="2" />
          <rect x="14" y="3" width="7" height="6" rx="2" />
          <rect x="3" y="17" width="7" height="4" rx="1.5" />
          <rect x="14" y="13" width="7" height="8" rx="2" />
        </>
      ) : kind === "refunds" ? (
        <>
          <path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-3" />
        </>
      ) : kind === "payments" ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M3 9h18M7 15h3M16 14v3M14.5 15.5h3" />
        </>
      ) : kind === "funds" ? (
        <>
          <path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10H6a3 3 0 0 1-3-3V7" />
          <path d="M20 12h-5a2 2 0 0 0 0 4h5" />
          <circle cx="15" cy="14" r=".5" fill="currentColor" stroke="none" />
        </>
      ) : (
        <>
          <path d="M4 3v4m0 6v8M12 3v10m0 6v2M20 3v2m0 6v10" />
          <rect x="1.5" y="7" width="5" height="6" rx="2" />
          <rect x="9.5" y="13" width="5" height="6" rx="2" />
          <rect x="17.5" y="5" width="5" height="6" rx="2" />
        </>
      )}
    </svg>
  );
}
export function MerchantWorkspace({
  name = "Merchant workspace",
  detailOpen = false,
  onSignOut,
  onPaymentsHome,
  children,
}: {
  name?: string;
  detailOpen?: boolean;
  onSignOut?: () => Promise<void>;
  onPaymentsHome?: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    try {
      if (onSignOut) await onSignOut();
      else {
        await requestJson(
          "/api/product/logout",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          },
          15000,
        );
        window.location.assign("/sign-in");
      }
    } catch {
      setSignOutError("Could not sign out. Try again.");
    } finally {
      setSigningOut(false);
    }
  }
  const destinations = [
    { href: "/merchant/overview", kind: "overview", label: "Overview" },
    { href: "/merchant", kind: "payments", label: "Payments" },
    { href: "/merchant/refunds", kind: "refunds", label: "Refunds" },
    { href: "/merchant/funds", kind: "funds", label: "Funds" },
    { href: "/merchant/settings", kind: "settings", label: "Settings" },
  ] as const;
  return (
    <main
      className={`product-app dashboard-app merchant-studio ${detailOpen ? "detail-open" : ""}`}
    >
      <nav className="studio-rail" aria-label="Merchant workspace">
        <Link
          className="studio-mark"
          href="/merchant/overview"
          aria-label="NOSTOS overview"
        >
          <Mark />
        </Link>
        <div className="studio-destinations">
          {destinations.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={(event) => {
                if (
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey &&
                  item.href === "/merchant" &&
                  pathname === item.href &&
                  onPaymentsHome
                ) {
                  event.preventDefault();
                  onPaymentsHome();
                }
              }}
              aria-current={pathname === item.href ? "page" : undefined}
            >
              <WorkspaceIcon kind={item.kind} />
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>
      <div className="studio-body">
        <header className="studio-header">
          <div className="studio-identity">
            <Link href="/merchant/overview" className="studio-wordmark">
              NOSTOS
            </Link>
            <span>{name}</span>
          </div>
          <div className="studio-account">
            <span className="studio-network">
              <NetworkLabel />
            </span>
            <button
              className="text-button"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              {signingOut ? "Signing out" : "Sign out"}
            </button>
          </div>
        </header>
        <div className="studio-page">
          {signOutError && (
            <p role="alert" className="warning">
              {signOutError}
            </p>
          )}
          {children}
        </div>
      </div>
    </main>
  );
}
