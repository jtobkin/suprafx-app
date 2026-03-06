"use client";
import { useState, useEffect, useRef } from "react";
import { useWallet } from "./WalletProvider";

export default function Header({ onProfileClick, activePage = "rfq" }: { onProfileClick: () => void; activePage?: string }) {
  const { supraShort, isDemo, isVerified } = useWallet();
  const [scrolling, setScrolling] = useState(false);
  const scrollTimer = useRef<any>(null);

  useEffect(() => {
    const onScroll = () => {
      setScrolling(true);
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => setScrolling(false), 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navItems = [
    { key: "rfq", label: "My RFQs", href: "/" },
    { key: "orderbook", label: "Orderbook", href: "/orderbook" },
    { key: "counterparties", label: "Counterparties", href: "/counterparties" },
  ];

  return (
    <header className="h-12 flex items-center justify-between px-5 sticky top-0 z-40 glass-strong">
      {/* Left: logo */}
      <div className="flex items-center gap-2.5" style={{ width: "180px" }}>
        <div className="relative" style={{ transform: scrolling ? "scale(1.2)" : "scale(1)", transition: "transform 0.25s ease" }}>
          <div className="w-2.5 h-2.5 rounded-sm rotate-45" style={{ background: "var(--accent)" }} />
          <div className="absolute inset-0 w-2.5 h-2.5 rounded-sm rotate-45 animate-pulse-dot" style={{ background: "var(--accent)", opacity: 0.4 }} />
        </div>
        <a href="/" style={{ textDecoration: "none", transform: scrolling ? "scale(1.2)" : "scale(1)", transition: "transform 0.25s ease", transformOrigin: "left center", display: "inline-block" }}>
          <span className="mono text-[14px] font-bold tracking-tight" style={{ color: "var(--t0)" }}>SupraFX</span>
          <span className="mono text-[9px] block" style={{ color: "var(--t3)", marginTop: "-2px" }}>{(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7)}</span>
        </a>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full"
          style={{ background: isDemo ? "var(--warn-dim)" : "var(--positive-dim)" }}>
          <div className="w-1 h-1 rounded-full animate-pulse-dot"
            style={{ background: isDemo ? "var(--warn)" : "var(--positive)" }} />
          <span className="mono text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: isDemo ? "var(--warn)" : "var(--positive)" }}>
            {isDemo ? "Demo" : "Testnet"}
          </span>
        </div>
      </div>

      {/* Center: navigation */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-6">
        {navItems.map(item => (
          <a key={item.key} href={item.href}
            className="px-3 py-1.5 rounded text-[12px] font-medium transition-colors"
            style={{
              color: activePage === item.key ? "var(--t0)" : "var(--t3)",
              background: activePage === item.key ? "var(--surface-2)" : "transparent",
              textDecoration: "none",
            }}>
            {item.label}
          </a>
        ))}
      </div>

      {/* Right: profile */}
      <button onClick={onProfileClick} data-profile-trigger
        className="flex items-center gap-2 px-3 py-1.5 rounded-md transition-all hover:brightness-110"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--positive)" }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: isVerified ? "var(--positive)" : "var(--warn)" }} />
        </div>
        <span className="mono text-[12px] font-medium" style={{ color: "var(--t1)" }}>{supraShort}</span>
      </button>
    </header>
  );
}
