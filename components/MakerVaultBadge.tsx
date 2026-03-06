"use client";
import { useState, useEffect } from "react";

interface VaultData {
  total_deposited: number;
  committed: number;
  available: number;
  matching_limit: number;
  totalEarmarked: number;
  availableCapacity: number;
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
      if (v?.balance) {
        setVault({
          total_deposited: Number(v.balance.total_deposited || 0),
          committed: Number(v.balance.committed || 0),
          available: Number(v.balance.available || 0),
          matching_limit: Number(v.balance.matching_limit || 0),
          totalEarmarked: c?.totalEarmarked ?? 0,
          availableCapacity: c?.availableCapacity ?? Number(v.balance.matching_limit || 0),
        });
      }
      setLoaded(true);
    });
  }, [address]);

  if (!loaded) return <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>...</span>;
  if (address === "auto-maker-bot") return <span className="mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--positive-dim)", color: "var(--positive)" }}>Bot</span>;
  if (!vault || vault.total_deposited === 0) return <span className="mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--negative-dim)", color: "var(--negative)" }}>No deposit</span>;

  const usedPct = vault.total_deposited > 0 ? ((vault.committed + vault.totalEarmarked) / vault.total_deposited) * 100 : 0;

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
      if (v?.balance) {
        setVault({
          total_deposited: Number(v.balance.total_deposited || 0),
          committed: Number(v.balance.committed || 0),
          available: Number(v.balance.available || 0),
          matching_limit: Number(v.balance.matching_limit || 0),
          totalEarmarked: c?.totalEarmarked ?? 0,
          availableCapacity: c?.availableCapacity ?? Number(v.balance.matching_limit || 0),
        });
      }
      setLoaded(true);
    });
  }, [address]);

  if (!loaded) return <div className="text-[11px]" style={{ color: "var(--t3)" }}>Loading vault...</div>;
  if (address === "auto-maker-bot") return <div className="text-[11px]" style={{ color: "var(--positive)" }}>SupraFX Bot - always funded</div>;
  if (!vault || vault.total_deposited === 0) return <div className="text-[11px]" style={{ color: "var(--negative)" }}>No security deposit</div>;

  const usedPct = vault.total_deposited > 0 ? ((vault.committed + vault.totalEarmarked) / vault.total_deposited) * 100 : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        {[
          { label: "Deposited", value: vault.total_deposited, color: "var(--t0)" },
          { label: "Committed", value: vault.committed, color: "var(--warn)" },
          { label: "Earmarked", value: vault.totalEarmarked, color: "var(--accent-light)" },
          { label: "Available", value: vault.availableCapacity, color: "var(--positive)" },
          { label: "Match Limit", value: vault.matching_limit, color: "var(--t2)" },
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
