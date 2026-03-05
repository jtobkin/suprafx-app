"use client";
import { CommitteeRequest, Trade, RFQ } from "@/lib/types";
import { generateTxId } from "@/lib/tx-id";
import { supabase } from "@/lib/supabase";
import { useState, useEffect } from "react";

interface Node { id: string; status: string; }

interface Vote {
  id: string;
  trade_id: string;
  node_id: string;
  verification_type: string;
  decision: string;
  signature: string | null;
  tx_hash: string | null;
  created_at: string;
}

function fmtRate(n: number) {
  if (n >= 1000) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function displayPair(pair: string) { return pair.replace(/fx/g, ""); }

// Group committee requests by trade_id
interface TradeGroup {
  tradeId: string;
  txId: string;
  trade: Trade | undefined;
  requests: CommitteeRequest[];
}

interface Props {
  nodes: Node[];
  requests: CommitteeRequest[];
  trades: Trade[];
  rfqs: RFQ[];
}

export default function CommitteePanel({ nodes, requests, trades, rfqs }: Props) {
  const [votes, setVotes] = useState<Vote[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    // Fetch via server API to bypass any RLS issues
    fetch("/api/committee")
      .then(r => r.json())
      .then(data => {
        if (data.votes) setVotes(data.votes);
      })
      .catch(() => {
        // Fallback to direct Supabase
        supabase.from("committee_votes").select("*").order("created_at", { ascending: false }).limit(200)
          .then(({ data }) => { if (data) setVotes(data); });
      });
  }, [requests]);

  // Group requests by trade
  const groupMap = new Map<string, TradeGroup>();
  for (const req of requests) {
    if (!groupMap.has(req.trade_id)) {
      const trade = trades.find(t => t.id === req.trade_id);
      const rfq = trade ? rfqs.find(r => r.id === trade.rfq_id) : undefined;
      const txId = rfq ? generateTxId(rfq.display_id, rfq.taker_address) : req.trade_id.slice(0, 12);
      groupMap.set(req.trade_id, { tradeId: req.trade_id, txId, trade, requests: [] });
    }
    groupMap.get(req.trade_id)!.requests.push(req);
  }

  const groups = Array.from(groupMap.values()).sort((a, b) => {
    const aTime = a.requests[0]?.created_at || "";
    const bTime = b.requests[0]?.created_at || "";
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  const getVotesForRequest = (tradeId: string, vType: string) =>
    votes.filter(v => v.trade_id === tradeId && v.verification_type === vType);

  return (
    <div className="card mb-4 animate-in">
      <div className="card-header">
        <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>Settlement Council</span>
        <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>
          3-of-5 multisig
        </span>
      </div>

      {/* Node status bar */}
      <div className="flex gap-1 px-3 py-2 border-b" style={{ borderColor: "var(--border)" }}>
        {nodes.map(n => (
          <div key={n.id} className="flex-1 flex items-center justify-center gap-1.5 py-1 rounded"
            style={{ background: "var(--surface-2)" }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: "var(--positive)" }} />
            <span className="mono text-[11px] font-medium" style={{ color: "var(--t2)" }}>{n.id}</span>
          </div>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="py-6 text-center text-[13px]" style={{ color: "var(--t3)" }}>No verifications yet</div>
      ) : (
        <>
          {/* Header row */}
          <div className="flex items-center gap-4 px-4 py-1.5" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
            <span className="mono text-[10px] uppercase tracking-wider font-medium w-24 shrink-0" style={{ color: "var(--t3)" }}>TX ID</span>
            <span className="mono text-[10px] uppercase tracking-wider font-medium w-24 shrink-0" style={{ color: "var(--t3)" }}>Pair</span>
            <span className="mono text-[10px] uppercase tracking-wider font-medium w-20 shrink-0" style={{ color: "var(--t3)" }}>Size</span>
            <span className="mono text-[10px] uppercase tracking-wider font-medium w-24 shrink-0" style={{ color: "var(--t3)" }}>Rate</span>
            <span className="mono text-[10px] uppercase tracking-wider font-medium flex-1" style={{ color: "var(--t3)" }}>Route</span>
            <span className="mono text-[10px] uppercase tracking-wider font-medium w-24 shrink-0" style={{ color: "var(--t3)" }}>Consensus</span>
            <span className="mono text-[10px] uppercase tracking-wider font-medium shrink-0" style={{ color: "var(--t3)" }}>Status</span>
          </div>

          <div>
            {groups.map(g => {
              const isExpanded = expanded === g.tradeId;
              const t = g.trade;
              const pairClean = t ? displayPair(t.pair) : "—";
              const [, quote] = t ? t.pair.split("/") : ["", ""];
              const quoteClean = quote?.replace("fx", "") || "";

              // Aggregate consensus across all requests for this trade
              const totalApprovals = Math.max(...g.requests.map(r => r.approvals), 0);
              const totalNodes = 5;
              const overallStatus = g.requests.some(r => r.status === "approved") ? "approved"
                : g.requests.some(r => r.status === "rejected") ? "rejected" : "pending";
              const attestationTx = g.requests.find(r => r.attestation_tx)?.attestation_tx;

              return (
                <div key={g.tradeId} style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-4 px-4 py-2.5 cursor-pointer hover:bg-white/[0.01] transition-colors"
                    onClick={() => setExpanded(isExpanded ? null : g.tradeId)}>
                    <span className="mono text-[12px] w-24 shrink-0" style={{ color: "var(--t3)" }}>{g.txId}</span>
                    <span className="text-[13px] font-semibold w-24 shrink-0">{pairClean}</span>
                    <span className="mono text-[13px] w-20 shrink-0">{t ? t.size : "—"}</span>
                    <span className="mono text-[13px] w-24 shrink-0" style={{ color: "var(--t1)" }}>
                      {t ? `${fmtRate(t.rate)} ${quoteClean}` : "—"}
                    </span>
                    <span className="text-[12px] flex-1" style={{ color: "var(--t3)" }}>
                      {t ? `${t.source_chain} → ${t.dest_chain}` : "—"}
                    </span>
                    <span className="mono text-[13px] w-24 shrink-0 font-semibold" style={{ color: totalApprovals >= 3 ? "var(--positive)" : "var(--warn)" }}>
                      {totalApprovals}/{totalNodes}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`tag tag-${overallStatus}`}>{overallStatus}</span>
                      <span className="text-[10px]" style={{ color: "var(--t3)" }}>{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-6 pb-4 pt-1" style={{ background: "var(--bg-raised)" }}>
                      {/* Verification steps */}
                      {g.requests.map(req => {
                        const reqVotes = getVotesForRequest(req.trade_id, req.verification_type);
                        return (
                          <div key={req.id} className="mb-3 last:mb-0">
                            <div className="flex items-center justify-between mb-2">
                              <span className="mono text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--t2)" }}>
                                {req.verification_type.replace(/_/g, " ")}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="mono text-[12px]" style={{ color: req.approvals >= 3 ? "var(--positive)" : "var(--t3)" }}>
                                  {req.approvals} of {req.threshold} required
                                </span>
                                <span className={`tag tag-${req.status}`}>{req.status}</span>
                              </div>
                            </div>

                            {/* Node votes grid */}
                            <div className="rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                              {nodes.map((node, ni) => {
                                const vote = reqVotes.find(v => v.node_id === node.id);
                                return (
                                  <div key={node.id} className="flex items-center gap-3 px-4 py-2"
                                    style={{ borderBottom: ni < nodes.length - 1 ? "1px solid var(--border)" : "none",
                                      background: vote?.decision === "approve" ? "rgba(16,185,129,0.03)" : "transparent" }}>
                                    <div className="flex items-center gap-1.5 w-12 shrink-0">
                                      <div className="w-1.5 h-1.5 rounded-full"
                                        style={{ background: vote ? (vote.decision === "approve" ? "var(--positive)" : "var(--negative)") : "var(--t3)", opacity: vote ? 1 : 0.3 }} />
                                      <span className="mono text-[12px] font-medium" style={{ color: "var(--t2)" }}>{node.id}</span>
                                    </div>
                                    <span className="w-16 shrink-0">
                                      {vote ? (
                                        <span className={`tag tag-${vote.decision === "approve" ? "approved" : "failed"}`}>{vote.decision}</span>
                                      ) : (
                                        <span className="mono text-[11px]" style={{ color: "var(--t3)" }}>pending</span>
                                      )}
                                    </span>
                                    {vote?.signature && (
                                      <span className="mono text-[11px] truncate flex-1" style={{ color: "var(--t3)" }}>
                                        sig: {vote.signature.slice(0, 20)}…
                                      </span>
                                    )}
                                    {vote?.created_at && (
                                      <span className="mono text-[10px] shrink-0" style={{ color: "var(--t3)" }}>
                                        {new Date(vote.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      {/* Attestation TX */}
                      {attestationTx && (
                        <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                          <div className="flex items-center gap-2">
                            <span className="mono text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--positive)" }}>
                              On-Chain Attestation
                            </span>
                            <a href={`https://testnet.suprascan.io/tx/${attestationTx.replace(/^0x/, "")}`}
                              target="_blank" rel="noopener"
                              className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                              {attestationTx.slice(0, 20)}… ↗
                            </a>
                          </div>
                          <div className="text-[11px] mt-1" style={{ color: "var(--t3)" }}>
                            Multisig attestation recorded on Supra testnet
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
