"use client";
import { Trade, Agent, RFQ } from "@/lib/types";

function fmtUsd(n: number) {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function KPIs({ trades, agents, rfqs }: { trades: Trade[]; agents: Agent[]; rfqs: RFQ[] }) {
  const done = trades.filter(t => t.status === "settled");
  const avg = done.length ? done.reduce((s, t) => s + (t.settle_ms || 0) / 1000, 0) / done.length : 0;
  const vol = done.reduce((s, t) => s + t.size * t.rate, 0);
  const openRfqs = rfqs.filter(r => r.status === "open").length;

  const items = [
    { label: "Agents", value: String(agents.length), color: "var(--t1)" },
    { label: "Open RFQs", value: String(openRfqs), color: "var(--t1)" },
    { label: "Trades Settled", value: String(done.length), color: "var(--positive)" },
    { label: "Avg Settlement", value: avg.toFixed(1) + "s", color: "var(--t1)" },
    { label: "Volume", value: fmtUsd(vol), color: "var(--t1)" },
    { label: "ETH/USDC Mid", value: "2,500.00", color: "var(--t1)" },
  ];

  return (
    <div className="grid grid-cols-6 border rounded-md overflow-hidden mb-5 animate-in"
      style={{ borderColor: "var(--border)", gap: "1px", background: "var(--border)" }}>
      {items.map(i => (
        <div key={i.label} className="px-4 py-3.5" style={{ background: "var(--surface)" }}>
          <div className="font-sans text-[10px] font-medium uppercase tracking-wider mb-1.5"
            style={{ color: "var(--t3)" }}>{i.label}</div>
          <div className="font-mono text-lg font-semibold tracking-tight" style={{ color: i.color }}>
            {i.value}
          </div>
        </div>
      ))}
    </div>
  );
}
