import type { CSSProperties } from "react";
export function OverviewIcon({
  kind,
  className = "",
  style,
}: {
  kind:
    | "receipt"
    | "clock"
    | "attention"
    | "package"
    | "return"
    | "check"
    | "bag";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "receipt" ? (
        <>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
          <path d="M14 3v6h6M8 13h8M8 17h5" />
        </>
      ) : kind === "clock" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      ) : kind === "attention" ? (
        <>
          <path d="m10.3 4.5-8 14A1.7 1.7 0 0 0 3.8 21h16.4a1.7 1.7 0 0 0 1.5-2.5l-8-14a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v5M12 17h.01" />
        </>
      ) : kind === "package" ? (
        <>
          <path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5" />
        </>
      ) : kind === "return" ? (
        <path d="M4 5v6h6M4 11a8 8 0 1 1 1 7" />
      ) : kind === "check" ? (
        <path d="m5 12 4 4L19 6" />
      ) : (
        <>
          <path d="M5 8h14l2 13H3L5 8Z" />
          <path d="M8 8V6a4 4 0 0 1 8 0v2" />
        </>
      )}
    </svg>
  );
}
