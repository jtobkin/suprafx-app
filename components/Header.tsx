"use client";
import { useWallet } from "./WalletProvider";

export default function Header({ onProfileClick }: { onProfileClick: () => void }) {
  const { supraShort, isDemo, isVerified } = useWallet();

  return (
    <header className="h-12 flex items-center justify-between px-5 border-b sticky top-0 z-40 glass-strong">
      {/* Left: spacer to balance */}
      <div style={{ width: "140px" }} />

      {/* Center: logo + testnet badge */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div className="w-2.5 h-2.5 rounded-sm rotate-45" style={{ background: "var(--accent)" }} />
            <div className="absolute inset-0 w-2.5 h-2.5 rounded-sm rotate-45 animate-pulse-dot" style={{ background: "var(--accent)", opacity: 0.4 }} />
          </div>
          <span className="mono text-[14px] font-bold tracking-tight" style={{ color: "var(--t0)" }}>SupraFX</span>
        </div>
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

      {/* Right: profile */}
      <button onClick={onProfileClick}
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
