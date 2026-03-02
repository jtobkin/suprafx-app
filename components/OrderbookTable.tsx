"use client";
import { useState } from "react";
import { useWallet } from "./WalletProvider";
import { RFQ } from "@/lib/types";

export default function OrderbookTable({ rfqs }: { rfqs: RFQ[] }) {
  const { supraAddress } = useWallet();
  const [view, setView] = useState<"global" | "mine">("global");

  const filtered = view === "mine" && supraAddress
    ? rfqs.filter(r => r.taker_address === supraAddress)
    : rfqs;

  const open = filtered.filter(r => r.status === "open");
  const matched = filtered.filter(r => r.status === "matched").slice(0, 5);
  const all = [...open, ...matched];

  const myCount = supraAddress ? rfqs.filter(r => r.taker_address === supraAddress).length : 0;

  return (
    <div className="rounded border overflow-hidden mb-4 animate-in"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium" style={{ color: "var(--t1)" }}>Orderbook</span>
          {/* Toggle */}
          <div className="flex items-center rounded overflow-hidden border" style={{ borderColor: "var(--border)" }}>
            <button onClick={() => setView("global")}
              className="px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider transition-colors"
              style={{
                background: view === "global" ? "var(--accent)" : "transparent",
                color: view === "global" ? "#fff" : "var(--t3)",
                border: "none",
              }}>
              Global
            </button>
            <button onClick={() => setView("mine")}
              className="px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider transition-colors"
              style={{
                background: view === "mine" ? "var(--accent)" : "transparent",
                color: view === "mine" ? "#fff" : "var(--t3)",
                border: "none",
              }}>
              My Orders{myCount > 0 ? ` (${myCount})` : ""}
            </button>
          </div>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>
          {open.length} open · {matched.length} matched
        </span>
      </div>
      {all.length === 0 ? (
        <div className="py-8 text-center text-[11px]" style={{ color: "var(--t3)" }}>
          {view === "mine" ? "You have no orders yet" : "No requests"}
        </div>
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
            {all.map(r => {
              const isMine = r.taker_address === supraAddress;
              return (
                <tr key={r.id} className="transition-colors hover:bg-white/[0.01]"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                  <td className="px-4 py-2 font-mono text-[10px]" style={{ color: "var(--t3)" }}>{r.display_id}</td>
                  <td className="px-4 py-2 text-[12px] font-semibold">{r.pair}</td>
                  <td className="px-4 py-2 font-mono text-[11px]">{r.size}</td>
                  <td className="px-4 py-2 font-mono text-[11px]">${Number(r.reference_price).toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                  <td className="px-4 py-2 text-[10px]" style={{ color: "var(--t3)" }}>{r.source_chain} → {r.dest_chain}</td>
                  <td className="px-4 py-2 font-mono text-[10px]" style={{ color: isMine ? "var(--accent-light)" : "var(--t2)" }}>
                    {isMine ? "You" : r.taker_address.slice(0,10) + "…"}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px]" style={{ color: "var(--t2)" }}>{(Number(r.max_slippage)*100).toFixed(1)}%</td>
                  <td className="px-4 py-2"><span className={`tag tag-${r.status}`}>{r.status}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
