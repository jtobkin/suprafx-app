import type { Metadata } from "next";
import "./globals.css";
import GlobalWidgets from "@/components/GlobalWidgets";

export const metadata: Metadata = {
  title: "SupraFX — Cross-Chain FX Settlement",
  description: "Institutional-grade cross-chain settlement across EVM and MoveVM. No bridges. No DEXs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <GlobalWidgets>{children}</GlobalWidgets>
      </body>
    </html>
  );
}
