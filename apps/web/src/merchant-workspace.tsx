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
      strokeWidth="1.5"
      aria-hidden="true"
    >
      {kind === "overview" ? (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
      ) : kind === "refunds" ? (
        <>
          <path d="M5 8h9a6 6 0 0 1 0 12h-3M5 8l4-4M5 8l4 4" />
        </>
      ) : kind === "payments" ? (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18M7 15h4" />
        </>
      ) : kind === "funds" ? (
        <>
          <ellipse cx="12" cy="6" rx="8" ry="3" />
          <path d="M4 6v6c0 4 16 4 16 0V6M4 12v6c0 4 16 4 16 0v-6" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 3 3-1 1-3 3-1 2-3-2-2 1-3-3-2-3 1-2-3Z" />
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
