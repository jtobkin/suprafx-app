import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SupraFX — Cross-Chain FX Settlement",
  description: "Institutional-grade cross-chain settlement across EVM and MoveVM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
