"use client";
import { RFQ } from "@/lib/types";

function fmtUsd(n: number) {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function OrderbookTable({ rfqs }: { rfqs: RFQ[] }) {
  const open = rfqs.filter(r => r.status === "open");

  return (
    <div className="border rounded-md overflow-hidden mb-4 animate-in" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex justify-between items-center px-4 py-3 border-b" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <span className="text-xs font-medium" style={{ color: "var(--t1)" }}>Orderbook</span>
        <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>{open.length} Open</span>
      </div>
      {open.length === 0 ? (
        <div className="py-10 text-center text-xs" style={{ color: "var(--t3)" }}>No open requests</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left" style={{ background: "var(--surface-2)" }}>
              {["RFQ ID","Pair","Size","Reference","Route","Taker","Slip","Status"].map(h => (
                <th key={h} className="px-4 py-2 text-[10px] font-medium uppercase tracking-wider border-b"
                  style={{ color: "var(--t3)", borderColor: "var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {open.map(r => (
              <tr key={r.id} className="hover:bg-white/[0.015] transition-colors">
                <td className="px-4 py-2.5 font-mono text-[11px]" style={{ color: "var(--t2)" }}>{r.display_id}</td>
                <td className="px-4 py-2.5 text-xs font-semibold">{r.pair}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.size}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{fmtUsd(r.reference_price)}</td>
                <td className="px-4 py-2.5 text-[11px]" style={{ color: "var(--t2)" }}>{r.source_chain} → {r.dest_chain}</td>
                <td className="px-4 py-2.5 text-xs" style={{ color: "var(--t2)" }}>{r.taker_address.slice(0,12)}…</td>
                <td className="px-4 py-2.5 font-mono text-xs" style={{ color: "var(--t2)" }}>{(r.max_slippage * 100).toFixed(1)}%</td>
                <td className="px-4 py-2.5"><span className="tag tag-open">Open</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
