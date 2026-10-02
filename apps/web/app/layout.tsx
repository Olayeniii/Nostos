import type { ReactNode } from "react";
import "./globals.css";
import localFont from "next/font/local";
const manrope = localFont({
  src: "../public/fonts/manrope.ttf",
  variable: "--font-manrope",
  display: "swap",
  weight: "200 800",
});
const mono = localFont({
  src: "../public/fonts/plex-mono.ttf",
  variable: "--font-mono",
  display: "swap",
  weight: "400",
});

export const metadata = {
  title: "NOSTOS | Private Zcash payments",
  description: "Private refunds for shielded ZEC payments.",
};

export const viewport = { themeColor: "#0b1514" };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${mono.variable}`}>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <div id="content">{children}</div>
      </body>
    </html>
  );
}
