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
  if (addr.length > 16) return addr.slice(0, 6) + "..." + addr.slice(-4);
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

// --- Event Chain (replaces old AuditTrailMini) ---
function AuditTrail({ tradeId, supraAddr }: { tradeId: string; supraAddr?: string }) {
  const [events, setEvents] = useState<any[]>([]);
  const [votes, setVotes] = useState<any[]>([]);
  const [signedActions, setSignedActions] = useState<any[]>([]);
  const [attestation, setAttestation] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    fetch(`/api/council-events?tradeId=${tradeId}`)
      .then(r => r.json())
      .then(data => {
        setEvents(data.events || []);
        setVotes(data.votes || []);
        setSignedActions(data.signedActions || []);
        setAttestation(data.attestation || null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded, tradeId]);

  const eventLabel: Record<string, string> = {
    rfq_registered: "RFQ Registered", quote_registered: "Quote Registered",
    quote_withdrawn: "Quote Withdrawn", rfq_cancelled: "RFQ Cancelled",
    match_confirmed: "Match Confirmed", taker_tx_verified: "Taker TX Verified",
    maker_tx_verified: "Maker TX Verified", taker_timed_out: "Taker Timed Out",
    maker_defaulted: "Maker Defaulted", settlement_attested: "Settlement Attested",
  };

  const eventColor: Record<string, string> = {
    rfq_registered: "var(--accent-light)", quote_registered: "var(--warn)",
    quote_withdrawn: "var(--t3)", rfq_cancelled: "var(--negative)",
    match_confirmed: "var(--positive)", taker_tx_verified: "#8b5cf6",
    maker_tx_verified: "#8b5cf6", taker_timed_out: "var(--negative)",
    maker_defaulted: "var(--negative)", settlement_attested: "var(--positive)",
  };

  const getVotesForEvent = (eventId: string) => votes.filter((v: any) => v.event_id === eventId);

  const getSignedAction = (eventType: string) => {
    const m: Record<string, string> = {
      rfq_registered: "submit_rfq", quote_registered: "place_quote",
      match_confirmed: "accept_quote", taker_tx_verified: "confirm_taker_tx", maker_tx_verified: "confirm_maker_tx"
    };
    return m[eventType] ? signedActions.find((a: any) => a.action_type === m[eventType]) : null;
  };

  const nodes = ["N-1", "N-2", "N-3", "N-4", "N-5"];

  return (
    <div className="mt-3">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[12px] mono transition-colors"
        style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>
        <span style={{ fontSize: 8 }}>{open ? "v" : ">"}</span>
        Event Chain {loaded ? `(${events.length} events)` : "(click to load)"}
      </button>
      {open && (
        <div className="mt-2 rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {!loaded ? (
            <div className="px-3 py-2 text-[12px]" style={{ color: "var(--t3)" }}>Loading...</div>
          ) : events.length === 0 ? (
            <div className="px-3 py-2 text-[12px]" style={{ color: "var(--t3)" }}>No council events recorded.</div>
          ) : (
            <div>
              {events.map((evt: any, i: number) => {
                const timeStr = new Date(evt.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                const evtVotes = getVotesForEvent(evt.id);
                const approvals = evtVotes.filter((v: any) => v.decision === "approve").length;
                const isExpanded = expandedEvent === evt.id;
                const userAction = getSignedAction(evt.event_type);
                const isTerminal = ["taker_timed_out", "maker_defaulted", "settlement_attested", "rfq_cancelled"].includes(evt.event_type);
                return (
                  <div key={evt.id} style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                    <div
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-white/[0.02] transition-colors"
                      onClick={() => setExpandedEvent(isExpanded ? null : evt.id)}
                      style={{ background: isTerminal ? "rgba(239,68,68,0.03)" : "transparent" }}>
                      <span className="mono text-[10px] w-6 shrink-0 text-center font-bold" style={{ color: "var(--t3)" }}>#{evt.sequence_number}</span>
                      <span className="mono text-[11px] w-20 shrink-0" style={{ color: "var(--t3)" }}>{timeStr}</span>
                      <span className="text-[12px] w-40 shrink-0 font-semibold" style={{ color: eventColor[evt.event_type] || "var(--t2)" }}>
                        {eventLabel[evt.event_type] || evt.event_type.replace(/_/g, " ")}
                      </span>
                      <div className="flex items-center gap-2 flex-1 justify-end">
                        {evt.consensus_reached ? (
                          <span className="mono text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(34,197,94,0.1)", color: "var(--positive)" }}>{approvals}/5 ok</span>
                        ) : (
                          <span className="mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(234,179,8,0.1)", color: "var(--warn)" }}>{approvals}/5 pending</span>
                        )}
                        {evt.deadline_type && (
                          <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--t3)" }}>
                            {evt.deadline_type === "taker_send" ? "taker timer" : "maker timer"}
                          </span>
                        )}
                        <span className="text-[10px]" style={{ color: "var(--t3)" }}>{isExpanded ? "^" : "v"}</span>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="px-4 py-3 space-y-3" style={{ background: "var(--bg)", borderTop: "1px solid var(--border)" }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-1">
                            <span className="mono text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Event Hash:</span>
                            <span className="mono text-[10px] select-all" style={{ color: "var(--t2)" }}>{evt.event_hash.slice(0, 24)}...</span>
                          </div>
                          {evt.previous_event_hash && (
                            <div className="flex items-center gap-1">
                              <span className="mono text-[9px]" style={{ color: "var(--t3)" }}>prev:</span>
                              <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>{evt.previous_event_hash.slice(0, 16)}...</span>
                            </div>
                          )}
                        </div>
                        {evt.payload && (
                          <div>
                            <span className="mono text-[9px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Payload</span>
                            <div className="text-[11px] mono px-2 py-1.5 rounded break-all" style={{ background: "var(--surface-2)", color: "var(--t2)" }}>
                              {(Object.entries(evt.payload) as Array<[string, any]>)
                                .filter(([k]) => !k.includes("signature") && !k.includes("SessionKey"))
                                .map(([k, v]) => (
                                  <div key={k}>
                                    <span style={{ color: "var(--t3)" }}>{k}:</span>{" "}
                                    {typeof v === "string" && v.length > 40 ? v.slice(0, 20) + "..." + v.slice(-8) : String(v)}
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                        {evt.deadline && (
                          <div className="flex items-center gap-2 text-[11px]">
                            <span style={{ color: "var(--t3)" }}>Deadline set:</span>
                            <span className="mono" style={{ color: "var(--warn)" }}>{new Date(evt.deadline).toLocaleTimeString()}</span>
                            <span style={{ color: "var(--t3)" }}>({evt.deadline_type})</span>
                          </div>
                        )}
                        <div>
                          <span className="mono text-[9px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Council Node Votes</span>
                          <div className="rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                            {nodes.map((nodeId, ni) => {
                              const vote = evtVotes.find((v: any) => v.node_id === nodeId);
                              return (
                                <div key={nodeId} className="flex items-center gap-3 px-3 py-1.5 text-[11px]"
                                  style={{ borderBottom: ni < 4 ? "1px solid var(--border)" : "none", background: vote?.decision === "approve" ? "rgba(16,185,129,0.03)" : "transparent" }}>
                                  <div className="flex items-center gap-1.5 w-10 shrink-0">
                                    <div className="w-1.5 h-1.5 rounded-full"
                                      style={{ background: vote ? (vote.decision === "approve" ? "var(--positive)" : "var(--negative)") : "var(--t3)", opacity: vote ? 1 : 0.3 }} />
                                    <span className="mono font-medium" style={{ color: "var(--t2)" }}>{nodeId}</span>
                                  </div>
                                  {vote ? (
                                    <>
                                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold"
                                        style={{ background: vote.decision === "approve" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)", color: vote.decision === "approve" ? "var(--positive)" : "var(--negative)" }}>
                                        {vote.decision.toUpperCase()}
                                      </span>
                                      <span className="mono text-[10px] truncate flex-1" style={{ color: "var(--t3)" }}>sig: {vote.signature.slice(0, 20)}...</span>
                                      <span className="mono text-[10px] shrink-0" style={{ color: "var(--t3)" }}>
                                        {new Date(vote.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>pending</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        {userAction && (
                          <div>
                            <span className="mono text-[9px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>User Signature</span>
                            <div className="space-y-1 text-[10px]">
                              <div><span style={{ color: "var(--t3)" }}>Signer:</span> <span className="mono" style={{ color: "var(--t1)" }}>{userAction.signer_address}</span></div>
                              {userAction.signature && userAction.signature.length > 10 && (
                                <div><span style={{ color: "var(--t3)" }}>Sig:</span> <span className="mono break-all" style={{ color: "var(--positive)" }}>{userAction.signature}</span></div>
                              )}
                              {userAction.payload_hash && (
                                <div><span style={{ color: "var(--t3)" }}>Payload Hash:</span> <span className="mono" style={{ color: "var(--t2)" }}>{userAction.payload_hash}</span></div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {attestation && (
                <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border)", background: "rgba(34,197,94,0.03)" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="mono text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--positive)" }}>On-Chain Attestation</span>
                    <span className="mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.1)", color: "var(--positive)" }}>
                      {attestation.node_signatures?.length || 0} nodes signed
                    </span>
                    {attestation.posted_to_chain && (
                      <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.15)", color: "var(--positive)" }}>posted to Supra</span>
                    )}
                  </div>
                  <div className="space-y-1 text-[10px] mono">
                    <div><span style={{ color: "var(--t3)" }}>Chain Hash:</span> <span className="select-all" style={{ color: "var(--t1)" }}>{attestation.chain_hash}</span></div>
                    <div><span style={{ color: "var(--t3)" }}>Outcome:</span> <span style={{ color: attestation.outcome === "settled" ? "var(--positive)" : "var(--negative)" }}>{attestation.outcome}</span></div>
                    <div><span style={{ color: "var(--t3)" }}>Events:</span> <span style={{ color: "var(--t2)" }}>{attestation.event_summary?.length || 0}</span></div>
                    {attestation.attestation_tx_hash && (
                      <div>
                        <span style={{ color: "var(--t3)" }}>Supra TX: </span>
                        <a href={`https://testnet.suprascan.io/tx/${attestation.attestation_tx_hash.replace(/^0x/, "")}`}
                          target="_blank" rel="noopener" className="hover:underline" style={{ color: "var(--accent)" }}>
                          {attestation.attestation_tx_hash.slice(0, 24)}...
                        </a>
                      </div>
                    )}
                  </div>
                  {attestation.node_signatures?.length > 0 && (
                    <div className="mt-2">
                      <span className="mono text-[9px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Node Attestation Signatures</span>
                      <div className="space-y-0.5">
                        {attestation.node_signatures.map((ns: any) => (
                          <div key={ns.nodeId} className="flex items-center gap-2 text-[10px] mono">
                            <span className="w-8" style={{ color: "var(--positive)" }}>{ns.nodeId}</span>
                            <span className="truncate" style={{ color: "var(--t3)" }}>{ns.signature.slice(0, 32)}...</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
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

  const rows: HistoryRow[] = [];

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

  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (rows.length === 0) return null;

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
              * {Number(myAgent.rep_total).toFixed(1)} rep
            </span>
          )}
          <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>
            {supraAddress.slice(0, 8)}...{supraAddress.slice(-4)}
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

      {/* Table */}
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
          const quoteClean = row.pair.split("/")[1]?.replace("fx", "") || "";

          return (
            <div key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center gap-4 px-4 py-2.5 cursor-pointer hover:bg-white/[0.01] transition-colors"
                onClick={() => setExpanded(isExpanded ? null : row.id)}>
                <span className="mono text-[12px] w-24 shrink-0" style={{ color: "var(--t3)" }}>{row.txId}</span>
                <span className="text-[13px] font-semibold w-24 shrink-0">{pairClean}</span>
                <span className="mono text-[13px] w-20 shrink-0">{row.size}</span>
                <span className="mono text-[13px] w-28 shrink-0" style={{ color: "var(--t1)" }}>
                  {row.rate ? `${fmtRate(row.rate)} ${quoteClean}` : "--"}
                </span>
                <span className="text-[12px] w-14 shrink-0 font-medium" style={{ color: row.side === "Taker" ? "var(--accent)" : "var(--positive)" }}>{row.side}</span>
                <span className="mono text-[12px] w-28 shrink-0" style={{ color: "var(--t2)" }}>
                  {row.counterparty ? shortAddr(row.counterparty) : "--"}
                </span>
                <span className="text-[12px] w-40 shrink-0" style={{ color: "var(--t3)" }}>{row.sourceChain} to {row.destChain}</span>
                <span className="mono text-[12px] w-16 shrink-0" style={{ color: row.settleMs ? "var(--positive)" : "var(--t3)" }}>
                  {row.settleMs ? (row.settleMs / 1000).toFixed(1) + "s" : "--"}
                </span>
                <div className="flex items-center gap-2 flex-1 justify-end">
                  <span className={`tag tag-${row.status === "cancelled" ? "cancelled" : row.status === "open" ? "open_trade" : row.status}`}>
                    {row.status === "settled" ? "Settled"
                      : row.status === "cancelled" ? "Cancelled"
                      : row.status === "expired" ? "Expired"
                      : row.status === "failed" ? "Failed"
                      : row.status === "taker_timed_out" ? "Taker Timed Out"
                      : row.status === "maker_defaulted" ? "Maker Defaulted"
                      : row.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--t3)" }}>{isExpanded ? "^" : "v"}</span>
                </div>
              </div>

              {isExpanded && (
                <div className="px-6 pb-4 pt-1" style={{ background: "var(--bg-raised)", borderLeft: "3px solid var(--border)" }}>
                  <div className="grid grid-cols-3 gap-6 mb-3">
                    {/* Price */}
                    <div>
                      <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Price</span>
                      {(row.rfqForTrade || row.rfq) ? (() => {
                        const rfqRef = row.rfqForTrade || row.rfq;
                        const askingPrice = rfqRef?.reference_price;
                        const filledRate = row.trade?.rate || row.rate;
                        const priceDiff = askingPrice && filledRate && askingPrice > 0 ? ((filledRate - askingPrice) / askingPrice) * 100 : null;
                        return (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px]" style={{ color: "var(--t3)" }}>Asked:</span>
                              <span className="mono text-[13px]" style={{ color: "var(--t2)" }}>
                                {askingPrice ? `${fmtRate(askingPrice)} ${quoteClean}` : "--"}
                              </span>
                            </div>
                            {filledRate && row.type === "trade" && (
                              <div className="flex items-center gap-2">
                                <span className="text-[11px]" style={{ color: "var(--t3)" }}>Filled:</span>
                                <span className="mono text-[13px] font-semibold" style={{ color: "var(--t1)" }}>{fmtRate(filledRate)} {quoteClean}</span>
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
                          {row.rate ? `${fmtRate(row.rate)} ${quoteClean}` : "--"}
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
                              * {Number(agent.rep_total).toFixed(1)}
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
                                * {Number(agent.rep_total).toFixed(1)}
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
                              {(() => {
                                const url = txUrl(row.trade.taker_tx_hash!, row.trade.source_chain);
                                return url ? (
                                  <a href={url} target="_blank" rel="noopener" className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                                    {row.trade.taker_tx_hash!.slice(0, 10)}...
                                  </a>
                                ) : null;
                              })()}
                            </div>
                          ) : null}
                          {row.trade.maker_tx_hash ? (
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] w-16" style={{ color: "var(--t3)" }}>Maker TX:</span>
                              {(() => {
                                const url = txUrl(row.trade.maker_tx_hash!, row.trade.dest_chain);
                                return url ? (
                                  <a href={url} target="_blank" rel="noopener" className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                                    {row.trade.maker_tx_hash!.slice(0, 10)}...
                                  </a>
                                ) : null;
                              })()}
                            </div>
                          ) : null}
                          {row.trade.settle_ms ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] w-16" style={{ color: "var(--t3)" }}>Duration:</span>
                              <span className="mono text-[13px] font-semibold" style={{ color: "var(--positive)" }}>{(row.trade.settle_ms / 1000).toFixed(1)}s</span>
                            </div>
                          ) : null}
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

                  {/* Event Chain (replaces old Audit Trail) */}
                  {row.type === "trade" && (
                    <AuditTrail tradeId={row.id} supraAddr={supraAddress || undefined} />
                  )}

                  {/* Quote History */}
                  {row.tradeQuotes && row.tradeQuotes.length > 0 && (
                    <div className="mt-3">
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
