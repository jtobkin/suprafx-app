"use client";
import { useState, useEffect } from "react";
import { useWallet } from "./WalletProvider";
import { RFQ, Trade, Quote, Agent } from "@/lib/types";
import { supabase } from "@/lib/supabase";

function addrUrl(addr: string, chain: string) {
  if (!addr || addr === "auto-maker-bot") return null;
  if (chain === "supra-testnet" || chain === "supra") {
    const clean = addr.startsWith("0x") ? addr.slice(2) : addr;
    return `https://testnet.suprascan.io/account/${clean}`;
  }
  const hex = addr.startsWith("0x") ? addr : "0x" + addr;
  return `https://sepolia.etherscan.io/address/${hex}`;
}

function txUrl(h: string, chain: string) {
  if (!h) return null;
  if (chain === "supra-testnet" || chain === "supra") {
    const clean = h.startsWith("0x") ? h.slice(2) : h.startsWith("supra_") ? h.slice(6) : h;
    return `https://testnet.suprascan.io/tx/${clean}`;
  }
  const hex = h.startsWith("0x") ? h : "0x" + h;
  return `https://sepolia.etherscan.io/tx/${hex}`;
}

function shortAddr(addr: string) {
  if (addr === "auto-maker-bot") return "SupraFX Bot";
  if (addr.length > 16) return addr.slice(0, 6) + "…" + addr.slice(-4);
  return addr;
}

function displayPair(pair: string) {
  return pair.replace(/fx/g, "");
}

function fmtRate(n: number) {
  if (n >= 1000) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function RepBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) return null;
  return (
    <span className="mono text-[10px] ml-1 px-1 py-0.5 rounded"
      style={{ background: "var(--surface-2)", color: Number(score) >= 4 ? "var(--positive)" : "var(--t3)" }}>
      {"★"} {Number(score).toFixed(1)}
    </span>
  );
}

function AddrWithRep({ addr, chain, agents, isMine }: { addr: string; chain: string; agents: Agent[]; isMine: boolean }) {
  const agent = agents.find(a => a.wallet_address === addr);
  const rep = agent?.rep_total ?? null;
  const url = addrUrl(addr, chain);
  const display = isMine ? "You" : shortAddr(addr);

  return (
    <span className="inline-flex items-center gap-0.5">
      {url ? (
        <a href={url} target="_blank" rel="noopener" className="mono text-[12px] hover:underline"
          style={{ color: isMine ? "var(--accent)" : "var(--t2)" }}>
          {display}
        </a>
      ) : (
        <span className="mono text-[12px]" style={{ color: isMine ? "var(--accent)" : "var(--t2)" }}>{display}</span>
      )}
      <RepBadge score={rep} />
    </span>
  );
}

interface Props {
  rfqs: RFQ[];
  trades?: Trade[];
  quotes?: Quote[];
  agents?: Agent[];
  onAcceptQuote?: () => void;
}

export default function OrderbookTable({ rfqs, trades, quotes = [], agents = [], onAcceptQuote }: Props) {
  const { supraAddress } = useWallet();
  const [expandedRfq, setExpandedRfq] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [attestations, setAttestations] = useState<Record<string, string>>({});

  const openRfqs = rfqs.filter(r => r.status === "open")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

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

  const acceptQuote = async (quoteId: string) => {
    if (!supraAddress) return;
    setAccepting(quoteId);
    try {
      const res = await fetch("/api/skill/suprafx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept_quote", quoteId, agentAddress: supraAddress }),
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else onAcceptQuote?.();
    } catch (e: any) { alert(e.message); }
    setAccepting(null);
  };

  const activeCount = openRfqs.length + activeTrades.length;

  return (
    <div className="card mb-4 animate-in">
      <div className="card-header">
        <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>Active Trades</span>
        <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>
          {openRfqs.length} RFQ{openRfqs.length !== 1 ? "s" : ""} {"·"} {activeTrades.length} in-flight
        </span>
      </div>

      {activeCount === 0 ? (
        <div className="py-8 text-center text-[14px]" style={{ color: "var(--t3)" }}>
          No active trades
        </div>
      ) : (
        <div>
          {openRfqs.map(r => {
            const isMine = r.taker_address === supraAddress;
            const rfqQuotes = quotes.filter(q => q.rfq_id === r.id).sort((a, b) => b.rate - a.rate);
            const isExpanded = expandedRfq === r.id;
            const pairClean = displayPair(r.pair);
            const [base, quote] = r.pair.split("/");
            const baseClean = base.replace("fx", "");
            const quoteClean = quote.replace("fx", "");

            return (
              <div key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-white/[0.01] transition-colors"
                  onClick={() => setExpandedRfq(isExpanded ? null : r.id)}>
                  <span className="mono text-[12px] w-20 shrink-0" style={{ color: "var(--t3)" }}>{r.display_id}</span>
                  <span className="text-[13px] font-semibold w-28 shrink-0">{pairClean}</span>
                  <span className="mono text-[13px] w-24 shrink-0">{r.size} {baseClean}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Asking </span>
                    <span className="mono text-[13px] font-semibold" style={{ color: "var(--t1)" }}>
                      {fmtRate(r.reference_price)} {quoteClean}/{baseClean}
                    </span>
                  </div>
                  <span className="text-[12px] shrink-0" style={{ color: "var(--t3)" }}>{r.source_chain} {"→"} {r.dest_chain}</span>
                  <div className="shrink-0">
                    <AddrWithRep addr={r.taker_address} chain={r.source_chain} agents={agents} isMine={isMine} />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tag tag-open">{rfqQuotes.length} quote{rfqQuotes.length !== 1 ? "s" : ""}</span>
                    <span className="text-[10px]" style={{ color: "var(--t3)" }}>{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="animate-slide-down" style={{ background: "var(--bg-raised)" }}>
                    {rfqQuotes.length === 0 ? (
                      <div className="px-8 py-3 text-[13px]" style={{ color: "var(--t3)" }}>
                        Waiting for maker quotes...
                      </div>
                    ) : (
                      <div>
                        <div className="px-8 py-1.5 flex items-center gap-4" style={{ borderBottom: "1px solid var(--border)" }}>
                          {["Maker","Quote Price","vs Asking","You Receive","Status"].map(h => (
                            <span key={h} className={"mono text-[10px] uppercase tracking-wider font-medium " + (h === "Maker" ? "w-40" : h === "Quote Price" ? "w-36" : h === "vs Asking" ? "w-28" : h === "You Receive" ? "w-32" : "w-20")}
                              style={{ color: "var(--t3)" }}>{h}</span>
                          ))}
                          {isMine && <span className="mono text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>Action</span>}
                        </div>
                        {rfqQuotes.map(q => {
                          const diff = r.reference_price > 0 ? ((q.rate - r.reference_price) / r.reference_price) * 100 : 0;
                          const diffColor = diff >= 0 ? "var(--positive)" : "var(--negative)";
                          const receive = r.size * q.rate;
                          return (
                            <div key={q.id} className="px-8 py-2.5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors"
                              style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                              <div className="w-40">
                                <AddrWithRep addr={q.maker_address} chain={r.dest_chain} agents={agents} isMine={q.maker_address === supraAddress} />
                              </div>
                              <span className="mono text-[13px] font-semibold w-36" style={{ color: "var(--t1)" }}>
                                {fmtRate(q.rate)} {quoteClean}
                              </span>
                              <span className="mono text-[12px] w-28" style={{ color: diffColor }}>
                                {diff >= 0 ? "+" : ""}{diff.toFixed(2)}%
                              </span>
                              <span className="mono text-[13px] w-32" style={{ color: "var(--positive)" }}>
                                {receive >= 1000 ? receive.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : receive.toFixed(4)} {quoteClean}
                              </span>
                              <span className="w-20">
                                <span className={`tag tag-${q.status}`}>{q.status}</span>
                              </span>
                              {isMine && q.status === "pending" && (
                                <button onClick={(e) => { e.stopPropagation(); acceptQuote(q.id); }}
                                  disabled={accepting === q.id}
                                  className="px-3 py-1 rounded text-[12px] font-semibold transition-all hover:brightness-110 disabled:opacity-50"
                                  style={{ background: "var(--positive)", color: "#fff", border: "none" }}>
                                  {accepting === q.id ? "..." : "Accept"}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {activeTrades.length > 0 && (
            <>
              {openRfqs.length > 0 && (
                <div className="px-4 py-2" style={{ background: "var(--surface-2)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
                  <span className="mono text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>In-Flight</span>
                </div>
              )}
              {activeTrades.map(t => {
                const isMine = t.taker_address === supraAddress;
                const pairClean = displayPair(t.pair);
                return (
                  <div key={t.id} className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.01] transition-colors"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                    <span className="mono text-[12px] w-20 shrink-0" style={{ color: "var(--t3)" }}>{t.display_id}</span>
                    <span className="text-[13px] font-semibold w-28 shrink-0">{pairClean}</span>
                    <span className="mono text-[13px] w-24 shrink-0">{t.size}</span>
                    <span className="mono text-[13px] flex-1" style={{ color: "var(--t1)" }}>{fmtRate(t.rate)}</span>
                    <span className="text-[12px] shrink-0" style={{ color: "var(--t3)" }}>{t.source_chain} {"→"} {t.dest_chain}</span>
                    <div className="shrink-0">
                      <AddrWithRep addr={t.taker_address} chain={t.source_chain} agents={agents} isMine={isMine} />
                    </div>
                    <span className="mono text-[11px]" style={{ color: "var(--t3)" }}>{"↔"}</span>
                    <div className="shrink-0">
                      <AddrWithRep addr={t.maker_address} chain={t.dest_chain} agents={agents} isMine={t.maker_address === supraAddress} />
                    </div>
                    <span className={`tag tag-${t.status === "open" ? "open_trade" : t.status}`}>{t.status.replace(/_/g, " ")}</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

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
                const takerTxUrl = txUrl(t.taker_tx_hash || "", t.source_chain);
                const makerTxUrl = txUrl(t.maker_tx_hash || "", t.dest_chain);
                return (
                  <tr key={t.id} className="transition-colors hover:bg-white/[0.02]"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                    <td className="px-3 py-2.5 mono text-[12px]" style={{ color: "var(--t2)" }}>{t.display_id}</td>
                    <td className="px-3 py-2.5 text-[13px] font-semibold">{displayPair(t.pair)}</td>
                    <td className="px-3 py-2.5 mono text-[13px]">{t.size}</td>
                    <td className="px-3 py-2.5 mono text-[13px]" style={{ color: "var(--t1)" }}>{fmtRate(t.rate)}</td>
                    <td className="px-3 py-2.5 text-[12px]" style={{ color: "var(--t3)" }}>{t.source_chain} {"→"} {t.dest_chain}</td>
                    <td className="px-3 py-2.5 mono text-[13px]" style={{ color: t.settle_ms ? "var(--positive)" : "var(--t3)" }}>
                      {t.settle_ms ? (t.settle_ms / 1000).toFixed(1) + "s" : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {t.taker_tx_hash && takerTxUrl ? (
                        <a href={takerTxUrl} target="_blank" rel="noopener"
                          className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                          {t.source_chain === "sepolia" ? "Etherscan" : "SupraScan"} {"↗"}
                        </a>
                      ) : <span className="text-[12px]" style={{ color: "var(--t3)" }}>{"—"}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {t.maker_tx_hash && makerTxUrl ? (
                        <a href={makerTxUrl} target="_blank" rel="noopener"
                          className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                          {t.dest_chain === "supra-testnet" ? "SupraScan" : "Etherscan"} {"↗"}
                        </a>
                      ) : <span className="text-[12px]" style={{ color: "var(--t3)" }}>{"—"}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {att ? (
                        <a href={`https://testnet.suprascan.io/tx/${att.replace(/^0x/, "")}`} target="_blank" rel="noopener"
                          className="mono text-[12px] hover:underline" style={{ color: "var(--positive)" }}>
                          On-chain {"↗"}
                        </a>
                      ) : t.status === "settled" ? (
                        <span className="text-[12px]" style={{ color: "var(--t3)" }}>pending</span>
                      ) : (
                        <span className="text-[12px]" style={{ color: "var(--t3)" }}>{"—"}</span>
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
