"use client";
import { useWallet } from "./WalletProvider";

const tabs = ["overview", "orderbook", "blotter", "committee"] as const;
type Tab = typeof tabs[number];

export default function Header({ active, onTab, onProfileClick }: { active: Tab; onTab: (t: Tab) => void; onProfileClick: () => void }) {
  const { supraShort, evmShort, isDemo, isVerified, profile } = useWallet();

  return (
    <header className="h-11 flex items-center justify-between px-5 border-b sticky top-0 z-40"
      style={{ borderColor: "var(--border)", background: "rgba(6,6,10,0.92)", backdropFilter: "blur(12px)" }}>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-sm" style={{ background: "var(--accent)" }} />
          <span className="font-mono text-[13px] font-semibold tracking-tight" style={{ color: "var(--t0)" }}>SupraFX</span>
        </div>
        <div className="h-3.5 w-px" style={{ background: "var(--border)" }} />
        <span className="font-mono text-[13px] uppercase tracking-[1.5px]" style={{ color: "var(--t3)" }}>
          {isDemo ? "Demo" : "Testnet"}
        </span>
      </div>

      <div className="flex h-full">
        {tabs.map(t => (
          <button key={t} onClick={() => onTab(t)}
            className="relative px-4 h-full text-[13px] font-medium tracking-wide transition-colors"
            style={{ color: active === t ? "var(--t0)" : "var(--t3)", background: "none", border: "none" }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {active === t && <div className="absolute bottom-0 left-4 right-4 h-[1.5px] rounded-full" style={{ background: "var(--accent)" }} />}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <div className="w-1 h-1 rounded-full animate-pulse-dot" style={{ background: "var(--positive)" }} />
          <span className="font-mono text-[13px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>
            {isDemo ? "Demo" : "Live"}
          </span>
        </div>

        {/* Profile button */}
        <button onClick={onProfileClick}
          className="flex items-center gap-2 px-2.5 py-1 rounded transition-all hover:brightness-110"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
          {/* Status dots */}
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--positive)" }} title="Supra verified" />
            <div className="w-1.5 h-1.5 rounded-full"
              style={{ background: isVerified ? "var(--positive)" : "var(--warn)" }}
              title={isVerified ? "EVM verified" : "EVM not linked"} />
          </div>
          <span className="font-mono text-[14px]" style={{ color: "var(--t1)" }}>
            {supraShort}
          </span>
        </button>
      </div>
    </header>
  );
}
