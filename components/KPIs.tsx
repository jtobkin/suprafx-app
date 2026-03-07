"use client";
import { Trade, Agent, RFQ } from "@/lib/types";

function fmt(n: number, d: number = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default function KPIs({ trades, agents, rfqs }: { trades: Trade[]; agents: Agent[]; rfqs: RFQ[] }) {
  const done = trades.filter(t => t.status === "settled");
  const vol = done.reduce((s, t) => s + t.size * t.rate, 0);

  const items = [
    { label: "Agents", value: String(agents.length) },
    { label: "Open RFQs", value: String(rfqs.filter(r => r.status === "open").length) },
    { label: "Settled", value: String(done.length), color: "var(--positive)" },
    { label: "Volume", value: "$" + fmt(vol, 0) },
  ];

  return (
    <div className="flex animate-in mb-2" style={{ borderBottom: "1px solid var(--border)" }}>
      {items.map((item, i) => (
        <div key={item.label} className="flex-1 px-3 py-2" style={{ borderRight: i < items.length - 1 ? "1px solid var(--border)" : "none" }}>
          <div className="text-[8px] font-semibold uppercase" style={{ color: "var(--t3)", letterSpacing: "1.5px" }}>{item.label}</div>
          <div className="mono text-[16px] font-bold leading-tight mt-0.5" style={{ color: item.color || "var(--t0)" }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
