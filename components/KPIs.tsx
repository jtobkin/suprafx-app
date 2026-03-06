"use client";
import { Trade, Agent, RFQ } from "@/lib/types";

function fmt(n: number, d: number = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default function KPIs({ trades, agents, rfqs }: { trades: Trade[]; agents: Agent[]; rfqs: RFQ[] }) {
  const done = trades.filter(t => t.status === "settled");
  const vol = done.reduce((s, t) => s + t.size * t.rate, 0);

  const items = [
    { label: "Agents", value: String(agents.length), sub: "connected" },
    { label: "Open RFQs", value: String(rfqs.filter(r => r.status === "open").length), sub: "in book" },
    { label: "Settled", value: String(done.length), sub: "completed" },
    { label: "Volume", value: "$" + fmt(vol, 0), sub: "notional" },
  ];

  return (
    <div className="mb-5 animate-in">
      <div className="grid grid-cols-4 gap-2 mb-3">
        {items.map((item, i) => (
          <div key={item.label} className="px-4 py-3.5 rounded-md" style={{ background: "var(--surface)", border: "1px solid var(--border)", animationDelay: `${i * 0.04}s` }}>
            <div className="text-[11px] font-medium uppercase tracking-[1.5px] mb-2" style={{ color: "var(--t3)" }}>
              {item.label}
            </div>
            <div className="mono text-[22px] font-bold tracking-tight leading-none mb-1" style={{ color: "var(--t0)" }}>
              {item.value}
            </div>
            <div className="text-[11px]" style={{ color: "var(--t3)" }}>{item.sub}</div>
          </div>
        ))}
      </div>

    </div>
  );
}
