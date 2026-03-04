"use client";
import { useState, useEffect } from "react";
import { useWallet } from "./WalletProvider";
import { RFQ, Trade, Quote, Agent } from "@/lib/types";
import { generateTxId } from "@/lib/tx-id";

function displayPair(pair: string) { return pair.replace(/fx/g, ""); }

function fmtRate(n: number) {
  if (n >= 1000) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function shortAddr(addr: string) {
  if (addr === "auto-maker-bot") return "SupraFX Bot";
  if (addr.length > 16) return addr.slice(0, 6) + "…" + addr.slice(-4);
  return addr;
}

function txUrl(h: string, chain: string) {
  if (!h) return null;
  if (chain === "supra-testnet" || chain === "supra") {
    const clean = h.startsWith("0x") ? h.slice(2) : h;
    return `https://testnet.suprascan.io/tx/${clean}`;
  }
  return `https://sepolia.etherscan.io/tx/${h.startsWith("0x") ? h : "0x" + h}`;
}

// Unified row type
type HistoryRow = {
  id: string;
  txId: string;
  type: "trade" | "rfq";
  pair: string;
  size: number;
  rate: number | null;
  side: "Taker" | "Maker";
  counterparty: string;
  counterChain: string;
  sourceChain: string;
  destChain: string;
  status: string;
  settleMs: number | null;
  createdAt: string;
  // For detail expansion
  trade?: Trade;
  rfq?: RFQ;
  rfqForTrade?: RFQ;
  tradeQuotes?: Quote[];
};

interface Props {
  rfqs: RFQ[];
  trades: Trade[];
  quotes: Quote[];
  agents: Agent[];
}

function AuditTrailMini({ tradeId, supraAddr }: { tradeId: string; supraAddr?: string }) {
  const [timeline, setTimeline] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    fetch(`/api/signed-actions?tradeId=\${tradeId}`)
      .then(r => r.json())
      .then(data => { setTimeline(data.actions || []); setLoaded(true); })
      .catch(() => { setTimeline([]); setLoaded(true); });
  }, [open, loaded, tradeId]);

  const actionLabel: Record<string, string> = {
    submit_rfq: "Submit RFQ", place_quote: "Place Quote", accept_quote: "Accept Quote",
    confirm_taker_tx: "Taker TX Confirm", confirm_maker_tx: "Maker TX Confirm",
  };
  const actionColor: Record<string, string> = {
    submit_rfq: "var(--accent-light)", place_quote: "var(--warn)", accept_quote: "var(--positive)",
    confirm_taker_tx: "var(--accent-light)", confirm_maker_tx: "var(--positive)",
  };

  return (
    <div className="mt-3">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[12px] mono transition-colors"
        style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>
        <span style={{ fontSize: 8 }}>{open ? "\u25BC" : "\u25B6"}</span>
        Audit Trail {loaded ? `(\${timeline.length} action\${timeline.length !== 1 ? "s" : ""})` : "(click to load)"}
      </button>
      {open && (
        <div className="mt-2 rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {!loaded ? (
            <div className="px-3 py-2 text-[12px]" style={{ color: "var(--t3)" }}>Loading...</div>
          ) : timeline.length === 0 ? (
            <div className="px-3 py-2 text-[12px]" style={{ color: "var(--t3)" }}>No signed actions recorded.</div>
          ) : (
            <div>
              <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] mono uppercase" style={{ background: "var(--surface-2)", color: "var(--t3)" }}>
                <span className="w-16">Time</span>
                <span className="w-28">Action</span>
                <span className="w-24">Signer</span>
                <span className="w-20">Sig</span>
                <span className="flex-1">Session Key</span>
              </div>
              {timeline.map((a: any, i: number) => {
                const timeStr = new Date(a.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                const signerShort = a.signer_address === "auto-maker-bot" ? "Bot" :
                  a.signer_address === supraAddr ? "You" :
                  a.signer_address.slice(0, 6) + "\u2026" + a.signer_address.slice(-4);
                const hasSig = a.signature && a.signature.length > 10;
                const hasAuth = a.session_auth_signature && a.session_auth_signature.length > 10;
                return (
                  <div key={a.id || i} className="flex items-center gap-2 px-3 py-1.5 text-[11px]"
                    style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--surface-1)" }}>
                    <span className="mono w-16 shrink-0" style={{ color: "var(--t3)" }}>{timeStr}</span>
                    <span className="w-28 shrink-0 font-medium" style={{ color: actionColor[a.action_type] || "var(--t2)" }}>
                      {actionLabel[a.action_type] || a.action_type}
                    </span>
                    <span className="mono w-24 shrink-0" style={{ color: a.signer_address === supraAddr ? "var(--positive)" : "var(--t2)" }}>{signerShort}</span>
                    <span className="mono w-20 shrink-0" style={{ color: hasSig ? "var(--positive)" : "var(--t3)" }}>
                      {hasSig ? a.signature.slice(0, 8) + "\u2026" : "\u2014"}
                    </span>
                    <span className="mono flex-1 truncate" style={{ color: hasAuth ? "var(--positive)" : a.session_public_key ? "var(--t2)" : "var(--t3)" }}>
                      {a.session_public_key ? a.session_public_key.slice(0, 12) + "\u2026" : "\u2014"}
                      {hasAuth && <span style={{ color: "var(--positive)", marginLeft: 4 }} title="Wallet-authorized session">\u2713</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MyTrades({ rfqs, trades, quotes, agents }: Props) {
  const { supraAddress } = useWallet();
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!supraAddress) return null;

  // Build unified list
  const rows: HistoryRow[] = [];

  // Add trades
  trades
    .filter(t => t.taker_address === supraAddress || t.maker_address === supraAddress)
    .forEach(t => {
      const side = t.taker_address === supraAddress ? "Taker" as const : "Maker" as const;
      const rfqForTrade = rfqs.find(r => r.id === t.rfq_id);
      const txId = rfqForTrade ? generateTxId(rfqForTrade.display_id, rfqForTrade.taker_address) : t.display_id;
      rows.push({
        id: t.id,
        txId,
        type: "trade",
        pair: t.pair,
        size: t.size,
        rate: t.rate,
        side,
        counterparty: side === "Taker" ? t.maker_address : t.taker_address,
        counterChain: side === "Taker" ? t.dest_chain : t.source_chain,
        sourceChain: t.source_chain,
        destChain: t.dest_chain,
        status: t.status,
        settleMs: t.settle_ms,
        createdAt: t.created_at,
        trade: t,
        rfqForTrade,
        tradeQuotes: rfqForTrade ? quotes.filter(q => q.rfq_id === rfqForTrade.id) : [],
      });
    });

  // Add cancelled/expired RFQs that don't have a trade
  const rfqIdsWithTrades = new Set(trades.map(t => t.rfq_id));
  rfqs
    .filter(r => r.taker_address === supraAddress && ["cancelled", "expired"].includes(r.status) && !rfqIdsWithTrades.has(r.id))
    .forEach(r => {
      rows.push({
        id: r.id,
        txId: generateTxId(r.display_id, r.taker_address),
        type: "rfq",
        pair: r.pair,
        size: r.size,
        rate: r.reference_price,
        side: "Taker",
        counterparty: "",
        counterChain: "",
        sourceChain: r.source_chain,
        destChain: r.dest_chain,
        status: r.status,
        settleMs: null,
        createdAt: r.created_at,
        rfq: r,
        tradeQuotes: quotes.filter(q => q.rfq_id === r.id),
      });
    });

  // Sort by created_at descending
  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (rows.length === 0) return null;

  // Stats
  const settled = rows.filter(r => r.status === "settled").length;
  const inFlight = rows.filter(r => r.type === "trade" && !["settled", "failed"].includes(r.status)).length;
  const failed = rows.filter(r => r.status === "failed").length;
  const cancelled = rows.filter(r => r.status === "cancelled").length;
  const avgSettleMs = (() => {
    const times = rows.filter(r => r.settleMs).map(r => r.settleMs!);
    return times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  })();
  const myAgent = agents.find(a => a.wallet_address === supraAddress);

  return (
    <div className="card mb-4 animate-in">
      <div className="card-header">
        <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>My Trade History</span>
        <div className="flex items-center gap-3">
          {myAgent && (
            <span className="mono text-[11px] px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--positive)" }}>
              ★ {Number(myAgent.rep_total).toFixed(1)} rep
            </span>
          )}
          <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>
            {supraAddress.slice(0, 8)}…{supraAddress.slice(-4)}
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-6 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Settled</span>
          <span className="mono text-[14px] font-semibold" style={{ color: "var(--positive)" }}>{settled}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>In-Flight</span>
          <span className="mono text-[14px] font-semibold" style={{ color: "var(--accent)" }}>{inFlight}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Failed</span>
          <span className="mono text-[14px] font-semibold" style={{ color: failed > 0 ? "var(--negative)" : "var(--t3)" }}>{failed}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Cancelled</span>
          <span className="mono text-[14px] font-semibold" style={{ color: cancelled > 0 ? "var(--negative)" : "var(--t3)" }}>{cancelled}</span>
        </div>
        {avgSettleMs > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Avg Settle</span>
            <span className="mono text-[14px] font-semibold" style={{ color: "var(--positive)" }}>{(avgSettleMs / 1000).toFixed(1)}s</span>
          </div>
        )}
      </div>

      {/* Rows */}
      <div>
                <div className="flex items-center gap-4 px-4 py-1.5" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
            <span className="mono text-[10px] uppercase tracking-wider font-medium w-24 shrink-0" style={{ color: "var(--t3)" }}>TX ID</span>
            <span className="mono text-[10px] uppercase tracking-wider font-medium w-24 shrink-0" style={{ color: "var(--t3)" }}>Pair</span>
            <span className="mono text-[10px] uppercase tracking-wider font-medium w-20 shrink-0" style={{ color: "var(--t3)" }}>Size</span>
            <span className="mono text-[10px] uppercase tracking-wider font-medium w-28 shrink-0" style={{ color: "var(--t3)" }}>Rate</span>
            <span className="mono text-[10px] uppercase tracking-wider font-medium w-14 shrink-0" style={{ color: "var(--t3)" }}>Side</span>
            <span className="mono text-[10px] uppercase tracking-wider font-medium w-28 shrink-0" style={{ color: "var(--t3)" }}>Counterparty</span>
            <span className="mono text-[10px] uppercase tracking-wider font-medium w-40 shrink-0" style={{ color: "var(--t3)" }}>Route</span>
            <span className="mono text-[10px] uppercase tracking-wider font-medium w-16 shrink-0" style={{ color: "var(--t3)" }}>Settle</span>
            <span className="mono text-[10px] uppercase tracking-wider font-medium flex-1 text-right" style={{ color: "var(--t3)" }}>Status</span>
          </div>
          {rows.map(row => {
          const isExpanded = expanded === row.id;
          const pairClean = displayPair(row.pair);
          const [base, quote] = row.pair.split("/");
          const baseClean = base.replace("fx", "");
          const quoteClean = quote?.replace("fx", "") || "";

          return (
            <div key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center gap-4 px-4 py-2.5 cursor-pointer hover:bg-white/[0.01] transition-colors"
                onClick={() => setExpanded(isExpanded ? null : row.id)}>
                <span className="mono text-[12px] w-24 shrink-0" style={{ color: "var(--t3)" }}>{row.txId}</span>
                <span className="text-[13px] font-semibold w-24 shrink-0">{pairClean}</span>
                <span className="mono text-[13px] w-20 shrink-0">{row.size}</span>
                <span className="mono text-[13px] w-28 shrink-0" style={{ color: "var(--t1)" }}>
                  {row.rate ? `${fmtRate(row.rate)} ${quoteClean}` : "—"}
                </span>
                <span className="text-[12px] w-14 shrink-0 font-medium" style={{ color: row.side === "Taker" ? "var(--accent)" : "var(--positive)" }}>{row.side}</span>
                <span className="mono text-[12px] w-28 shrink-0" style={{ color: "var(--t2)" }}>
                  {row.counterparty ? shortAddr(row.counterparty) : "—"}
                </span>
                <span className="text-[12px] w-40 shrink-0" style={{ color: "var(--t3)" }}>{row.sourceChain} → {row.destChain}</span>
                <span className="mono text-[12px] w-16 shrink-0" style={{ color: row.settleMs ? "var(--positive)" : "var(--t3)" }}>
                  {row.settleMs ? (row.settleMs / 1000).toFixed(1) + "s" : "—"}
                </span>
                <div className="flex items-center gap-2 flex-1 justify-end">
                  <span className={`tag tag-${row.status === "cancelled" ? "cancelled" : row.status === "open" ? "open_trade" : row.status}`}>
                    {row.status === "settled" ? "Settled" : row.status === "cancelled" ? "Cancelled" : row.status === "expired" ? "Expired" : row.status === "failed" ? "Failed" : row.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--t3)" }}>{isExpanded ? "▲" : "▼"}</span>
                </div>
              </div>

              {isExpanded && (
                <div className="px-6 pb-4 pt-1" style={{ background: "var(--bg-raised)" }}>
                  <div className="grid grid-cols-3 gap-6 mb-3">
                    {/* Price */}
                    <div>
                      <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Price</span>
                      {row.rfqForTrade || row.rfq ? (() => {
                        const rfqRef = row.rfqForTrade || row.rfq;
                        const askingPrice = rfqRef?.reference_price;
                        const filledRate = row.trade?.rate || row.rate;
                        const priceDiff = askingPrice && filledRate && askingPrice > 0 ? ((filledRate - askingPrice) / askingPrice) * 100 : null;
                        return (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px]" style={{ color: "var(--t3)" }}>Asked:</span>
                              <span className="mono text-[13px]" style={{ color: "var(--t2)" }}>
                                {askingPrice ? `${fmtRate(askingPrice)} ${quoteClean}` : "—"}
                              </span>
                            </div>
                            {filledRate && row.type === "trade" && (
                              <div className="flex items-center gap-2">
                                <span className="text-[11px]" style={{ color: "var(--t3)" }}>Filled:</span>
                                <span className="mono text-[13px] font-semibold" style={{ color: "var(--t1)" }}>
                                  {fmtRate(filledRate)} {quoteClean}
                                </span>
                                {priceDiff !== null && (
                                  <span className="mono text-[11px]" style={{ color: priceDiff >= 0 ? "var(--positive)" : "var(--negative)" }}>
                                    {priceDiff >= 0 ? "+" : ""}{priceDiff.toFixed(2)}%
                                  </span>
                                )}
                              </div>
                            )}
                            {row.type === "trade" && filledRate && (
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[11px]" style={{ color: "var(--t3)" }}>Notional:</span>
                                <span className="mono text-[13px]" style={{ color: "var(--positive)" }}>
                                  {(row.size * filledRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {quoteClean}
                                </span>
                              </div>
                            )}
                          </>
                        );
                      })() : (
                        <span className="mono text-[13px]" style={{ color: "var(--t1)" }}>
                          {row.rate ? `${fmtRate(row.rate)} ${quoteClean}` : "—"}
                        </span>
                      )}
                    </div>

                    {/* Counterparties */}
                    <div>
                      <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Counterparties</span>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] w-12" style={{ color: "var(--t3)" }}>Taker:</span>
                        <span className="mono text-[12px]" style={{ color: "var(--accent)" }}>
                          {(row.trade?.taker_address || row.rfq?.taker_address) === supraAddress ? "You" : shortAddr(row.trade?.taker_address || row.rfq?.taker_address || "")}
                        </span>
                        {(() => {
                          const addr = row.trade?.taker_address || row.rfq?.taker_address;
                          const agent = addr ? agents.find(a => a.wallet_address === addr) : null;
                          return agent ? (
                            <span className="mono text-[10px] px-1 py-0.5 rounded" style={{ background: "var(--surface-2)", color: Number(agent.rep_total) >= 4 ? "var(--positive)" : "var(--t3)" }}>
                              ★ {Number(agent.rep_total).toFixed(1)}
                            </span>
                          ) : null;
                        })()}
                      </div>
                      {row.counterparty && (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] w-12" style={{ color: "var(--t3)" }}>Maker:</span>
                          <span className="mono text-[12px]" style={{ color: "var(--t2)" }}>{shortAddr(row.counterparty)}</span>
                          {(() => {
                            const agent = agents.find(a => a.wallet_address === row.counterparty);
                            return agent ? (
                              <span className="mono text-[10px] px-1 py-0.5 rounded" style={{ background: "var(--surface-2)", color: Number(agent.rep_total) >= 4 ? "var(--positive)" : "var(--t3)" }}>
                                ★ {Number(agent.rep_total).toFixed(1)}
                              </span>
                            ) : null;
                          })()}
                        </div>
                      )}
                    </div>

                    {/* Settlement */}
                    <div>
                      <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Settlement</span>
                      {row.trade ? (
                        <>
                          {row.trade.taker_tx_hash ? (
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] w-16" style={{ color: "var(--t3)" }}>Taker TX:</span>
                              {(() => { const url = txUrl(row.trade.taker_tx_hash!, row.trade.source_chain); return url ? (
                                <a href={url} target="_blank" rel="noopener" className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                                  {row.trade.taker_tx_hash!.slice(0, 10)}… ↗
                                </a>
                              ) : null; })()}
                            </div>
                          ) : null}
                          {row.trade.maker_tx_hash ? (
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] w-16" style={{ color: "var(--t3)" }}>Maker TX:</span>
                              {(() => { const url = txUrl(row.trade.maker_tx_hash!, row.trade.dest_chain); return url ? (
                                <a href={url} target="_blank" rel="noopener" className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                                  {row.trade.maker_tx_hash!.slice(0, 10)}… ↗
                                </a>
                              ) : null; })()}
                            </div>
                          ) : null}
                          {row.trade.settle_ms && (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] w-16" style={{ color: "var(--t3)" }}>Duration:</span>
                              <span className="mono text-[13px] font-semibold" style={{ color: "var(--positive)" }}>{(row.trade.settle_ms / 1000).toFixed(1)}s</span>
                            </div>
                          )}
                          {row.status === "open" && (
                            <span className="text-[11px]" style={{ color: "var(--t3)" }}>Awaiting settlement</span>
                          )}
                        </>
                      ) : (
                        <span className="text-[11px]" style={{ color: "var(--t3)" }}>
                          {row.status === "cancelled" ? "RFQ cancelled before settlement" : "No settlement data"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Audit Trail */}
                  {row.type === "trade" && (
                    <AuditTrailMini tradeId={row.id} supraAddr={supraAddress || undefined} />
                  )}

                  {/* Quote History */}
                  {row.tradeQuotes && row.tradeQuotes.length > 0 && (
                    <div>
                      <span className="mono text-[10px] uppercase tracking-wider block mb-1.5" style={{ color: "var(--t3)" }}>
                        Quote History ({row.tradeQuotes.length} quote{row.tradeQuotes.length !== 1 ? "s" : ""})
                      </span>
                      <div className="rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                        {row.tradeQuotes.map((q, qi) => {
                          const askP = (row.rfqForTrade || row.rfq)?.reference_price;
                          const qDiff = askP && askP > 0 ? ((q.rate - askP) / askP) * 100 : null;
                          return (
                            <div key={q.id} className="flex items-center gap-4 px-4 py-2"
                              style={{ borderBottom: qi < row.tradeQuotes!.length - 1 ? "1px solid var(--border)" : "none", background: q.status === "accepted" ? "rgba(16,185,129,0.04)" : "transparent" }}>
                              <span className="mono text-[12px] w-36" style={{ color: "var(--t2)" }}>{shortAddr(q.maker_address)}</span>
                              <span className="mono text-[13px] w-32" style={{ color: "var(--t1)" }}>{fmtRate(q.rate)} {quoteClean}</span>
                              {qDiff !== null && (
                                <span className="mono text-[11px] w-20" style={{ color: qDiff >= 0 ? "var(--positive)" : "var(--negative)" }}>
                                  {qDiff >= 0 ? "+" : ""}{qDiff.toFixed(2)}%
                                </span>
                              )}
                              <span className={`tag tag-${q.status}`}>{q.status}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
