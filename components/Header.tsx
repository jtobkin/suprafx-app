"use client";
import { useWallet } from "./WalletProvider";

const tabs = ["overview", "orderbook", "blotter", "committee"] as const;
type Tab = typeof tabs[number];

export default function Header({ active, onTab }: { active: Tab; onTab: (t: Tab) => void }) {
  const { address, disconnect, short } = useWallet();

  return (
    <header className="h-12 flex items-center justify-between px-5 border-b sticky top-0 z-50"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-[6px] h-[6px] rounded-[1px]" style={{ background: "var(--accent)" }} />
          <span className="font-mono font-semibold text-sm tracking-tight">SupraFX</span>
        </div>
        <div className="w-px h-5" style={{ background: "var(--border)" }} />
        <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--t3)" }}>
          {address?.startsWith("demo") ? "Demo" : "Testnet"}
        </span>
      </div>

      <div className="flex">
        {tabs.map(t => (
          <button key={t} onClick={() => onTab(t)}
            className="px-4 py-3.5 text-xs font-medium border-b-2 transition-colors"
            style={{
              color: active === t ? "var(--t0)" : "var(--t2)",
              borderColor: active === t ? "var(--accent)" : "transparent",
              background: "none",
            }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 font-mono text-[11px]" style={{ color: "var(--t2)" }}>
          <div className="w-[5px] h-[5px] rounded-full" style={{ background: "var(--positive)" }} />
          Connected
        </div>
        <button onClick={disconnect}
          className="px-3 py-1.5 font-mono text-[11px] rounded border transition-colors"
          style={{ color: "var(--t1)", background: "var(--surface-2)", borderColor: "var(--border)" }}>
          {short}
        </button>
      </div>
    </header>
  );
}
