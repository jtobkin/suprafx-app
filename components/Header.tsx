"use client";
import { useState, useEffect, useRef } from "react";
import { useWallet } from "./WalletProvider";

function SupraFXLogo({ scale = 1, scrollProgress = 0 }: { scale?: number; scrollProgress?: number }) {
  // 3F Exchange Bars: F descends left (blue), X ascends right (amber)
  // Both sides animate outward on scroll
  const fBaseWidths = [16, 11, 6];
  const fMaxWidths = [22, 16, 10];
  const xBaseWidths = [6, 11, 16];
  const xMaxWidths = [10, 16, 22];
  const fColors = ["var(--accent)", "var(--accent-light)", "var(--accent)"];
  const xOpacities = [0.3, 0.6, 1];

  return (
    <div className="flex items-center gap-2" style={{ transform: `scale(${scale})`, transformOrigin: "left center", transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}>
      <div style={{ position: "relative", width: 30, height: 22 }}>
        {/* F bars — descend from left */}
        {fBaseWidths.map((base, i) => {
          const max = fMaxWidths[i];
          const width = base + (max - base) * scrollProgress;
          return (
            <div key={`f${i}`} style={{
              position: "absolute",
              top: i * 9,
              left: 0,
              height: 3,
              width,
              background: fColors[i],
              transition: `width 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.05}s`,
            }} />
          );
        })}
        {/* X bars — ascend from right */}
        {xBaseWidths.map((base, i) => {
          const max = xMaxWidths[i];
          const width = base + (max - base) * scrollProgress;
          return (
            <div key={`x${i}`} style={{
              position: "absolute",
              top: i * 9,
              right: 0,
              height: 3,
              width,
              background: "var(--warn)",
              opacity: xOpacities[i],
              transition: `width 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.05}s`,
            }} />
          );
        })}
      </div>
      <a href="/" style={{ textDecoration: "none", display: "flex", alignItems: "baseline", gap: 0 }}>
        <span className="text-[13px] font-bold uppercase" style={{
          color: "var(--t0)",
          letterSpacing: "3px",
          fontFamily: "'IBM Plex Sans', sans-serif",
        }}>SUPRA</span>
        <span className="text-[13px] font-bold uppercase" style={{
          color: "var(--accent-light)",
          letterSpacing: "3px",
          fontFamily: "'IBM Plex Sans', sans-serif",
        }}>FX</span>
      </a>
    </div>
  );
}

export { SupraFXLogo };

export default function Header({ onProfileClick, activePage = "rfq" }: { onProfileClick: () => void; activePage?: string }) {
  const { supraShort, isDemo, isVerified } = useWallet();
  const [scrollProgress, setScrollProgress] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        // 0 at top, 1 at 300px scroll
        const progress = Math.min(1, window.scrollY / 300);
        setScrollProgress(progress);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Logo scales from 1.0 to 1.15 as you scroll
  const logoScale = 1 + scrollProgress * 0.15;

  const navItems = [
    { key: "rfq", label: "My RFQs", href: "/" },
    { key: "orderbook", label: "Orderbook", href: "/orderbook" },
    { key: "counterparties", label: "Counterparties", href: "/counterparties" },
  ];

  return (
    <header className="flex items-center justify-between px-4 sticky top-0 z-40 glass-strong"
      style={{ height: 38, borderBottom: "1px solid var(--border)" }}>
      <div className="flex items-center gap-3" style={{ width: 200 }}>
        <SupraFXLogo scale={logoScale} scrollProgress={scrollProgress} />
        <span className="mono text-[8px] font-semibold uppercase" style={{
          color: isDemo ? "var(--warn)" : "var(--positive)",
          letterSpacing: "1px",
          marginLeft: 12,
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
