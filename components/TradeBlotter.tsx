"use client";
import { Trade } from "@/lib/types";

function fmtUsd(n: number) {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function txUrl(hash: string) {
  return hash?.startsWith("0x")
    ? `https://sepolia.etherscan.io/tx/${hash}`
    : `https://testnet.suprascan.io/tx/${hash}`;
}

function txChain(hash: string) {
  return hash?.startsWith("0x") ? "Sepolia" : "Supra";
}

function statusLabel(s: string) {
  if (s === "settled") return "Settled";
  if (s === "failed") return "Failed";
  return s.replace(/_/g, " ");
}

export default function TradeBlotter({ trades }: { trades: Trade[] }) {
  const sorted = [...trades].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="border rounded-md overflow-hidden mb-4 animate-in" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex justify-between items-center px-4 py-3 border-b" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <span className="text-xs font-medium" style={{ color: "var(--t1)" }}>Trade Blotter</span>
        <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>{trades.length} Executions</span>
      </div>
      {sorted.length === 0 ? (
        <div className="py-10 text-center text-xs" style={{ color: "var(--t3)" }}>No executions</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left" style={{ background: "var(--surface-2)" }}>
              {["Trade ID","Pair","Size","Rate","Notional","Route","Settlement","Taker TX","Maker TX","Status"].map(h => (
                <th key={h} className="px-4 py-2 text-[10px] font-medium uppercase tracking-wider border-b"
                  style={{ color: "var(--t3)", borderColor: "var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(t => (
              <tr key={t.id} className="hover:bg-white/[0.015] transition-colors" style={{ borderBottom: "1px solid rgba(255,255,255,0.025)" }}>
                <td className="px-4 py-2.5 font-mono text-[11px]" style={{ color: "var(--t2)" }}>{t.display_id}</td>
                <td className="px-4 py-2.5 text-xs font-semibold">{t.pair}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{t.size}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{fmtUsd(t.rate)}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{fmtUsd(t.notional)}</td>
                <td className="px-4 py-2.5 text-[11px]" style={{ color: "var(--t2)" }}>{t.source_chain} → {t.dest_chain}</td>
                <td className="px-4 py-2.5 font-mono text-xs" style={{ color: "var(--positive)" }}>
                  {t.settle_ms ? (t.settle_ms / 1000).toFixed(1) + "s" : "—"}
                </td>
                <td className="px-4 py-2.5">
                  {t.taker_tx_hash ? (
                    <a href={txUrl(t.taker_tx_hash)} target="_blank" className="font-mono text-[11px] hover:underline" style={{ color: "var(--accent)" }}>
                      {txChain(t.taker_tx_hash)} ↗
                    </a>
                  ) : <span style={{ color: "var(--t3)" }}>—</span>}
                </td>
                <td className="px-4 py-2.5">
                  {t.maker_tx_hash ? (
                    <a href={txUrl(t.maker_tx_hash)} target="_blank" className="font-mono text-[11px] hover:underline" style={{ color: "var(--accent)" }}>
                      {txChain(t.maker_tx_hash)} ↗
                    </a>
                  ) : <span style={{ color: "var(--t3)" }}>—</span>}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`tag tag-${t.status}`}>{statusLabel(t.status)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
