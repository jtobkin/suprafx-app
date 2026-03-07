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
    <div className="mb-3 animate-in">
      <div className="grid grid-cols-4 gap-2">
        {items.map((item, i) => (
          <div key={item.label} className="px-3 py-2 rounded-md" style={{ background: "var(--surface)", border: "1px solid var(--border)", animationDelay: `${i * 0.04}s` }}>
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-medium uppercase tracking-[1.5px]" style={{ color: "var(--t3)" }}>{item.label}</span>
              <span className="text-[9px]" style={{ color: "var(--t3)" }}>{item.sub}</span>
            </div>
            <div className="mono text-[16px] font-bold tracking-tight leading-none mt-1" style={{ color: "var(--t0)" }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
