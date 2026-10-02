import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "NOSTOS | A private way back",
  description: "Private refunds for shielded ZEC payments.",
};

export const viewport = { themeColor: "#0b1514" };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <div id="content">{children}</div>
      </body>
    </html>
  );
}
