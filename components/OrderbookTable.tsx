"use client";
import { useState, useEffect } from "react";
import { useWallet } from "./WalletProvider";
import { RFQ, Trade } from "@/lib/types";
import { supabase } from "@/lib/supabase";

function txUrl(h: string, chain: string) {
  if (!h) return "#";
  if (chain === "sepolia") return `https://sepolia.etherscan.io/tx/${h.startsWith("0x") ? h : "0x" + h}`;
  const supraHash = h.startsWith("0x") ? h.slice(2) : h.startsWith("supra_") ? h.slice(6) : h;
  return `https://testnet.suprascan.io/tx/${supraHash}`;
}

export default function OrderbookTable({ rfqs, trades }: { rfqs: RFQ[]; trades?: Trade[] }) {
  const { supraAddress } = useWallet();
  const [attestations, setAttestations] = useState<Record<string, string>>({});

  const openRfqs = rfqs.filter(r => r.status === "open");
  const activeTrades = (trades || [])
    .filter(t => !["settled", "failed"].includes(t.status))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const completedTrades = (trades || [])
    .filter(t => t.status === "settled" || t.status === "failed")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  useEffect(() => {
    const settledIds = completedTrades.filter(t => t.status === "settled").map(t => t.id);
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
  }, [completedTrades.length]);

  const activeCount = openRfqs.length + activeTrades.length;

  return (
    <div className="card mb-4 animate-in">
      {/* === ACTIVE TRADES === */}
      <div className="card-header">
        <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>Active Trades</span>
        <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>
          {openRfqs.length} RFQ{openRfqs.length !== 1 ? "s" : ""} · {activeTrades.length} in-flight
        </span>
      </div>

      {activeCount === 0 ? (
        <div className="py-8 text-center text-[14px]" style={{ color: "var(--t3)" }}>
          No active trades
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              {["ID", "Pair", "Size", "Rate", "Route", "Taker", "Status"].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[12px] font-medium uppercase tracking-wider border-b"
                  style={{ color: "var(--t3)", borderColor: "var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {openRfqs.map(r => {
              const isMine = r.taker_address === supraAddress;
              return (
                <tr key={r.id} className="transition-colors hover:bg-white/[0.01]"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                  <td className="px-4 py-2.5 mono text-[13px]" style={{ color: "var(--t3)" }}>{r.display_id}</td>
                  <td className="px-4 py-2.5 text-[14px] font-semibold">{r.pair}</td>
                  <td className="px-4 py-2.5 mono text-[13px]">{r.size}</td>
                  <td className="px-4 py-2.5 mono text-[13px]">${Number(r.reference_price).toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                  <td className="px-4 py-2.5 text-[13px]" style={{ color: "var(--t3)" }}>{r.source_chain} → {r.dest_chain}</td>
                  <td className="px-4 py-2.5 mono text-[13px]" style={{ color: isMine ? "var(--accent)" : "var(--t2)" }}>
                    {isMine ? "You" : r.taker_address.slice(0, 10) + "…"}
                  </td>
                  <td className="px-4 py-2.5"><span className={`tag tag-${r.status}`}>{r.status}</span></td>
                </tr>
              );
            })}
            {activeTrades.map(t => {
              const isMine = t.taker_address === supraAddress;
              return (
                <tr key={t.id} className="transition-colors hover:bg-white/[0.01]"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                  <td className="px-4 py-2.5 mono text-[13px]" style={{ color: "var(--t3)" }}>{t.display_id}</td>
                  <td className="px-4 py-2.5 text-[14px] font-semibold">{t.pair}</td>
                  <td className="px-4 py-2.5 mono text-[13px]">{t.size}</td>
                  <td className="px-4 py-2.5 mono text-[13px]">${Number(t.rate).toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                  <td className="px-4 py-2.5 text-[13px]" style={{ color: "var(--t3)" }}>{t.source_chain} → {t.dest_chain}</td>
                  <td className="px-4 py-2.5 mono text-[13px]" style={{ color: isMine ? "var(--accent)" : "var(--t2)" }}>
                    {isMine ? "You" : t.taker_address.slice(0, 10) + "…"}
                  </td>
                  <td className="px-4 py-2.5"><span className={`tag tag-${t.status === "open" ? "open_trade" : t.status}`}>{t.status.replace(/_/g, " ")}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* === COMPLETED TRADES === */}
      {completedTrades.length > 0 && (
        <>
          <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: "var(--surface-2)", borderTop: "1px solid var(--border)" }}>
            <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>Completed Trades</span>
            <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>
              {completedTrades.length} execution{completedTrades.length !== 1 ? "s" : ""}
            </span>
          </div>
          <table className="w-full">
            <thead>
              <tr style={{ background: "var(--surface-2)" }}>
                {["ID","Pair","Size","Rate","Route","Time","Taker TX","Maker TX","Attestation","Status"].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider border-b"
                    style={{ color: "var(--t3)", borderColor: "var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {completedTrades.map(t => {
                const att = attestations[t.id];
                return (
                  <tr key={t.id} className="transition-colors hover:bg-white/[0.02]"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                    <td className="px-3 py-2.5 mono text-[12px]" style={{ color: "var(--t2)" }}>{t.display_id}</td>
                    <td className="px-3 py-2.5 text-[13px] font-semibold">{t.pair}</td>
                    <td className="px-3 py-2.5 mono text-[13px]">{t.size}</td>
                    <td className="px-3 py-2.5 mono text-[13px]" style={{ color: "var(--t1)" }}>
                      ${Number(t.rate).toLocaleString(undefined,{minimumFractionDigits:2})}
                    </td>
                    <td className="px-3 py-2.5 text-[12px]" style={{ color: "var(--t3)" }}>{t.source_chain} → {t.dest_chain}</td>
                    <td className="px-3 py-2.5 mono text-[13px]" style={{ color: t.settle_ms ? "var(--positive)" : "var(--t3)" }}>
                      {t.settle_ms ? (t.settle_ms / 1000).toFixed(1) + "s" : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {t.taker_tx_hash ? (
                        <a href={txUrl(t.taker_tx_hash, t.source_chain)} target="_blank" rel="noopener"
                          className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                          {t.source_chain === "sepolia" ? "Etherscan" : "SupraScan"} ↗
                        </a>
                      ) : <span className="text-[12px]" style={{ color: "var(--t3)" }}>—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {t.maker_tx_hash ? (
                        <a href={txUrl(t.maker_tx_hash, t.dest_chain)} target="_blank" rel="noopener"
                          className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                          {t.dest_chain === "supra-testnet" ? "SupraScan" : "Etherscan"} ↗
                        </a>
                      ) : <span className="text-[12px]" style={{ color: "var(--t3)" }}>—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {att ? (
                        <a href={`https://testnet.suprascan.io/tx/${att.replace(/^0x/, "")}`} target="_blank" rel="noopener"
                          className="mono text-[12px] hover:underline" style={{ color: "var(--positive)" }}>
                          On-chain ↗
                        </a>
                      ) : t.status === "settled" ? (
                        <span className="text-[12px]" style={{ color: "var(--t3)" }}>pending</span>
                      ) : (
                        <span className="text-[12px]" style={{ color: "var(--t3)" }}>—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`tag tag-${t.status}`}>
                        {t.status === "settled" ? "Settled" : t.status.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
