"use client";
import { Trade, Agent, RFQ } from "@/lib/types";

function fmt(n: number, d: number = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default function KPIs({ trades, agents, rfqs }: { trades: Trade[]; agents: Agent[]; rfqs: RFQ[] }) {
  const done = trades.filter(t => t.status === "settled");
  const avg = done.length ? done.reduce((s, t) => s + (t.settle_ms || 0) / 1000, 0) / done.length : 0;
  const vol = done.reduce((s, t) => s + t.size * t.rate, 0);
  const active = trades.filter(t => !["settled", "failed"].includes(t.status)).length;

  const items = [
    { label: "Counterparties", value: String(agents.length), sub: "connected" },
    { label: "Open RFQs", value: String(rfqs.filter(r => r.status === "open").length), sub: "in book" },
    { label: "Active", value: String(active), sub: "in flight", color: active > 0 ? "var(--warn)" : undefined },
    { label: "Settled", value: String(done.length), sub: "completed", color: "var(--positive)" },
    { label: "Avg Settlement", value: avg > 0 ? avg.toFixed(1) + "s" : "—", sub: "end to end" },
    { label: "Volume", value: "$" + fmt(vol, 0), sub: "notional" },
  ];

  return (
    <div className="grid grid-cols-6 mb-4 animate-in" style={{ gap: "1px", background: "var(--border)", borderRadius: "4px", overflow: "hidden", border: "1px solid var(--border)" }}>
      {items.map(i => (
        <div key={i.label} className="px-3.5 py-3" style={{ background: "var(--surface)" }}>
          <div className="text-[9px] font-medium uppercase tracking-[0.8px] mb-1" style={{ color: "var(--t3)" }}>
            {i.label}
          </div>
          <div className="font-mono text-[17px] font-semibold tracking-tight leading-none" style={{ color: i.color || "var(--t0)" }}>
            {i.value}
          </div>
          <div className="text-[9px] mt-0.5" style={{ color: "var(--t3)" }}>{i.sub}</div>
        </div>
      ))}
    </div>
  );
}
