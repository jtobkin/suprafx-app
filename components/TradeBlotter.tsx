"use client";
import { useEffect, useState } from "react";
import { Trade, CommitteeRequest } from "@/lib/types";
import { supabase } from "@/lib/supabase";

function txUrl(h: string, chain: string) {
  if (!h) return "#";
  if (chain === "sepolia") return `https://sepolia.etherscan.io/tx/${h.startsWith("0x") ? h : "0x" + h}`;
  const supraHash = h.startsWith("0x") ? h.slice(2) : h.startsWith("supra_") ? h.slice(6) : h;
  return `https://testnet.suprascan.io/tx/${supraHash}`;
}

export default function TradeBlotter({ trades }: { trades: Trade[] }) {
  const [attestations, setAttestations] = useState<Record<string, string>>({});

  // Fetch attestation TXs for settled trades
  useEffect(() => {
    const settledIds = trades.filter(t => t.status === "settled").map(t => t.id);
    if (settledIds.length === 0) return;

    supabase.from("committee_requests")
      .select("trade_id, attestation_tx")
      .in("trade_id", settledIds)
      .eq("verification_type", "approve_reputation")
      .not("attestation_tx", "is", null)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, string> = {};
          data.forEach((r: any) => { if (r.attestation_tx) map[r.trade_id] = r.attestation_tx; });
          setAttestations(map);
        }
      });
  }, [trades]);

  const sorted = [...trades].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="rounded border overflow-hidden mb-4 animate-in"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <span className="text-[14px] font-medium" style={{ color: "var(--t1)" }}>Trade Blotter</span>
        <span className="font-mono text-[14px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>
          {trades.length} executions
        </span>
      </div>
      {sorted.length === 0 ? (
        <div className="py-8 text-center text-[14px]" style={{ color: "var(--t3)" }}>No executions</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              {["ID","Pair","Size","Rate","Route","Time","Taker TX","Maker TX","Attestation","Status"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[14px] font-medium uppercase tracking-wider border-b"
                  style={{ color: "var(--t2)", borderColor: "var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(t => {
              const att = attestations[t.id];
              return (
                <tr key={t.id} className="transition-colors hover:bg-white/[0.02]"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <td className="px-3 py-2.5 font-mono text-[13px]" style={{ color: "var(--t2)" }}>{t.display_id}</td>
                  <td className="px-3 py-2.5 text-[13px] font-semibold">{t.pair}</td>
                  <td className="px-3 py-2.5 font-mono text-[14px]">{t.size}</td>
                  <td className="px-3 py-2.5 font-mono text-[14px]" style={{ color: "var(--t1)" }}>
                    ${Number(t.rate).toLocaleString(undefined,{minimumFractionDigits:2})}
                  </td>
                  <td className="px-3 py-2.5 text-[13px]" style={{ color: "var(--t2)" }}>{t.source_chain} → {t.dest_chain}</td>
                  <td className="px-3 py-2.5 font-mono text-[14px]" style={{ color: t.settle_ms ? "var(--positive)" : "var(--t3)" }}>
                    {t.settle_ms ? (t.settle_ms / 1000).toFixed(1) + "s" : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {t.taker_tx_hash ? (
                      <a href={txUrl(t.taker_tx_hash, t.source_chain)} target="_blank" rel="noopener"
                        className="font-mono text-[13px] hover:underline" style={{ color: "var(--accent-light)" }}>
                        {t.source_chain === "sepolia" ? "Etherscan" : "SupraScan"} ↗
                      </a>
                    ) : <span className="text-[13px]" style={{ color: "var(--t3)" }}>—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {t.maker_tx_hash ? (
                      <a href={txUrl(t.maker_tx_hash, t.dest_chain)} target="_blank" rel="noopener"
                        className="font-mono text-[13px] hover:underline" style={{ color: "var(--accent-light)" }}>
                        {t.dest_chain === "supra-testnet" ? "SupraScan" : "Etherscan"} ↗
                      </a>
                    ) : <span className="text-[13px]" style={{ color: "var(--t3)" }}>—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {att ? (
                      <a href={`https://testnet.suprascan.io/tx/${att.replace(/^0x/, "")}`} target="_blank" rel="noopener"
                        className="font-mono text-[13px] hover:underline" style={{ color: "var(--positive)" }}>
                        On-chain ↗
                      </a>
                    ) : t.status === "settled" ? (
                      <span className="text-[14px]" style={{ color: "var(--t3)" }}>pending</span>
                    ) : (
                      <span className="text-[13px]" style={{ color: "var(--t3)" }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`tag tag-${t.status === "settled" ? "settled" : t.status}`}>
                      {t.status === "settled" ? "Settled" : t.status.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
