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
    { label: "Agents", value: String(agents.length), sub: "connected" },
    { label: "Open RFQs", value: String(rfqs.filter(r => r.status === "open").length), sub: "in book" },
    { label: "In-Flight", value: String(active), sub: "settling", color: active > 0 ? "var(--warn)" : undefined },
    { label: "Settled", value: String(done.length), sub: "completed", color: "var(--positive)" },
    { label: "Avg Time", value: avg > 0 ? avg.toFixed(1) + "s" : "—", sub: "settlement" },
    { label: "Volume", value: "$" + fmt(vol, 0), sub: "notional" },
  ];

  return (
    <div className="grid grid-cols-6 gap-2 mb-5 animate-in">
      {items.map((item, i) => (
        <div key={item.label} className="card px-4 py-3.5 relative overflow-hidden" style={{ animationDelay: `${i * 0.04}s` }}>
          {item.color && <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: item.color, opacity: 0.6 }} />}
          <div className="text-[12px] font-medium uppercase tracking-[1px] mb-2" style={{ color: "var(--t3)" }}>
            {item.label}
          </div>
          <div className="mono text-[22px] font-bold tracking-tight leading-none mb-1"
            style={{ color: item.color || "var(--t0)" }}>
            {item.value}
          </div>
          <div className="text-[12px]" style={{ color: "var(--t3)" }}>{item.sub}</div>
        </div>
      ))}
    </div>
  );
}
