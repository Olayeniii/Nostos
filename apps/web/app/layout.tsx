import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "NOSTOS | A private way back",
  description: "Private refunds for shielded ZEC payments.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
