"use client";
import { useState, useEffect } from "react";

interface VaultData {
  totalDeposited: number;
  committed: number;
  available: number;
  matchingLimit: number;
  totalEarmarked: number;
  availableCapacity: number;
  currency: string;
}

function parseVaultResponse(v: any, c: any): VaultData | null {
  // v is the /api/vault response: { balance: { totalDeposited, committed, available, matchingLimit, currency }, ... }
  // c is the /api/maker-capacity response: { totalDeposited, matchingLimit, totalEarmarked, availableCapacity, ... }
  const bal = v?.balance;

  // Try balance object first
  if (bal && (Number(bal.totalDeposited || bal.total_deposited || 0) > 0)) {
    const deposited = Number(bal.totalDeposited ?? bal.total_deposited ?? 0);
    return {
      totalDeposited: deposited,
      committed: Number(bal.committed ?? 0),
      available: Number(bal.available ?? 0),
      matchingLimit: Number(bal.matchingLimit ?? bal.matching_limit ?? 0),
      totalEarmarked: Number(c?.totalEarmarked ?? 0),
      availableCapacity: Number(c?.availableCapacity ?? bal.matchingLimit ?? bal.matching_limit ?? 0),
      currency: bal.currency || "USDC",
    };
  }

  // Fallback: try maker-capacity endpoint directly
  if (c && Number(c.totalDeposited || 0) > 0) {
    return {
      totalDeposited: Number(c.totalDeposited),
      committed: Number(c.committed ?? 0),
      available: Number(c.available ?? c.totalDeposited ?? 0),
      matchingLimit: Number(c.matchingLimit ?? 0),
      totalEarmarked: Number(c.totalEarmarked ?? 0),
      availableCapacity: Number(c.availableCapacity ?? c.matchingLimit ?? 0),
      currency: c.currency || "USDC",
    };
  }

  return null;
}

// Compact inline vault badge for quote rows
export function MakerVaultInline({ address }: { address: string }) {
  const [vault, setVault] = useState<VaultData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!address || address === "auto-maker-bot") { setLoaded(true); return; }
    Promise.all([
      fetch(`/api/vault?address=${encodeURIComponent(address)}`).then(r => r.json()).catch(() => null),
      fetch(`/api/maker-capacity?address=${encodeURIComponent(address)}`).then(r => r.json()).catch(() => null),
    ]).then(([v, c]) => {
      setVault(parseVaultResponse(v, c));
      setLoaded(true);
    });
  }, [address]);

  if (!loaded) return <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>...</span>;
  if (address === "auto-maker-bot") return <span className="mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--positive-dim)", color: "var(--positive)" }}>Bot</span>;
  if (!vault) return <span className="mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--negative-dim)", color: "var(--negative)" }}>No deposit</span>;

  return (
    <span className="inline-flex items-center gap-1 mono text-[10px] px-1.5 py-0.5 rounded"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
      <span style={{ color: "var(--positive)" }}>${vault.availableCapacity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
      <span style={{ color: "var(--t3)" }}>avail</span>
    </span>
  );
}

// Full vault detail panel for expanded views (counterparties, sidebar)
export function MakerVaultDetail({ address }: { address: string }) {
  const [vault, setVault] = useState<VaultData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!address || address === "auto-maker-bot") { setLoaded(true); return; }
    Promise.all([
      fetch(`/api/vault?address=${encodeURIComponent(address)}`).then(r => r.json()).catch(() => null),
      fetch(`/api/maker-capacity?address=${encodeURIComponent(address)}`).then(r => r.json()).catch(() => null),
    ]).then(([v, c]) => {
      setVault(parseVaultResponse(v, c));
      setLoaded(true);
    });
  }, [address]);

  if (!loaded) return <div className="text-[11px]" style={{ color: "var(--t3)" }}>Loading vault...</div>;
  if (address === "auto-maker-bot") return <div className="text-[11px]" style={{ color: "var(--positive)" }}>SupraFX Bot - always funded</div>;
  if (!vault) return <div className="text-[11px]" style={{ color: "var(--negative)" }}>No security deposit</div>;

  const inUse = vault.committed + vault.totalEarmarked;
  const usedPct = vault.totalDeposited > 0 ? (inUse / vault.totalDeposited) * 100 : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        {[
          { label: "Deposited", value: vault.totalDeposited, color: "var(--t0)" },
          { label: "In Use", value: inUse, color: "var(--warn)" },
          { label: "Available", value: vault.availableCapacity, color: "var(--positive)" },
          { label: "Match Limit", value: vault.matchingLimit, color: "var(--t2)" },
        ].map(item => (
          <div key={item.label} className="text-center">
            <div className="mono text-[12px] font-semibold" style={{ color: item.color }}>
              ${Number(item.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>{item.label}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, usedPct)}%`, background: usedPct > 80 ? "var(--negative)" : usedPct > 50 ? "var(--warn)" : "var(--accent)" }} />
        </div>
        <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>{usedPct.toFixed(0)}% used</span>
      </div>
    </div>
  );
}
