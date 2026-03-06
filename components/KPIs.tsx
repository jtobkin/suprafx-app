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
      {/* Supra Price Widget */}
      <div className="rounded-md overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <iframe
          src="https://supra.com/data/widgets?widgetType=horizontal&instrumentPairs=btc_usdt,eth_usdt,supra_usdt&x-api-key=f9c3e7b5d2a8f0c4e6b1d9a3f7c5e2d8b6a0f4c9e1d3b7a5c2e8f6d1a9c4t6a1"
          width="100%"
          height="400"
          frameBorder="0"
          scrolling="no"
          style={{ display: "block" }}
        />
      </div>
    </div>
  );
}
