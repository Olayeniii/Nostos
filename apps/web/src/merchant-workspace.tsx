"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { Mark } from "./mark.js";
import { NetworkLabel } from "./network-context.js";
import "./merchant-workspace.css";

function WorkspaceIcon({ kind }: { kind: "payments" | "funds" | "settings" }) {
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
      {kind === "payments" ? (
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
  name,
  detailOpen,
  onSignOut,
  children,
}: {
  name: string;
  detailOpen: boolean;
  onSignOut: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <main
      className={`product-app dashboard-app merchant-studio ${detailOpen ? "detail-open" : ""}`}
    >
      <nav className="studio-rail" aria-label="Merchant workspace">
        <Link className="studio-mark" href="/" aria-label="NOSTOS home">
          <Mark />
        </Link>
        <div className="studio-destinations">
          <Link href="/merchant" aria-current="page">
            <WorkspaceIcon kind="payments" />
            <span>Payments</span>
          </Link>
          <Link href="/merchant/funds">
            <WorkspaceIcon kind="funds" />
            <span>Funds</span>
          </Link>
        </div>
        <div className="studio-rail-bottom">
          <Link href="/merchant/settings">
            <WorkspaceIcon kind="settings" />
            <span>Settings</span>
          </Link>
          <button onClick={() => void onSignOut()}>Sign out</button>
        </div>
      </nav>
      <div className="studio-body">
        <header className="studio-header">
          <div className="studio-identity">
            <Link href="/" className="studio-wordmark">
              NOSTOS
            </Link>
            <span>{name}</span>
          </div>
          <span className="studio-network">
            <NetworkLabel />
          </span>
        </header>
        <div className="studio-page">{children}</div>
      </div>
    </main>
  );
}
