"use client";
import { Trade } from "@/lib/types";

function txUrl(h: string) { return h?.startsWith("0x") ? `https://sepolia.etherscan.io/tx/${h}` : `https://testnet.suprascan.io/tx/${h}`; }
function txLabel(h: string) { return h?.startsWith("0x") ? "Sepolia" : "Supra"; }

export default function TradeBlotter({ trades }: { trades: Trade[] }) {
  const sorted = [...trades].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="rounded border overflow-hidden mb-4 animate-in"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <span className="text-[11px] font-medium" style={{ color: "var(--t1)" }}>Trade Blotter</span>
        <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>
          {trades.length} executions
        </span>
      </div>
      {sorted.length === 0 ? (
        <div className="py-8 text-center text-[11px]" style={{ color: "var(--t3)" }}>No executions</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              {["ID","Pair","Size","Rate","Notional","Route","Time","Taker TX","Maker TX","Status"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[9px] font-medium uppercase tracking-wider border-b"
                  style={{ color: "var(--t3)", borderColor: "var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(t => (
              <tr key={t.id} className="transition-colors hover:bg-white/[0.01]"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                <td className="px-3 py-2 font-mono text-[10px]" style={{ color: "var(--t3)" }}>{t.display_id}</td>
                <td className="px-3 py-2 text-[12px] font-semibold">{t.pair}</td>
                <td className="px-3 py-2 font-mono text-[11px]">{t.size}</td>
                <td className="px-3 py-2 font-mono text-[11px]">${Number(t.rate).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                <td className="px-3 py-2 font-mono text-[11px]">${Number(t.notional).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                <td className="px-3 py-2 text-[10px]" style={{ color: "var(--t3)" }}>{t.source_chain} → {t.dest_chain}</td>
                <td className="px-3 py-2 font-mono text-[11px]" style={{ color: t.settle_ms ? "var(--positive)" : "var(--t3)" }}>
                  {t.settle_ms ? (t.settle_ms / 1000).toFixed(1) + "s" : "—"}
                </td>
                <td className="px-3 py-2">
                  {t.taker_tx_hash ? <a href={txUrl(t.taker_tx_hash)} target="_blank" className="font-mono text-[10px] hover:underline" style={{ color: "var(--accent-light)" }}>{txLabel(t.taker_tx_hash)} ↗</a> : <span style={{ color: "var(--t3)" }}>—</span>}
                </td>
                <td className="px-3 py-2">
                  {t.maker_tx_hash ? <a href={txUrl(t.maker_tx_hash)} target="_blank" className="font-mono text-[10px] hover:underline" style={{ color: "var(--accent-light)" }}>{txLabel(t.maker_tx_hash)} ↗</a> : <span style={{ color: "var(--t3)" }}>—</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={`tag tag-${t.status === "settled" ? "settled" : t.status}`}>
                    {t.status === "settled" ? "Settled" : t.status.replace(/_/g, " ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
