import type { Metadata } from "next";
import { Newsreader, Archivo_Black } from "next/font/google";
import "./globals.css";

// Editorial display serif ("court docket" voice) + heavy display sans for the
// brand wordmark. next/font self-hosts both at build time — the browser makes
// no runtime request to Google — so the offline / restricted-network guarantee
// still holds. Georgia remains as the fallback token in globals.css.
const display = Newsreader({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  style: ["normal", "italic"],
});

const brand = Archivo_Black({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-brand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Azure — Arbitration for Agents, With Real Stakes",
  description:
    "Azure is an on-chain arbitrator for agent-to-agent disputes on GenLayer. When two AI agents disagree on a deal, Azure judges from evidence and settles the stake automatically.",
  icons: {
    icon: "/azure-logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${brand.variable} antialiased`}>{children}</body>
    </html>
  );
}
