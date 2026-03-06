"use client";
// BUILD_VERSION: ui-restructure-v1
import { useState, useEffect, useRef } from "react";
import { useWallet } from "./WalletProvider";
import { RFQ, Trade, Quote, Agent } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { generateTxId } from "@/lib/tx-id";

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


// --- Settlement Components (from TradeFlow) ---
const STEPS = ["open", "taker_sent", "taker_verified", "maker_sent", "maker_verified", "settled"];
const LABELS = ["Matched", "Taker Sending", "Taker Verified", "Maker Sending", "Maker Verified", "Settled"];
const TIMEOUT_STATUSES = ["taker_timed_out", "maker_defaulted"];
function stepIdx(s: string) {
  if (s === "taker_timed_out") return 1;
  if (s === "maker_defaulted") return 3;
  const i = STEPS.indexOf(s);
  return i >= 0 ? i : 0;
}

function Progress({ status }: { status: string }) {
  const cur = stepIdx(status);
  const isTimeout = TIMEOUT_STATUSES.includes(status);
  const isFailed = status === "failed";
  return (
    <div className="flex items-center gap-1 my-3">
      {STEPS.map((s, i) => (
        <div key={s} className="flex flex-col items-center flex-1">
          <div className="w-full h-[3px] rounded-full transition-all duration-700"
            style={{
              background: (isFailed || isTimeout) && i === cur ? "var(--negative)"
                : i < cur ? "var(--positive)"
                : i === cur ? "var(--accent)"
                : "var(--surface-3)",
            }} />
          <span className="font-mono text-[8px] uppercase tracking-wider mt-1"
            style={{
              color: (isFailed || isTimeout) && i === cur ? "var(--negative)"
                : i < cur ? "var(--positive)"
                : i === cur ? "var(--accent-light)"
                : "var(--t3)",
            }}>
            {isTimeout && i === cur
              ? (status === "taker_timed_out" ? "Taker Timeout" : "Maker Default")
              : LABELS[i]}
          </span>
        </div>
      ))}
    </div>
  );
}

function Spinner({ color = "currentColor" }: { color?: string }) {
  return <div className="w-2.5 h-2.5 rounded-full border-[1.5px] animate-spin" style={{ borderColor: color, borderTopColor: "transparent" }} />;
}

function LogLine({ time, text, color }: { time: string; text: string; color?: string }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="font-mono text-[13px] shrink-0" style={{ color: "var(--t3)" }}>{time}</span>
      <span className="text-[13px]" style={{ color: color || "var(--t2)" }}>{text}</span>
    </div>
  );
}

function InlineTimer({ deadline }: { deadline: string }) {
  const [remaining, setRemaining] = useState<number>(Math.max(0, new Date(deadline).getTime() - Date.now()));

  useEffect(() => {
    const iv = setInterval(() => {
      setRemaining(Math.max(0, new Date(deadline).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(iv);
  }, [deadline]);

  const totalSec = Math.floor(remaining / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const isExpired = remaining <= 0;
  const isWarn = remaining < 5 * 60 * 1000 && remaining > 0;
  const color = isExpired ? "var(--negative)" : isWarn ? "var(--warn)" : "var(--t3)";

  return (
    <span className="mono text-[10px] font-bold tabular-nums" style={{ color }}>
      {isExpired ? "EXPIRED" : `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`}
    </span>
  );
}

function CountdownTimer({ deadline, label, penaltyWarning }: { deadline: string | null; label: string; penaltyWarning?: string }) {
  const [remaining, setRemaining] = useState<number>(deadline ? Math.max(0, new Date(deadline).getTime() - Date.now()) : -1);

  useEffect(() => {
    if (!deadline) return;
    const calc = () => Math.max(0, new Date(deadline).getTime() - Date.now());
    setRemaining(calc());
    const iv = setInterval(() => setRemaining(calc()), 1000);
    return () => clearInterval(iv);
  }, [deadline]);

  if (!deadline || remaining === -1) return null;

  const totalSec = Math.floor(remaining / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const isWarning = remaining < 5 * 60 * 1000 && remaining > 0;
  const isCritical = remaining < 60 * 1000 && remaining > 0;
  const isExpired = remaining <= 0;
  const color = isExpired ? "var(--negative)" : isCritical ? "var(--negative)" : isWarning ? "var(--warn)" : "var(--t2)";
  const bgColor = isExpired ? "rgba(239,68,68,0.08)" : isCritical ? "rgba(239,68,68,0.06)" : isWarning ? "rgba(234,179,8,0.06)" : "var(--surface-2)";

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-md mb-2" style={{ background: bgColor, border: isWarning || isCritical || isExpired ? `1px solid ${color}20` : "none" }}>
      <div className="flex items-center gap-2 flex-1">
        <span className="text-[12px]" style={{ color: "var(--t3)" }}>{label}</span>
        <span className="mono text-[15px] font-bold tabular-nums" style={{ color }}>
          {isExpired ? "EXPIRED" : `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`}
        </span>
      </div>
      {penaltyWarning && (isWarning || isCritical) && !isExpired && (
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${color}15`, color }}>{penaltyWarning}</span>
      )}
      {isExpired && (
        <span className="text-[11px]" style={{ color: "var(--negative)" }}>Processing timeout...</span>
      )}
    </div>
  );
}

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
    const m: Record<string, string> = { rfq_registered: "submit_rfq", quote_registered: "place_quote", match_confirmed: "accept_quote", taker_tx_verified: "confirm_taker_tx", maker_tx_verified: "confirm_maker_tx" };
    return m[eventType] ? signedActions.find((a: any) => a.action_type === m[eventType]) : null;
  };

  const nodes = ["N-1", "N-2", "N-3", "N-4", "N-5"];

  return (
    <div className="mt-3">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-[12px] mono transition-colors" style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>
        <span style={{ fontSize: 8 }}>{open ? "\u25bc" : "\u25b6"}</span>
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
                    <div className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-white/[0.02] transition-colors" onClick={() => setExpandedEvent(isExpanded ? null : evt.id)} style={{ background: isTerminal ? "rgba(239,68,68,0.03)" : "transparent" }}>
                      <span className="mono text-[10px] w-6 shrink-0 text-center font-bold" style={{ color: "var(--t3)" }}>#{evt.sequence_number}</span>
                      <span className="mono text-[11px] w-20 shrink-0" style={{ color: "var(--t3)" }}>{timeStr}</span>
                      <span className="text-[12px] w-40 shrink-0 font-semibold" style={{ color: eventColor[evt.event_type] || "var(--t2)" }}>{eventLabel[evt.event_type] || evt.event_type.replace(/_/g, " ")}</span>
                      <div className="flex items-center gap-2 flex-1 justify-end">
                        {evt.consensus_reached ? (
                          <span className="mono text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(34,197,94,0.1)", color: "var(--positive)" }}>{approvals}/5 &#x2713;</span>
                        ) : (
                          <span className="mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(234,179,8,0.1)", color: "var(--warn)" }}>{approvals}/5 pending</span>
                        )}
                        {evt.deadline_type && <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--t3)" }}>{evt.deadline_type === "taker_send" ? "taker timer" : "maker timer"}</span>}
                        <span className="text-[10px]" style={{ color: "var(--t3)" }}>{isExpanded ? "\u25b2" : "\u25bc"}</span>
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
                              <span className="mono text-[9px]" style={{ color: "var(--t3)" }}>&#x2190; prev:</span>
                              <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>{evt.previous_event_hash.slice(0, 16)}...</span>
                            </div>
                          )}
                        </div>
                        {evt.payload && (
                          <div>
                            <span className="mono text-[9px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Payload</span>
                            <div className="text-[11px] mono px-2 py-1.5 rounded break-all" style={{ background: "var(--surface-2)", color: "var(--t2)" }}>
                              {Object.entries(evt.payload).filter(([k]: [string, any]) => !k.includes("signature") && !k.includes("SessionKey")).map(([k, v]: [string, any]) => (
                                <div key={k}><span style={{ color: "var(--t3)" }}>{k}:</span> {typeof v === "string" && v.length > 40 ? v.slice(0, 20) + "..." + v.slice(-8) : String(v)}</div>
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
                                <div key={nodeId} className="flex items-center gap-3 px-3 py-1.5 text-[11px]" style={{ borderBottom: ni < 4 ? "1px solid var(--border)" : "none", background: vote?.decision === "approve" ? "rgba(16,185,129,0.03)" : "transparent" }}>
                                  <div className="flex items-center gap-1.5 w-10 shrink-0">
                                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: vote ? (vote.decision === "approve" ? "var(--positive)" : "var(--negative)") : "var(--t3)", opacity: vote ? 1 : 0.3 }} />
                                    <span className="mono font-medium" style={{ color: "var(--t2)" }}>{nodeId}</span>
                                  </div>
                                  {vote ? (
                                    <>
                                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{ background: vote.decision === "approve" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)", color: vote.decision === "approve" ? "var(--positive)" : "var(--negative)" }}>{vote.decision.toUpperCase()}</span>
                                      <span className="mono text-[10px] truncate flex-1" style={{ color: "var(--t3)" }}>sig: {vote.signature.slice(0, 20)}...</span>
                                      <span className="mono text-[10px] shrink-0" style={{ color: "var(--t3)" }}>{new Date(vote.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                                    </div>
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
                              {userAction.signature && userAction.signature.length > 10 && <div><span style={{ color: "var(--t3)" }}>Sig:</span> <span className="mono break-all" style={{ color: "var(--positive)" }}>{userAction.signature}</span></div>}
                              {userAction.payload_hash && <div><span style={{ color: "var(--t3)" }}>Payload Hash:</span> <span className="mono" style={{ color: "var(--t2)" }}>{userAction.payload_hash}</span></div>}
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
                    <span className="mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.1)", color: "var(--positive)" }}>{attestation.node_signatures?.length || 0} nodes signed</span>
                    {attestation.posted_to_chain && <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.15)", color: "var(--positive)" }}>posted to Supra</span>}
                  </div>
                  <div className="space-y-1 text-[10px] mono">
                    <div><span style={{ color: "var(--t3)" }}>Chain Hash:</span> <span className="select-all" style={{ color: "var(--t1)" }}>{attestation.chain_hash}</span></div>
                    <div><span style={{ color: "var(--t3)" }}>Outcome:</span> <span style={{ color: attestation.outcome === "settled" ? "var(--positive)" : "var(--negative)" }}>{attestation.outcome}</span></div>
                    <div><span style={{ color: "var(--t3)" }}>Events:</span> <span style={{ color: "var(--t2)" }}>{attestation.event_summary?.length || 0}</span></div>
                    {attestation.attestation_tx_hash && (
                      <div><span style={{ color: "var(--t3)" }}>Supra TX: </span><a href={`https://testnet.suprascan.io/tx/${attestation.attestation_tx_hash.replace(/^0x/, "")}`} target="_blank" rel="noopener" className="hover:underline" style={{ color: "var(--accent)" }}>{attestation.attestation_tx_hash.slice(0, 24)}... &#x2197;</a></div>
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

function ActiveTrade({ trade, onUpdate, rfq, tradeQuotes, agents, supraAddr }: { trade: Trade; onUpdate: () => void; rfq?: RFQ; tradeQuotes?: Quote[]; agents?: Agent[]; supraAddr?: string }) {
  const { profile, isDemo, sendSepoliaEth, sendSupraTokens, supraAddress, signAction } = useWallet();
  const [txHash, setTxHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<Array<{ time: string; text: string; color?: string }>>([]);


  const hasWallet = !!profile?.evmVerified && !isDemo;
  const hasSupraWallet = !!supraAddress && !isDemo;
  const isTaker = trade.taker_address === supraAddr;
  const isMaker = trade.maker_address === supraAddr;
  const isBot = trade.maker_address === "auto-maker-bot";

  const addLog = (text: string, color?: string) => {
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(prev => [...prev, { time, text, color }]);
  };

  // Chain display names
  const chainName = (c: string) => {
    if (c === "sepolia") return "Ethereum Sepolia";
    if (c === "supra-testnet") return "Supra Testnet";
    return c;
  };

  const confirmTx = async (side: "taker" | "maker", hash: string): Promise<any> => {
    const body: any = { tradeId: trade.id, txHash: hash, side };
    try {
      const signed = await signAction("confirm_" + side + "_tx", { tradeId: trade.id, txHash: hash });
      body.signedPayload = signed.payload;
      body.signature = signed.signature;
      body.payloadHash = signed.payloadHash;
      body.sessionNonce = signed.payload.sessionNonce;
      body.sessionPublicKey = signed.sessionPublicKey;
      body.sessionAuthSignature = signed.sessionAuthSignature;
      body.sessionNonce = signed.sessionNonce;
      body.sessionCreatedAt = signed.sessionCreatedAt;
      console.log("[SupraFX] TX confirm signed:", signed.payloadHash.slice(0, 16) + "...");
    } catch (e) { console.warn("[SupraFX] TX confirm signing failed:", e); }
    const res = await fetch("/api/confirm-tx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  // Determine which chain and wallet to use based on role
  const myChain = isTaker ? trade.source_chain : trade.dest_chain;
  const mySide: "taker" | "maker" = isTaker ? "taker" : "maker";
  const isEvmChain = myChain === "sepolia" || myChain === "ethereum";
  const isSupraChain = myChain === "supra-testnet" || myChain === "supra";
  const canSettle = isEvmChain ? hasWallet : isSupraChain ? hasSupraWallet : false;

  // Resolve recipient: use the settlement address for the target chain
  // Taker sends on source_chain TO maker's source_chain address (maker_settlement_address)
  // Maker sends on dest_chain TO taker's dest_chain address (taker_settlement_address)
  const [resolvedRecipient, setResolvedRecipient] = useState<string | null>(null);
  const [recipientLoading, setRecipientLoading] = useState(false);

  // Resolve counterparty's chain-specific address
  useEffect(() => {
    if (!isTaker && !isMaker) return;
    const storedAddr = isTaker
      ? (trade as any).maker_settlement_address
      : (trade as any).taker_settlement_address;

    // If we already have a valid settlement address for this chain, use it
    if (storedAddr && storedAddr.length > 10) {
      setResolvedRecipient(storedAddr);
      return;
    }

    // Otherwise, look up the counterparty's address for this chain via API
    const counterpartySupraAddr = isTaker ? trade.maker_address : trade.taker_address;
    setRecipientLoading(true);
    fetch(`/api/link-address?supra=${encodeURIComponent(counterpartySupraAddr)}`)
      .then(r => r.json())
      .then(data => {
        // Check linked_addresses first
        const links = data.links || [];
        const chainMatch = links.find((l: any) => l.chain === myChain);
        if (chainMatch) {
          setResolvedRecipient(chainMatch.linked_address);
        } else if (links.length > 0 && isEvmChain) {
          // Any EVM address works for any EVM chain
          setResolvedRecipient(links[0].linked_address);
        } else if (data.link?.evm_address && isEvmChain) {
          // Legacy table
          setResolvedRecipient(data.link.evm_address);
        } else if (isSupraChain) {
          // For Supra chains, the supra address IS the settlement address
          setResolvedRecipient(counterpartySupraAddr);
        } else {
          setResolvedRecipient(null);
        }
      })
      .catch(() => setResolvedRecipient(null))
      .finally(() => setRecipientLoading(false));
  }, [trade.id, isTaker, isMaker, myChain, isEvmChain, isSupraChain]);

  const recipient = resolvedRecipient;

  // Validate recipient address for the target chain
  const isValidRecipient = (() => {
    if (!recipient || recipient.startsWith("demo_")) return false;
    if (isEvmChain) return recipient.startsWith("0x") && recipient.length === 42;
    if (isSupraChain) return recipient.startsWith("0x") || /^[0-9a-fA-F]{64}$/.test(recipient);
    return false;
  })();

  // Send tokens on the appropriate chain
  const sendOnChain = async (): Promise<string> => {
    if (!recipient) throw new Error("No recipient address resolved");
    if (isEvmChain) {
      const toAddr = recipient.startsWith("0x") ? recipient : "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD1e";
      const valueWei = "0x" + BigInt(10000000000000).toString(16); // 0.00001 ETH
      return await sendSepoliaEth(toAddr, valueWei);
    } else if (isSupraChain) {
      const hash = await sendSupraTokens(recipient, 0.001); // 0.001 SUPRA
      return String(hash);
    }
    throw new Error("Unsupported chain: " + myChain);
  };

  // Block confirmation wait time per chain
  const blockWaitMs = isEvmChain ? 12000 : 3000;
  const blockWaitLabel = isEvmChain ? "Waiting for Ethereum block confirmation" : "Waiting for Supra block confirmation";

  // === SETTLE: Single function for both taker and maker ===
  const settle = async () => {
    setLoading(true);
    setLogs([]);

    if (!canSettle) {
      addLog("No wallet connected for " + chainName(myChain), "var(--negative)");
      setLoading(false);
      return;
    }

    if (!isValidRecipient) {
      addLog("Cannot settle: counterparty has no linked address on " + chainName(myChain) + ". They need to link a " + (isEvmChain ? "MetaMask or StarKey EVM" : "Supra") + " address in their Profile.", "var(--negative)");
      setLoading(false);
      return;
    }

    try {
      addLog("Settling on " + chainName(myChain) + "…");
      addLog("Requesting wallet signature…");

      const hash = await sendOnChain();
      addLog("TX broadcast: " + hash.slice(0, 20) + "…", "var(--accent-light)");

      addLog(blockWaitLabel + "…");
      await new Promise(r => setTimeout(r, blockWaitMs));

      addLog("Submitting to Settlement Council…");
      const result = await confirmTx(mySide, hash);

      if (result.status === "failed" || result.success === false) {
        addLog("Settlement failed: " + (result.error || "unknown"), "var(--negative)");
        onUpdate();
        setLoading(false);
        return;
      }

      if (result.autoSettled) {
        addLog("Council verified (5/5)", "var(--positive)");
        addLog("Maker bot auto-settled", "var(--accent-light)");
        if (result.makerTxHash) addLog("Maker TX: " + result.makerTxHash.slice(0, 24) + "…", "var(--accent-light)");
        addLog("Trade settled in " + (result.settleMs / 1000).toFixed(1) + "s", "var(--positive)");
      } else if (result.status === "settled") {
        addLog("Trade settled in " + (result.settleMs / 1000).toFixed(1) + "s", "var(--positive)");
      } else if (result.verified) {
        addLog("Council verified (5/5)", "var(--positive)");
        if (mySide === "taker") addLog("Waiting for maker to send…", "var(--t2)");
      } else {
        addLog("Council verifying…", "var(--warn)");
      }

      if (result.error && result.status !== "failed") {
        addLog("Warning: " + result.error, "var(--warn)");
      }

      onUpdate();
    } catch (e: any) {
      if (e.code === 4001 || e.message?.includes("rejected")) {
        addLog("Transaction rejected", "var(--negative)");
      } else {
        addLog("Error: " + (e.message || e), "var(--negative)");
      }
    }
    setLoading(false);
  };

  // === SUBMIT HASH: Paste a TX hash directly ===
  const submitHash = async () => {
    if (!txHash.trim()) return;
    setLoading(true);
    addLog("Submitting TX hash to Settlement Council…");
    const data = await confirmTx(mySide, txHash.trim());
    if (data.error) addLog("Error: " + data.error, "var(--negative)");
    else if (data.status === "settled") addLog("Trade settled!", "var(--positive)");
    else if (data.verified) addLog("Council verified (5/5)", "var(--positive)");
    else addLog("Council verifying…", "var(--warn)");
    setTxHash("");
    onUpdate();
    setLoading(false);
  };

  return (
    <div className="px-4 py-3 border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
      {/* Deal Summary */}
      {(() => {
        const [base, quote] = trade.pair.split("/");
        const baseClean = base.replace("fx", "");
        const quoteClean = quote.replace("fx", "");
        const pairClean = trade.pair.replace(/fx/g, "");
        const askingPrice = rfq?.reference_price;
        const priceDiff = askingPrice && askingPrice > 0 ? ((trade.rate - askingPrice) / askingPrice) * 100 : null;
        const notional = trade.size * trade.rate;
        const takerAgent = agents?.find(a => a.wallet_address === trade.taker_address);
        const makerAgent = agents?.find(a => a.wallet_address === trade.maker_address);
        const isMine = trade.taker_address === supraAddr;

        return (
          <div className="mb-3">
            <div className="grid grid-cols-3 gap-6 mb-3 px-1">
              <div>
                <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Price</span>
                {askingPrice ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: "var(--t3)" }}>Asked:</span>
                      <span className="mono text-[13px]" style={{ color: "var(--t2)" }}>
                        {askingPrice >= 1000 ? askingPrice.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : askingPrice >= 1 ? askingPrice.toFixed(4) : askingPrice.toFixed(6)} {quoteClean}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: "var(--t3)" }}>Filled:</span>
                      <span className="mono text-[13px] font-semibold" style={{ color: "var(--t1)" }}>
                        {trade.rate >= 1000 ? trade.rate.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : trade.rate >= 1 ? trade.rate.toFixed(4) : trade.rate.toFixed(6)} {quoteClean}
                      </span>
                      {priceDiff !== null && (
                        <span className="mono text-[11px]" style={{ color: priceDiff >= 0 ? "var(--positive)" : "var(--negative)" }}>
                          {priceDiff >= 0 ? "+" : ""}{priceDiff.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <span className="mono text-[13px] font-semibold" style={{ color: "var(--t1)" }}>
                    {trade.rate >= 1000 ? trade.rate.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : trade.rate >= 1 ? trade.rate.toFixed(4) : trade.rate.toFixed(6)} {quoteClean}
                  </span>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px]" style={{ color: "var(--t3)" }}>Notional:</span>
                  <span className="mono text-[13px]" style={{ color: "var(--positive)" }}>
                    {notional >= 1000 ? notional.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:4}) : notional.toFixed(4)} {quoteClean}
                  </span>
                </div>
              </div>

              <div>
                <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Counterparties</span>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] w-12" style={{ color: "var(--t3)" }}>Taker:</span>
                  <span className="mono text-[12px]" style={{ color: isMine ? "var(--accent)" : "var(--t2)" }}>
                    {isMine ? "You" : trade.taker_address.length > 16 ? trade.taker_address.slice(0,6) + "…" + trade.taker_address.slice(-4) : trade.taker_address}
                  </span>
                  {takerAgent && (
                    <span className="mono text-[10px] px-1 py-0.5 rounded" style={{ background: "var(--surface-2)", color: Number(takerAgent.rep_total) >= 4 ? "var(--positive)" : "var(--t3)" }}>
                      ★ {Number(takerAgent.rep_total).toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] w-12" style={{ color: "var(--t3)" }}>Maker:</span>
                  <span className="mono text-[12px]" style={{ color: "var(--t2)" }}>
                    {trade.maker_address === "auto-maker-bot" ? "SupraFX Bot" : trade.maker_address.length > 16 ? trade.maker_address.slice(0,6) + "…" + trade.maker_address.slice(-4) : trade.maker_address}
                  </span>
                  {makerAgent && (
                    <span className="mono text-[10px] px-1 py-0.5 rounded" style={{ background: "var(--surface-2)", color: Number(makerAgent.rep_total) >= 4 ? "var(--positive)" : "var(--t3)" }}>
                      ★ {Number(makerAgent.rep_total).toFixed(1)}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Settlement</span>
                {trade.taker_tx_hash ? (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px]" style={{ color: "var(--t3)" }}>Taker TX:</span>
                    <a href={trade.source_chain === "sepolia" ? `https://sepolia.etherscan.io/tx/${trade.taker_tx_hash}` : `https://testnet.suprascan.io/tx/${trade.taker_tx_hash.replace(/^0x/,"")}`}
                      target="_blank" rel="noopener" className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                      {trade.taker_tx_hash.slice(0,10)}… ↗
                    </a>
                  </div>
                ) : (
                  <div className="text-[11px] mb-1" style={{ color: "var(--t3)" }}>Awaiting taker settlement</div>
                )}
                {trade.maker_tx_hash && (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px]" style={{ color: "var(--t3)" }}>Maker TX:</span>
                    <a href={trade.dest_chain === "supra-testnet" ? `https://testnet.suprascan.io/tx/${trade.maker_tx_hash.replace(/^0x/,"")}` : `https://sepolia.etherscan.io/tx/${trade.maker_tx_hash}`}
                      target="_blank" rel="noopener" className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                      {trade.maker_tx_hash.slice(0,10)}… ↗
                    </a>
                  </div>
                )}
                {trade.settle_ms && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px]" style={{ color: "var(--t3)" }}>Duration:</span>
                    <span className="mono text-[13px] font-semibold" style={{ color: "var(--positive)" }}>{(trade.settle_ms / 1000).toFixed(1)}s</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      <Progress status={trade.status} />

      {/* === OPEN: Taker sends first === */}
      {trade.status === "open" && (
        <div>
          {/* Countdown timer */}
          {trade.taker_deadline && (
            <CountdownTimer
              deadline={trade.taker_deadline}
              label={isTaker ? "Your deadline:" : "Taker deadline:"}
              penaltyWarning={isTaker ? "-33% reputation" : undefined}
              />
          )}
          {isTaker ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <button onClick={settle} disabled={loading || !canSettle || recipientLoading || !isValidRecipient}
                  className="px-4 py-[7px] rounded text-[13px] font-semibold disabled:opacity-30 transition-all"
                  style={{ background: "var(--positive)", color: "#fff", border: "none" }}>
                  {loading ? "Settling…" : "Settle on " + chainName(myChain)}
                </button>
              </div>
              {!canSettle && (
                <div className="text-[12px] mb-2" style={{ color: "var(--warn)" }}>
                  {isEvmChain ? "Connect MetaMask or StarKey EVM to settle" : "Connect StarKey to settle"}
                </div>
              )}
              {canSettle && !recipientLoading && !isValidRecipient && (
                <div className="text-[12px] mb-2" style={{ color: "var(--warn)" }}>
                  Counterparty has not linked a {isEvmChain ? "Sepolia" : "Supra"} address yet
                </div>
              )}
              {recipientLoading && (
                <div className="text-[12px] mb-2" style={{ color: "var(--t3)" }}>
                  Resolving counterparty address...
                </div>
              )}
              {canSettle && !recipientLoading && !isValidRecipient && (
                <div className="text-[12px] mb-2" style={{ color: "var(--warn)" }}>
                  Counterparty has not linked a {isEvmChain ? "Sepolia" : "Supra"} address yet
                </div>
              )}
              {recipientLoading && (
                <div className="text-[12px] mb-2" style={{ color: "var(--t3)" }}>
                  Resolving counterparty address...
                </div>
              )}
              <div className="flex items-center gap-2">
                <input type="text" placeholder={"or paste TX hash…"} value={txHash}
                  onChange={e => setTxHash(e.target.value)}
                  className="flex-1 px-2.5 py-[5px] rounded border text-[14px] font-mono outline-none"
                  style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--t0)" }} />
                <button onClick={submitHash} disabled={loading || !txHash.trim()}
                  className="px-2.5 py-[5px] rounded text-[13px] font-medium disabled:opacity-30"
                  style={{ background: "var(--surface-3)", color: "var(--t1)", border: "none" }}>
                  Submit
                </button>
              </div>
            </>
          ) : isMaker ? (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--t2)" }}>
              <Spinner color="var(--accent)" />
              <span>Waiting for taker to settle on {chainName(trade.source_chain)}. You will be notified when it is your turn.</span>
            </div>
          ) : (
            <div className="text-[13px]" style={{ color: "var(--t3)" }}>Waiting for taker to settle…</div>
          )}
        </div>
      )}



      {/* === TAKER SENT (manual mode) === */}
      {trade.status === "taker_sent" && trade.taker_deadline && (
        <CountdownTimer
          deadline={trade.taker_deadline}
          label="Verification deadline:"
        />
      )}
      {trade.status === "taker_sent" && (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--t2)" }}>
          <Spinner color="var(--accent)" /> Committee verifying taker TX…
          {trade.taker_tx_hash?.startsWith("0x") && (
            <a href={`https://sepolia.etherscan.io/tx/${trade.taker_tx_hash}`} target="_blank"
              className="font-mono text-[14px] ml-1" style={{ color: "var(--accent-light)" }}>Etherscan ↗</a>
          )}
        </div>
      )}

      {/* === TAKER VERIFIED: Maker's turn === */}
      {trade.status === "taker_verified" && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[13px]" style={{ color: "var(--positive)" }}>Taker TX verified by Council.</span>
          </div>
          {/* Countdown timer */}
          {trade.maker_deadline && (
            <CountdownTimer
              deadline={trade.maker_deadline}
              label={isMaker ? "Your deadline:" : "Maker deadline:"}
              penaltyWarning={isMaker ? "-67% rep + deposit liquidated" : undefined}
              />
          )}
          {(isMaker || isBot) ? (
            <div>
              <div className="px-3 py-2 rounded mb-2" style={{ background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)" }}>
                <span className="text-[13px] font-semibold" style={{ color: "var(--accent-light)" }}>
                  Your turn — send {trade.size} {trade.pair.split("/")[1]?.replace("fx","")} on {chainName(trade.dest_chain)}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <button onClick={settle} disabled={loading || !canSettle || recipientLoading || !isValidRecipient}
                  className="px-4 py-[7px] rounded text-[13px] font-semibold disabled:opacity-30 transition-all"
                  style={{ background: "var(--positive)", color: "#fff", border: "none" }}>
                  {loading ? "Settling…" : "Settle on " + chainName(myChain)}
                </button>
              </div>
              {!canSettle && (
                <div className="text-[12px] mb-2" style={{ color: "var(--warn)" }}>
                  {isEvmChain ? "Connect MetaMask or StarKey EVM to settle" : "Connect StarKey to settle"}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input type="text" placeholder={"or paste TX hash…"} value={txHash}
                  onChange={e => setTxHash(e.target.value)}
                  className="flex-1 px-2.5 py-[5px] rounded border text-[14px] font-mono outline-none"
                  style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--t0)" }} />
                <button onClick={submitHash} disabled={loading || !txHash.trim()}
                  className="px-2.5 py-[5px] rounded text-[13px] font-medium disabled:opacity-30"
                  style={{ background: "var(--surface-3)", color: "var(--t1)", border: "none" }}>
                  Submit
                </button>
              </div>
            </div>
          ) : isTaker ? (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--t2)" }}>
              <Spinner color="var(--positive)" />
              <span>Waiting for maker to settle on {chainName(trade.dest_chain)}…</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--t2)" }}>
              <Spinner color="var(--positive)" />
              <span>Waiting for maker to settle…</span>
            </div>
          )}
        </div>
      )}

      {/* === MAKER SENT (manual mode) === */}
      {/* === MAKER SENT (manual mode) === */}
      {trade.status === "maker_sent" && trade.maker_deadline && (
        <CountdownTimer
          deadline={trade.maker_deadline}
          label="Verification deadline:"
        />
      )}
      {trade.status === "maker_sent" && (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--t2)" }}>
          <Spinner color="var(--positive)" /> Verifying maker TX on {chainName(trade.dest_chain)}…
        </div>
      )}

      {/* === FAILED === */}
      {trade.status === "failed" && (
        <div className="px-2.5 py-2 rounded text-[13px]" style={{ background: "rgba(239,68,68,0.06)", color: "var(--negative)" }}>
          Trade failed — check Vercel logs for details. The maker bot may not be funded or the Supra RPC may be down.
        </div>
      )}

      {/* === SETTLED === */}
      {trade.status === "settled" && (
        <div className="flex items-center gap-3">
          {trade.taker_tx_hash && (
            <a href={trade.source_chain === "sepolia"
              ? `https://sepolia.etherscan.io/tx/${trade.taker_tx_hash}`
              : `https://testnet.suprascan.io/tx/${trade.taker_tx_hash.replace(/^0x/, "")}`}
              target="_blank"
              className="font-mono text-[14px]" style={{ color: "var(--accent-light)" }}>Taker TX ({trade.source_chain.includes("sepolia") ? "Sepolia" : trade.source_chain.includes("supra") ? "Supra" : trade.source_chain}) ↗</a>
          )}
          {trade.maker_tx_hash && (
            <a href={trade.dest_chain === "supra-testnet"
              ? `https://testnet.suprascan.io/tx/${trade.maker_tx_hash.replace(/^0x/, "")}`
              : `https://sepolia.etherscan.io/tx/${trade.maker_tx_hash}`}
              target="_blank"
              className="font-mono text-[14px]" style={{ color: "var(--accent-light)" }}>Maker TX ({trade.dest_chain.includes("supra") ? "Supra" : trade.dest_chain.includes("sepolia") ? "Sepolia" : trade.dest_chain}) ↗</a>
          )}
        </div>
      )}

      {/* === Signed Actions Timeline === */}
      <AuditTrail tradeId={trade.id} supraAddr={supraAddr} />

      {/* === Activity Log === */}
      {logs.length > 0 && (
        <div className="mt-2 px-2.5 py-2 rounded max-h-36 overflow-y-auto" style={{ background: "var(--bg)" }}>
          {logs.map((l, i) => <LogLine key={i} {...l} />)}
        </div>
      )}
    </div>
  );
}

interface Props {
  rfqs: RFQ[];
  trades?: Trade[];
  quotes?: Quote[];
  agents?: Agent[];
  onAcceptQuote?: () => void;
  onUpdate?: () => void;
}

export default function OrderbookTable({ rfqs, trades, quotes = [], agents = [], onAcceptQuote, onUpdate }: Props) {
  const { supraAddress, signAction } = useWallet();
  const [expandedRfq, setExpandedRfq] = useState<string | null>(null);
  const [usdPrices, setUsdPrices] = useState<Record<string, number>>({});

  // Fetch USD prices for all tokens once
  useEffect(() => {
    const pairs = ["ETH/SUPRA", "fxUSDC/SUPRA", "fxAAVE/SUPRA", "fxLINK/SUPRA"];
    Promise.all(pairs.map(p =>
      fetch(`/api/oracle?pair=${encodeURIComponent(p)}`).then(r => r.json()).catch(() => null)
    )).then(results => {
      const prices: Record<string, number> = {};
      for (const d of results) {
        if (!d) continue;
        if (d.base?.token && d.base?.price) prices[d.base.token.replace("fx", "")] = d.base.price;
        if (d.quote?.token && d.quote?.price) prices[d.quote.token.replace("fx", "")] = d.quote.price;
      }
      // Stablecoins
      if (!prices["USDC"]) prices["USDC"] = 1;
      if (!prices["USDT"]) prices["USDT"] = 1;
      setUsdPrices(prices);
    });
  }, []);

  function toUsd(amount: number, token: string): string | null {
    const clean = token.replace("fx", "");
    const price = usdPrices[clean];
    if (!price || amount <= 0) return null;
    const total = amount * price;
    if (total >= 1) return "$" + total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return "$" + total.toFixed(4);
  }
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [expandedCompleted, setExpandedCompleted] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "mine">("all");
  const [completedFilter, setCompletedFilter] = useState<"all" | "mine">("all");
  const [accepting, setAccepting] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [quotingRfq, setQuotingRfq] = useState<string | null>(null);
  const [quotePrice, setQuotePrice] = useState("");
  const [quotingLoading, setQuotingLoading] = useState(false);
  const [makerVault, setMakerVault] = useState<any>(null);
  const [showDepositPrompt, setShowDepositPrompt] = useState(false);

  // Load maker vault balance
  useEffect(() => {
    if (!supraAddress) return;
    Promise.all([
      fetch(`/api/vault?address=${encodeURIComponent(supraAddress)}`).then(r => r.json()),
      fetch(`/api/maker-capacity?address=${encodeURIComponent(supraAddress)}`).then(r => r.json()).catch(() => null),
    ]).then(([vaultData, capData]) => {
      const bal = vaultData.balance;
      if (bal) {
        setMakerVault({
          ...bal,
          availableCapacity: capData?.availableCapacity ?? Number(bal.matching_limit || 0),
          totalEarmarked: capData?.totalEarmarked ?? 0,
        });
      }
    })
      .catch(() => {});
  }, [supraAddress]);
  const [attestations, setAttestations] = useState<Record<string, string>>({});

  const openRfqs = rfqs.filter(r => r.status === "open")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const terminalStatuses = ["settled", "failed", "taker_timed_out", "maker_defaulted", "cancelled"];
  const activeTrades = (trades || [])
    .filter(t => !terminalStatuses.includes(t.status))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const completedTrades = (trades || [])
    .filter(t => terminalStatuses.includes(t.status))
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
        body: await (async () => {
          const body: any = { action: "accept_quote", quoteId, agentAddress: supraAddress };
          try {
            const signed = await signAction("accept_quote", { quoteId });
            body.signedPayload = signed.payload;
            body.signature = signed.signature;
            body.payloadHash = signed.payloadHash;
            body.sessionNonce = signed.payload.sessionNonce;
            body.sessionPublicKey = signed.sessionPublicKey;
            body.sessionAuthSignature = signed.sessionAuthSignature;
            body.sessionNonce = signed.sessionNonce;
            body.sessionCreatedAt = signed.sessionCreatedAt;
            console.log("[SupraFX] Action signed:", signed.payloadHash.slice(0, 16) + "...");
          } catch (e) { console.warn("[SupraFX] Signing failed:", e); }
          return JSON.stringify(body);
        })(),
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        // Auto-expand the new trade to show settlement UI
        if (data.trade?.id) setExpandedTrade(data.trade.id);
        onAcceptQuote?.();
      }
    } catch (e: any) { alert(e.message); }
    setAccepting(null);
  };

  const cancelRfq = async (rfqId: string) => {
    if (!supraAddress) return;
    setCancelling(rfqId);
    try {
      const res = await fetch("/api/skill/suprafx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_rfq", rfqId, agentAddress: supraAddress }),
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else onAcceptQuote?.();
    } catch (e: any) { alert(e.message); }
    setCancelling(null);
  };


  const placeQuote = async (rfqId: string) => {
    if (!supraAddress || !quotePrice) return;
    setQuotingLoading(true);
    try {
      const quoteBody: any = { action: "place_quote", rfqId, makerAddress: supraAddress, rate: quotePrice };
      try {
        const signed = await signAction("place_quote", { rfqId, rate: quotePrice });
        quoteBody.signedPayload = signed.payload;
        quoteBody.signature = signed.signature;
        quoteBody.payloadHash = signed.payloadHash;
        quoteBody.sessionNonce = signed.payload.sessionNonce;
        quoteBody.sessionPublicKey = signed.sessionPublicKey;
        quoteBody.sessionAuthSignature = signed.sessionAuthSignature;
        quoteBody.sessionNonce = signed.sessionNonce;
        quoteBody.sessionCreatedAt = signed.sessionCreatedAt;
        console.log("[SupraFX] Action signed:", signed.payloadHash.slice(0, 16) + "...");
      } catch (e) { console.warn("[SupraFX] Signing failed:", e); }

      const quoteRes = await fetch("/api/skill/suprafx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quoteBody),
      });
      const quoteData = await quoteRes.json();

      if (quoteData.error) {
        // Show rejection reason (including Council rejection)
        alert(quoteData.error);
        setQuotingLoading(false);
        return;
      }

      setQuotePrice("");
      setQuotingRfq(null);
      if (onUpdate) onUpdate();
    } catch (e) { console.error(e); }
    setQuotingLoading(false);
  };

  const withdrawQuote = async (quoteId: string) => {
    if (!supraAddress) return;
    setWithdrawing(quoteId);
    try {
      const res = await fetch("/api/skill/suprafx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "withdraw_quote", quoteId, agentAddress: supraAddress }),
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else onAcceptQuote?.();
    } catch (e: any) { alert(e.message); }
    setWithdrawing(null);
  };


  const filteredOpenRfqs = activeFilter === "mine" ? openRfqs.filter(r => r.taker_address === supraAddress) : openRfqs;
  const filteredActiveTrades = activeFilter === "mine" ? activeTrades.filter(t => t.taker_address === supraAddress || t.maker_address === supraAddress) : activeTrades;
  const filteredCompletedTrades = completedFilter === "mine" ? completedTrades.filter(t => t.taker_address === supraAddress || t.maker_address === supraAddress) : completedTrades;
  const activeCount = filteredOpenRfqs.length + filteredActiveTrades.length;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* === SECTION 1: IN-FLIGHT TRADES (always visible, top) === */}
      <div className="card mb-4 animate-in" style={{ order: 1 }}>
        <div className="card-header">
          <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>In-Flight Trades</span>
          <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>{activeTrades.length} active</span>
        </div>
        {filteredActiveTrades.length === 0 ? (
          <div className="py-6 text-center text-[13px]" style={{ color: "var(--t3)" }}>No in-flight trades</div>
        ) : (
          <div>
              <div className="flex items-center gap-4 px-4 py-1.5" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                <span className="mono text-[10px] uppercase tracking-wider font-medium w-24 shrink-0" style={{ color: "var(--t3)" }}>TX ID</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium w-28 shrink-0" style={{ color: "var(--t3)" }}>Pair</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium w-24 shrink-0" style={{ color: "var(--t3)" }}>Size</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium flex-1" style={{ color: "var(--t3)" }}>Rate</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium shrink-0" style={{ color: "var(--t3)" }}>Route</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium shrink-0" style={{ color: "var(--t3)" }}>Taker</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium shrink-0" style={{ color: "var(--t3)" }}>Maker</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium shrink-0" style={{ color: "var(--t3)" }}>Status</span>
              </div>
            {filteredActiveTrades.map(t => {
                const isMine = t.taker_address === supraAddress;
                const pairClean = displayPair(t.pair);
                const isTradeExpanded = expandedTrade === t.id;
                return (
                  <div key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-white/[0.01] transition-colors"
                      onClick={() => setExpandedTrade(isTradeExpanded ? null : t.id)}>
                      <span className="mono text-[12px] w-24 shrink-0" style={{ color: "var(--t3)" }}>{(() => { const rfqForTrade = rfqs.find(r => r.id === t.rfq_id); return rfqForTrade ? generateTxId(rfqForTrade.display_id, rfqForTrade.taker_address) : t.display_id; })()}</span>
                      <span className="text-[13px] font-semibold w-28 shrink-0">{pairClean}</span>
                      <span className="mono text-[13px] w-24 shrink-0">{t.size}</span>
                      <span className="mono text-[13px] flex-1" style={{ color: "var(--t1)" }}>{fmtRate(t.rate)}</span>
                      <span className="text-[12px] shrink-0" style={{ color: "var(--t3)" }}>{t.source_chain} → {t.dest_chain}</span>
                      <span className="shrink-0"><AddrWithRep addr={t.taker_address} chain={t.source_chain} agents={agents} isMine={t.taker_address === supraAddress} /></span>
                      <span className="shrink-0">{t.maker_address === "auto-maker-bot" ? <span className="mono text-[11px]" style={{ color: "var(--accent)" }}>SupraFX Bot</span> : <AddrWithRep addr={t.maker_address} chain={t.dest_chain} agents={agents} isMine={t.maker_address === supraAddress} />}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {!isTradeExpanded && t.status === "taker_verified" && t.maker_deadline && (
                          <InlineTimer deadline={t.maker_deadline} />
                        )}
                        {!isTradeExpanded && t.status === "open" && t.taker_deadline && (
                          <InlineTimer deadline={t.taker_deadline} />
                        )}
                        <span className={`tag tag-${t.status === "open" ? "open_trade" : t.status}`}>{t.status.replace(/_/g, " ")}</span>
                        <span className="text-[10px]" style={{ color: "var(--t3)" }}>{isTradeExpanded ? "▲" : "▼"}</span>
                      </div>
                    </div>
                    {isTradeExpanded && (
                      <ActiveTrade trade={t} onUpdate={onUpdate} rfq={rfqs.find(r => r.id === t.rfq_id)} tradeQuotes={quotes.filter(q => q.rfq_id === t.rfq_id)} agents={agents} supraAddr={supraAddress || undefined} />
                    )}
                  </div>
                );
            })}
          </div>
        )}
      </div>

      {/* === SECTION 2: OPEN RFQs (visible by default, collapsible) === */}
      <div className="card mb-4 animate-in" style={{ order: 2 }}>
      <div className="card-header cursor-pointer" onClick={() => setShowRfqs(!showRfqs)}>
        <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>Open RFQs</span>
        <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>
          {openRfqs.length} RFQ{openRfqs.length !== 1 ? "s" : ""} {showRfqs ? "▲" : "▼"}
        </span>
      </div>

      {showRfqs && (openRfqs.length === 0 ? (
        <div className="py-6 text-center text-[13px]" style={{ color: "var(--t3)" }}>
          No open RFQs
        </div>
      ) : (
        <div>
{filteredOpenRfqs.length > 0 && (
              <div className="flex items-center gap-4 px-4 py-1.5" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                <span className="mono text-[10px] uppercase tracking-wider font-medium w-24 shrink-0" style={{ color: "var(--t3)" }}>TX ID</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium w-28 shrink-0" style={{ color: "var(--t3)" }}>Pair</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium w-24 shrink-0" style={{ color: "var(--t3)" }}>Size</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium flex-1" style={{ color: "var(--t3)" }}>Asking</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium shrink-0" style={{ color: "var(--t3)" }}>Route</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium shrink-0" style={{ color: "var(--t3)" }}>Taker</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium shrink-0" style={{ color: "var(--t3)" }}>Quotes</span>
              </div>
            )}
            {filteredOpenRfqs.map(r => {
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
                  onClick={() => { setExpandedRfq(isExpanded ? null : r.id); if (!isExpanded) setTrackedRfqId(r.id); }}>
                  <span className="mono text-[12px] w-24 shrink-0" style={{ color: "var(--t3)" }}>
                      {generateTxId(r.display_id, r.taker_address)}
                    </span>
                  <span className="text-[13px] font-semibold w-28 shrink-0">{pairClean}</span>
                  <span className="mono text-[13px] w-24 shrink-0">{r.size} {baseClean}</span>
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <div>
                      <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Asking </span>
                      <span className="mono text-[13px] font-semibold" style={{ color: "var(--t1)" }}>
                        {fmtRate(r.reference_price)} {quoteClean}/{baseClean}
                        {(() => { const usd = toUsd(r.size * r.reference_price, r.pair.split("/")[1] || ""); return usd ? <span className="mono text-[11px] ml-2" style={{ color: "var(--t3)" }}>({usd} USD)</span> : null; })()}
                      </span>
                    </div>
                    {isMine && (
                      <a onClick={(e) => { e.stopPropagation(); if (window.confirm("Cancel this RFQ? All pending quotes will be rejected.")) cancelRfq(r.id); }}
                        className="text-[11px] cursor-pointer hover:underline shrink-0"
                        style={{ color: cancelling === r.id ? "var(--t3)" : "var(--negative)" }}>
                        {cancelling === r.id ? "cancelling..." : "cancel"}
                      </a>
                    )}
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
                              <span className="mono text-[11px] w-28 shrink-0" style={{ color: "var(--t3)" }}>
                                {(() => { const u = toUsd(r.size * q.rate, r.pair.split("/")[1] || ""); return u ? u + " USD" : ""; })()}
                              </span>
                              <span className="mono text-[11px] w-28 shrink-0" style={{ color: "var(--t3)" }}>
                                {r.size > 0 ? (r.size * q.rate >= 1000 ? "$" + (r.size * q.rate).toLocaleString(undefined, {maximumFractionDigits: 0}) : "$" + (r.size * q.rate).toFixed(2)) : ""}
                              </span>
                              <span className="mono text-[12px] w-28" style={{ color: diffColor }}>
                                {diff >= 0 ? "+" : ""}{diff.toFixed(2)}%
                              </span>
                              <span className="mono text-[13px] w-32" style={{ color: "var(--positive)" }}>
                                {receive >= 1000 ? receive.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : receive.toFixed(4)} {quoteClean}
                              </span>
                              <span className="w-24">
                                <span className={`tag tag-${q.status}`} style={
                                  q.status === "review" ? { background: "rgba(234,179,8,0.12)", color: "var(--warn)" } : {}
                                }>{q.status === "review" ? "In Review" : q.status}</span>
                              </span>
                              {isMine && q.status === "pending" && (
                                <button onClick={(e) => { e.stopPropagation(); acceptQuote(q.id); }}
                                  disabled={accepting === q.id}
                                  className="px-3 py-1 rounded text-[12px] font-semibold transition-all hover:brightness-110 disabled:opacity-50"
                                  style={{ background: "var(--positive)", color: "#fff", border: "none" }}>
                                  {accepting === q.id ? "..." : "Accept"}
                                </button>
                              )}
                              {q.maker_address === supraAddress && (q.status === "pending" || q.status === "review") && (
                                <button onClick={(e) => { e.stopPropagation(); withdrawQuote(q.id); }}
                                  disabled={withdrawing === q.id}
                                  className="px-3 py-1 rounded text-[12px] font-semibold transition-all hover:brightness-110 disabled:opacity-50"
                                  style={{ background: "var(--negative)", color: "#fff", border: "none" }}>
                                  {withdrawing === q.id ? "..." : "Withdraw"}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Place Quote form — for non-owners */}
                    {!isMine && supraAddress && (
                      <div className="px-8 py-3" style={{ borderTop: "1px solid var(--border)" }}>
                        {quotingRfq === r.id ? (
                          <div className="flex items-center gap-3">
                            <span className="mono text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>Your Price</span>
                            <input type="number" step="any" min="0" placeholder={fmtRate(r.reference_price)}
                              value={quotePrice} onChange={e => setQuotePrice(e.target.value)}
                              className="px-3 py-1.5 rounded mono text-[13px] outline-none"
                              style={{ background: "var(--bg)", color: "var(--t0)", border: "1px solid var(--border)", width: 160 }}
                              autoFocus />
                            <span className="mono text-[11px]" style={{ color: "var(--t3)" }}>{quoteClean}/{baseClean}</span>
                            {makerVault && (
                              <span className="mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--t3)" }}>
                                Limit: {makerVault.matchingLimit.toLocaleString(undefined, { maximumFractionDigits: 2 })} {makerVault.currency}
                              </span>
                            )}
                            <button onClick={() => placeQuote(r.id)} disabled={quotingLoading || !quotePrice}
                              className="px-3 py-1.5 rounded text-[12px] font-semibold transition-all hover:brightness-110 disabled:opacity-30"
                              style={{ background: "var(--positive)", color: "#fff", border: "none" }}>
                              {quotingLoading ? "..." : "Submit Quote"}
                            </button>
                            {parseFloat(quotePrice) > 0 && r.size > 0 && (() => {
                              const sendAmt = r.size * parseFloat(quotePrice);
                              const sendToken = r.pair.split("/")[1]?.replace("fx","") || "";
                              const receiveToken = r.pair.split("/")[0]?.replace("fx","") || "";
                              const sendUsd = toUsd(sendAmt, r.pair.split("/")[1] || "");
                              const receiveUsd = toUsd(r.size, r.pair.split("/")[0] || "");
                              return (
                                <div className="text-[10px] mt-2 px-2 py-1.5 rounded" style={{ background: "var(--surface-2)", color: "var(--t2)" }}>
                                  <div>You send: <span className="font-semibold">{sendAmt.toLocaleString(undefined, {maximumFractionDigits: 4})} {sendToken}</span>{sendUsd && <span style={{ color: "var(--t3)" }}> ({sendUsd} USD)</span>}</div>
                                  <div>You receive: <span className="font-semibold">{r.size} {receiveToken}</span>{receiveUsd && <span style={{ color: "var(--t3)" }}> ({receiveUsd} USD)</span>}</div>
                                </div>
                              );
                            })()}
                            <button onClick={() => { setQuotingRfq(null); setQuotePrice(""); }}
                              className="text-[11px] hover:underline"
                              style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>
                              cancel
                            </button>
                          </div>
                        ) : (
                          <>
                          <button onClick={() => {
                              if (!makerVault || makerVault.matchingLimit <= 0) {
                                setShowDepositPrompt(true);
                                return;
                              }

                              setQuotingRfq(r.id);
                              setQuotePrice(fmtRate(r.reference_price));
                              setShowDepositPrompt(false);
                            }}
                            className="px-4 py-1.5 rounded text-[12px] font-semibold transition-all hover:brightness-110"
                            style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
                            Place Quote
                          </button>
                          {showDepositPrompt && quotingRfq !== r.id && (
                            <div className="mt-2 px-3 py-2.5 rounded" style={{ background: "var(--warn-dim)", border: "1px solid rgba(234,179,8,0.15)" }}>
                              <div className="text-[12px] font-medium mb-1" style={{ color: "var(--warn)" }}>Security Deposit Required</div>
                              <div className="text-[12px] mb-2" style={{ color: "var(--t2)" }}>
                                To place quotes, you need a security deposit in the vault. This protects takers and backs your quotes. Your quoting capacity is 90% of your deposit.
                              </div>
                              <button onClick={() => {
                                window.dispatchEvent(new Event("suprafx:open-vault"));
                                setShowDepositPrompt(false);
                              }}
                                className="px-3 py-1.5 rounded text-[12px] font-semibold transition-all hover:brightness-110"
                                style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
                                Make Security Deposit
                              </button>
                            </div>
                          )}
                          </>
                        )}
                      </div>
                    )}

                    {/* Already have a pending quote */}
                    {!isMine && supraAddress && rfqQuotes.some(q => q.maker_address === supraAddress && (q.status === "pending" || q.status === "review")) && quotingRfq !== r.id && (
                      <div className="px-8 py-2" style={{ borderTop: "1px solid var(--border)" }}>
                        <span className="text-[12px]" style={{ color: "var(--t3)" }}>You have a pending quote on this RFQ</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}


        </div>
      ))}

      </div>

      {/* === SECTION 3: COMPLETED TRADES === */}
      {completedTrades.length > 0 && (
        <div className="card mb-4 animate-in">
          <div className="card-header">
            <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>Completed Trades</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <button onClick={() => setCompletedFilter("all")}
                  className="px-2 py-0.5 rounded text-[11px] font-medium transition-all"
                  style={{ background: completedFilter === "all" ? "var(--accent)" : "transparent", color: completedFilter === "all" ? "#fff" : "var(--t3)", border: "1px solid " + (completedFilter === "all" ? "var(--accent)" : "var(--border)") }}>
                  All
                </button>
                <button onClick={() => setCompletedFilter("mine")}
                  className="px-2 py-0.5 rounded text-[11px] font-medium transition-all"
                  style={{ background: completedFilter === "mine" ? "var(--accent)" : "transparent", color: completedFilter === "mine" ? "#fff" : "var(--t3)", border: "1px solid " + (completedFilter === "mine" ? "var(--accent)" : "var(--border)") }}>
                  Mine
                </button>
              </div>
              <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>
                {completedTrades.length} execution{completedTrades.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <div>
              <div className="flex items-center gap-4 px-4 py-1.5" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                <span className="mono text-[10px] uppercase tracking-wider font-medium w-24 shrink-0" style={{ color: "var(--t3)" }}>TX ID</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium w-28 shrink-0" style={{ color: "var(--t3)" }}>Pair</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium w-24 shrink-0" style={{ color: "var(--t3)" }}>Size</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium w-28 shrink-0" style={{ color: "var(--t3)" }}>Rate</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium w-36 shrink-0" style={{ color: "var(--t3)" }}>Route</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium w-16 shrink-0" style={{ color: "var(--t3)" }}>Time</span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium flex-1" style={{ color: "var(--t3)" }}></span>
                <span className="mono text-[10px] uppercase tracking-wider font-medium shrink-0" style={{ color: "var(--t3)" }}>Status</span>
              </div>
            {filteredCompletedTrades.map(t => {
                const att = attestations[t.id];
                const takerTxUrl = txUrl(t.taker_tx_hash || "", t.source_chain);
                const makerTxUrl = txUrl(t.maker_tx_hash || "", t.dest_chain);
                const isExpanded = expandedCompleted === t.id;
                const pairClean = displayPair(t.pair);
                const [base, quote] = t.pair.split("/");
                const baseClean = base.replace("fx", "");
                const quoteClean = quote.replace("fx", "");
                const rfq = rfqs.find(r => r.id === t.rfq_id);
                const tradeQuotes = rfq ? quotes.filter(q => q.rfq_id === rfq.id) : [];
                const askingPrice = rfq?.reference_price;
                const priceDiff = askingPrice && askingPrice > 0 ? ((t.rate - askingPrice) / askingPrice) * 100 : null;

                return (
                  <div key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-white/[0.01] transition-colors"
                      onClick={() => setExpandedCompleted(isExpanded ? null : t.id)}>
                      <span className="mono text-[12px] w-24 shrink-0" style={{ color: "var(--t3)" }}>{(() => { const rfqForTrade = rfqs.find(r => r.id === t.rfq_id); return rfqForTrade ? generateTxId(rfqForTrade.display_id, rfqForTrade.taker_address) : t.display_id; })()}</span>
                      <span className="text-[13px] font-semibold w-28 shrink-0">{pairClean}</span>
                      <span className="mono text-[13px] w-24 shrink-0">{t.size} {baseClean}</span>
                      <span className="mono text-[13px] w-28 shrink-0" style={{ color: "var(--t1)" }}>{fmtRate(t.rate)} {quoteClean}</span>
                      <span className="text-[12px] w-36 shrink-0" style={{ color: "var(--t3)" }}>{t.source_chain} → {t.dest_chain}</span>
                      <span className="mono text-[13px] w-16 shrink-0" style={{ color: t.settle_ms ? "var(--positive)" : t.status === "taker_timed_out" || t.status === "maker_defaulted" ? "var(--negative)" : "var(--t3)" }}>
                        {t.settle_ms ? (t.settle_ms / 1000).toFixed(1) + "s" : t.status === "taker_timed_out" ? "T/O" : t.status === "maker_defaulted" ? "DEF" : "—"}
                      </span>
                      <div className="flex-1" />
                      <span className={`tag tag-${t.status}`} style={
                        t.status === "taker_timed_out" ? { background: "rgba(239,68,68,0.15)", color: "var(--negative)", fontWeight: 600 } :
                        t.status === "maker_defaulted" ? { background: "rgba(239,68,68,0.15)", color: "var(--negative)", fontWeight: 600 } :
                        t.status === "settled" ? { background: "rgba(34,197,94,0.15)", color: "var(--positive)", fontWeight: 600 } : {}
                      }>
                        {t.status === "settled" ? "Settled" :
                         t.status === "taker_timed_out" ? "Taker Timed Out" :
                         t.status === "maker_defaulted" ? "Maker Defaulted" :
                         t.status.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--t3)" }}>{isExpanded ? "▲" : "▼"}</span>
                    </div>

                    {isExpanded && (
                      <div className="px-6 pb-4 pt-1" style={{ background: "var(--bg-raised)" }}>
                        {/* Terminal status banner */}
                        {t.status === "taker_timed_out" && (
                          <div className="px-3 py-2 rounded mb-3 flex items-center gap-2" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                            <span style={{ color: "var(--negative)", fontSize: 14 }}>⏱</span>
                            <div>
                              <div className="text-[12px] font-semibold" style={{ color: "var(--negative)" }}>Taker Timed Out</div>
                              <div className="text-[11px]" style={{ color: "var(--t3)" }}>
                                {t.taker_address === supraAddress ? "You did not settle within the deadline. -33% reputation." : "Taker failed to settle. Earmark released."}
                              </div>
                            </div>
                          </div>
                        )}
                        {t.status === "maker_defaulted" && (
                          <div className="px-3 py-2 rounded mb-3 flex items-center gap-2" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                            <span style={{ color: "var(--negative)", fontSize: 14 }}>⚠</span>
                            <div>
                              <div className="text-[12px] font-semibold" style={{ color: "var(--negative)" }}>Maker Defaulted</div>
                              <div className="text-[11px]" style={{ color: "var(--t3)" }}>
                                {t.maker_address === supraAddress ? "You did not settle within the deadline. -67% reputation, deposit liquidated." : "Maker defaulted. You have been repaid from their security deposit."}
                              </div>
                            </div>
                          </div>
                        )}
                        {/* --- Trade Summary --- */}
                        <div className="grid grid-cols-3 gap-6 mb-4">
                          <div>
                            <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Price Execution</span>
                            {askingPrice ? (
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px]" style={{ color: "var(--t3)" }}>Asked:</span>
                                  <span className="mono text-[13px]" style={{ color: "var(--t2)" }}>{fmtRate(askingPrice)} {quoteClean}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px]" style={{ color: "var(--t3)" }}>Filled:</span>
                                  <span className="mono text-[13px] font-semibold" style={{ color: "var(--t1)" }}>{fmtRate(t.rate)} {quoteClean}</span>
                                  {priceDiff !== null && (
                                    <span className="mono text-[11px]" style={{ color: priceDiff >= 0 ? "var(--positive)" : "var(--negative)" }}>
                                      {priceDiff >= 0 ? "+" : ""}{priceDiff.toFixed(2)}%
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[11px]" style={{ color: "var(--t3)" }}>Notional:</span>
                                  <span className="mono text-[13px]" style={{ color: "var(--positive)" }}>
                                    {(t.size * t.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {quoteClean}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <span className="mono text-[13px]" style={{ color: "var(--t1)" }}>{fmtRate(t.rate)} {quoteClean}</span>
                            )}
                          </div>

                          <div>
                            <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Counterparties</span>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] w-12" style={{ color: "var(--t3)" }}>Taker:</span>
                              <AddrWithRep addr={t.taker_address} chain={t.source_chain} agents={agents} isMine={t.taker_address === supraAddress} />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] w-12" style={{ color: "var(--t3)" }}>Maker:</span>
                              <AddrWithRep addr={t.maker_address} chain={t.dest_chain} agents={agents} isMine={t.maker_address === supraAddress} />
                            </div>
                          </div>

                          <div>
                            <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Settlement</span>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] w-16" style={{ color: "var(--t3)" }}>Taker TX:</span>
                              {t.taker_tx_hash && takerTxUrl ? (
                                <a href={takerTxUrl} target="_blank" rel="noopener" className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                                  {t.taker_tx_hash.slice(0, 10)}…{t.taker_tx_hash.slice(-6)} ↗
                                </a>
                              ) : <span className="text-[12px]" style={{ color: "var(--t3)" }}>—</span>}
                            </div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] w-16" style={{ color: "var(--t3)" }}>Maker TX:</span>
                              {t.maker_tx_hash && makerTxUrl ? (
                                <a href={makerTxUrl} target="_blank" rel="noopener" className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                                  {t.maker_tx_hash.slice(0, 10)}…{t.maker_tx_hash.slice(-6)} ↗
                                </a>
                              ) : <span className="text-[12px]" style={{ color: "var(--t3)" }}>—</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] w-16" style={{ color: "var(--t3)" }}>Attestation:</span>
                              {att ? (
                                <a href={`https://testnet.suprascan.io/tx/${att.replace(/^0x/, "")}`} target="_blank" rel="noopener"
                                  className="mono text-[12px] hover:underline" style={{ color: "var(--positive)" }}>
                                  {att.slice(0, 10)}…{att.slice(-6)} ↗
                                </a>
                              ) : t.status === "settled" ? (
                                <span className="text-[12px]" style={{ color: "var(--t3)" }}>pending</span>
                              ) : <span className="text-[12px]" style={{ color: "var(--t3)" }}>—</span>}
                            </div>
                            {t.settle_ms && (
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[11px] w-16" style={{ color: "var(--t3)" }}>Duration:</span>
                                <span className="mono text-[13px] font-semibold" style={{ color: "var(--positive)" }}>
                                  {(t.settle_ms / 1000).toFixed(1)}s
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* --- Quote History --- */}
                        {tradeQuotes.length > 0 && (
                          <div>
                            <span className="mono text-[10px] uppercase tracking-wider block mb-1.5" style={{ color: "var(--t3)" }}>
                              Quote History ({tradeQuotes.length} quote{tradeQuotes.length !== 1 ? "s" : ""})
                            </span>
                            <div className="rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                              {tradeQuotes.map((q, qi) => {
                                const qDiff = askingPrice && askingPrice > 0 ? ((q.rate - askingPrice) / askingPrice) * 100 : null;
                                return (
                                  <div key={q.id} className="flex items-center gap-4 px-4 py-2"
                                    style={{ borderBottom: qi < tradeQuotes.length - 1 ? "1px solid var(--border)" : "none", background: q.status === "accepted" ? "rgba(16,185,129,0.04)" : "transparent" }}>
                                    <div className="w-36">
                                      <AddrWithRep addr={q.maker_address} chain={t.dest_chain} agents={agents} isMine={q.maker_address === supraAddress} />
                                    </div>
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

                        {/* Audit Trail */}
                        <AuditTrail tradeId={t.id} supraAddr={supraAddress || undefined} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
        </div>
      )}
    </>
  );
}
