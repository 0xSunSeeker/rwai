import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RWAI — Autonomous RWA Yield Agent on Mantle",
  description:
    "RWAI monitors USDY and mETH yield spreads on Mantle, explains changes in plain English, and proposes rebalances via Telegram. Built on Mantle.",
  openGraph: {
    title: "RWAI — Autonomous RWA Yield Agent on Mantle",
    description:
      "Plain-English yield intelligence for USDY and mETH holders. Powered by Claude. Built on Mantle.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
