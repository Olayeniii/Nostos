import type { ReactNode } from "react";
export function SettingsIcon({
  kind,
}: {
  kind: "store" | "copy" | "chevron" | "sync" | "info" | "lock";
}) {
  const shapes: Record<typeof kind, ReactNode> = {
    store: (
      <>
        <path d="M3 10V6l2-3h14l2 3v4M4 10v10h16V10M3 8c0 4 5 4 5 0 0 4 8 4 8 0 0 4 5 4 5 0M9 20v-6h6v6" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="3" width="12" height="15" rx="2" />
        <path d="M16 21H5a2 2 0 0 1-2-2V8" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    sync: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M19 16a8 8 0 0 1-13 3l-2-3" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
  };
  return (
    <svg
      className="settings-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[kind]}
    </svg>
  );
}
