"use client";
import { RFQ } from "@/lib/types";

export default function OrderbookTable({ rfqs }: { rfqs: RFQ[] }) {
  const open = rfqs.filter(r => r.status === "open");
  const matched = rfqs.filter(r => r.status === "matched").slice(0, 3);
  const all = [...open, ...matched];

  return (
    <div className="rounded border overflow-hidden mb-4 animate-in"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <span className="text-[11px] font-medium" style={{ color: "var(--t1)" }}>Orderbook</span>
        <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>
          {open.length} open · {matched.length} matched
        </span>
      </div>
      {all.length === 0 ? (
        <div className="py-8 text-center text-[11px]" style={{ color: "var(--t3)" }}>No requests</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              {["ID","Pair","Size","Ref Price","Route","Taker","Slip","Status"].map(h => (
                <th key={h} className="px-4 py-2 text-left text-[9px] font-medium uppercase tracking-wider border-b"
                  style={{ color: "var(--t3)", borderColor: "var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {all.map(r => (
              <tr key={r.id} className="transition-colors hover:bg-white/[0.01]"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                <td className="px-4 py-2 font-mono text-[10px]" style={{ color: "var(--t3)" }}>{r.display_id}</td>
                <td className="px-4 py-2 text-[12px] font-semibold">{r.pair}</td>
                <td className="px-4 py-2 font-mono text-[11px]">{r.size}</td>
                <td className="px-4 py-2 font-mono text-[11px]">${Number(r.reference_price).toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                <td className="px-4 py-2 text-[10px]" style={{ color: "var(--t3)" }}>{r.source_chain} → {r.dest_chain}</td>
                <td className="px-4 py-2 font-mono text-[10px]" style={{ color: "var(--t2)" }}>{r.taker_address.slice(0,10)}…</td>
                <td className="px-4 py-2 font-mono text-[11px]" style={{ color: "var(--t2)" }}>{(Number(r.max_slippage)*100).toFixed(1)}%</td>
                <td className="px-4 py-2"><span className={`tag tag-${r.status}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
