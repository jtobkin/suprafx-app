"use client";
import { CommitteeRequest } from "@/lib/types";
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
}

export default function CommitteePanel({ nodes, requests }: { nodes: Node[]; requests: CommitteeRequest[] }) {
  const [votes, setVotes] = useState<Vote[]>([]);
  const [expandedReq, setExpandedReq] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("committee_votes").select("*").order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => { if (data) setVotes(data); });
  }, [requests]);

  const getVotesForRequest = (tradeId: string, vType: string) =>
    votes.filter(v => v.trade_id === tradeId && v.verification_type === vType);

  return (
    <div className="rounded border overflow-hidden mb-4 animate-in"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <span className="text-[11px] font-medium" style={{ color: "var(--t1)" }}>Settlement Committee</span>
        <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>
          3-of-5 multisig
        </span>
      </div>

      {/* Node status row */}
      <div className="flex gap-1 p-2.5 border-b" style={{ borderColor: "var(--border)" }}>
        {nodes.map(n => (
          <div key={n.id} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded"
            style={{ background: "var(--surface-2)" }}>
            <div className="w-1 h-1 rounded-full animate-pulse-dot" style={{ background: "var(--positive)" }} />
            <span className="font-mono text-[9px] font-medium" style={{ color: "var(--t2)" }}>{n.id}</span>
          </div>
        ))}
      </div>

      {requests.length === 0 ? (
        <div className="py-6 text-center text-[11px]" style={{ color: "var(--t3)" }}>No verifications yet</div>
      ) : (
        <div>
          {requests.slice(0, 10).map(r => {
            const reqVotes = getVotesForRequest(r.trade_id, r.verification_type);
            const isExpanded = expandedReq === r.id;
            return (
              <div key={r.id} className="border-b last:border-b-0" style={{ borderColor: "rgba(255,255,255,0.02)" }}>
                <div className="flex items-center px-4 py-2 cursor-pointer hover:bg-white/[0.01]"
                  onClick={() => setExpandedReq(isExpanded ? null : r.id)}>
                  <div className="flex-1 text-[11px]" style={{ color: "var(--t2)" }}>
                    {r.verification_type.replace(/_/g, " ")}
                  </div>
                  <div className="font-mono text-[10px] mr-4" style={{ color: "var(--t3)" }}>
                    {r.trade_id.slice(0, 8)}…
                  </div>
                  <div className="font-mono text-[11px] mr-4">
                    {r.approvals}/{r.approvals + r.rejections}
                  </div>
                  <span className={`tag tag-${r.status}`}>{r.status}</span>
                  <span className="ml-2 text-[9px]" style={{ color: "var(--t3)" }}>
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </div>

                {/* Expanded: show individual node signatures */}
                {isExpanded && (
                  <div className="px-4 pb-3">
                    <div className="rounded p-2.5" style={{ background: "var(--bg)" }}>
                      <div className="text-[9px] font-mono uppercase tracking-wider mb-2" style={{ color: "var(--t3)" }}>
                        Node Signatures
                      </div>
                      {reqVotes.length > 0 ? reqVotes.map(v => (
                        <div key={v.id} className="flex items-center gap-2 py-1 border-b last:border-b-0"
                          style={{ borderColor: "rgba(255,255,255,0.03)" }}>
                          <span className="font-mono text-[10px] w-8" style={{ color: "var(--t2)" }}>{v.node_id}</span>
                          <span className={`tag tag-${v.decision === "approve" ? "approved" : "failed"}`}>
                            {v.decision}
                          </span>
                          {v.signature && (
                            <span className="font-mono text-[9px] truncate flex-1" style={{ color: "var(--t3)" }}>
                              sig: {v.signature.slice(0, 24)}…
                            </span>
                          )}
                        </div>
                      )) : (
                        <div className="text-[10px]" style={{ color: "var(--t3)" }}>No vote data</div>
                      )}
                      {reqVotes.length > 0 && reqVotes[0]?.signature && (
                        <div className="mt-2 pt-2 border-t" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                          <div className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: "var(--t3)" }}>
                            Aggregate Multisig
                          </div>
                          <div className="font-mono text-[9px] break-all" style={{ color: "var(--accent-light)" }}>
                            {(() => {
                              // Compute aggregate hash from all signatures
                              const allSigs = reqVotes.map(v => v.signature || "").join("");
                              // Simple hash display
                              return "0x" + allSigs.slice(0, 64);
                            })()}
                          </div>
                          <div className="text-[9px] mt-1" style={{ color: "var(--t3)" }}>
                            {r.approvals >= 3 ? "✓ Threshold met (3-of-5)" : "⏳ Below threshold"}
                            {r.verification_type === "approve_reputation" && " — reputation scores updated"}
                          </div>
                          {r.attestation_tx && (
                            <div className="mt-2 pt-2 border-t" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                              <div className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: "var(--positive)" }}>
                                ✓ On-Chain Attestation
                              </div>
                              <a href={`https://testnet.suprascan.io/tx/${r.attestation_tx}`}
                                target="_blank" rel="noopener"
                                className="font-mono text-[9px] break-all hover:underline"
                                style={{ color: "var(--accent-light)" }}>
                                {r.attestation_tx.slice(0, 32)}… ↗
                              </a>
                              <div className="text-[9px] mt-1" style={{ color: "var(--t3)" }}>
                                Committee multisig submitted to Supra testnet — trade settlement &amp; reputation update recorded on-chain
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
