import { NetworkProvider } from "../src/network-context.js";
import type { Metadata } from "next";
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

export const metadata: Metadata = {
  metadataBase: new URL("https://nostos.iyforge.xyz"),
  title: {
    default: "NOSTOS | Private Zcash payments",
    template: "%s | NOSTOS",
  },
  description:
    "Accept shielded Zcash payments. Refund later using the return route supplied with the original payment.",
  openGraph: {
    type: "website",
    siteName: "NOSTOS",
    title: "Private payments. A way back.",
    description:
      "Shielded Zcash payments with a refund route supplied in the original payment.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "NOSTOS. Private payments. A way back.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "NOSTOS | Private payments. A way back.",
    images: ["/opengraph-image"],
  },
  robots: { index: false, follow: false },
};

export const viewport = { themeColor: "#0b1514" };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${mono.variable}`}>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <NetworkProvider>
          <div id="content">{children}</div>
        </NetworkProvider>
      </body>
    </html>
  );
}
