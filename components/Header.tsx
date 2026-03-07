"use client";
import { useWallet } from "./WalletProvider";

export default function Header({ onProfileClick, activePage = "rfq" }: { onProfileClick: () => void; activePage?: string }) {
  const { supraShort, isDemo, isVerified } = useWallet();

  const navItems = [
    { key: "rfq", label: "My RFQs", href: "/" },
    { key: "orderbook", label: "Orderbook", href: "/orderbook" },
    { key: "counterparties", label: "Counterparties", href: "/counterparties" },
  ];

  return (
    <header className="flex items-center justify-between px-4 sticky top-0 z-40 glass-strong"
      style={{ height: 38, borderBottom: "1px solid var(--border)" }}>
      <div className="flex items-center gap-3" style={{ width: 180 }}>
        <div className="w-2 h-2" style={{ background: "var(--accent)" }} />
        <a href="/" style={{ textDecoration: "none" }}>
          <span className="mono text-[13px] font-bold" style={{ color: "var(--t0)", letterSpacing: "2px" }}>SUPRAFX</span>
        </a>
        <span className="mono text-[8px] font-semibold uppercase" style={{
          color: isDemo ? "var(--warn)" : "var(--positive)",
          letterSpacing: "1px",
        }}>
          {isDemo ? "DEMO" : "TESTNET"}
        </span>
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 flex items-center h-full">
        {navItems.map(item => (
          <a key={item.key} href={item.href}
            className="flex items-center h-full px-4 text-[11px] font-semibold uppercase transition-colors"
            style={{
              color: activePage === item.key ? "var(--t0)" : "var(--t3)",
              borderBottom: activePage === item.key ? "2px solid var(--accent)" : "2px solid transparent",
              textDecoration: "none",
              letterSpacing: "0.5px",
            }}>
            {item.label}
          </a>
        ))}
      </div>

      <button onClick={onProfileClick} data-profile-trigger
        className="flex items-center gap-2 px-3 transition-all hover:brightness-110"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)", height: 26 }}>
        <div className="flex items-center gap-1">
          <div className="w-1 h-1" style={{ background: "var(--positive)" }} />
          <div className="w-1 h-1" style={{ background: isVerified ? "var(--positive)" : "var(--warn)" }} />
        </div>
        <span className="mono text-[10px] font-medium" style={{ color: "var(--t2)" }}>{supraShort}</span>
      </button>
    </header>
  );
}
