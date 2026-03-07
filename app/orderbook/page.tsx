"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { WalletProvider, useWallet } from "@/components/WalletProvider";
import Header from "@/components/Header";
import ProfilePanel from "@/components/ProfilePanel";
import { supabase } from "@/lib/supabase";
import { generateTxId } from "@/lib/tx-id";
import type { RFQ, Quote, Agent, Trade } from "@/lib/types";
import { MakerVaultDetail } from "@/components/MakerVaultBadge";
import OracleTicker from "@/components/OracleTicker";

/* ══════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════ */
function displayPair(p: string) { return p.replace(/fx/g, ""); }
function fmtRate(n: number) {
  if (n >= 1000) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
function shortAddr(a: string) {
  if (a === "auto-maker-bot") return "SupraFX Bot";
  if (a.length > 16) return a.slice(0, 6) + "..." + a.slice(-4);
  return a;
}
function timeAgo(iso: string) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return sec + "s ago";
  if (sec < 3600) return Math.floor(sec / 60) + "m ago";
  return Math.floor(sec / 3600) + "h ago";
}
function chainName(c: string) {
  if (c === "sepolia") return "Ethereum Sepolia";
  if (c === "supra-testnet") return "Supra Testnet";
  return c;
}
const ASSETS = ["ETH", "SUPRA", "AAVE", "LINK", "USDC", "USDT", "iUSDC", "iUSDT", "iETH", "iBTC"];
const CHAINS = ["All", "Cross-chain", "Same-chain", "Sepolia", "Supra"];
const STEPS = ["matched", "taker_sent", "taker_verified", "maker_sent", "maker_verified", "settled"];
const LABELS = ["Matched", "Taker Sending", "Taker Verified", "Maker Sending", "Maker Verified", "Settled"];
const TIMEOUT_STATUSES = ["taker_timed_out", "maker_defaulted"];

function stepIdx(s: string) {
  if (s === "open" || s === "matched") return 0;
  if (s === "taker_timed_out") return 1;
  if (s === "maker_defaulted") return 3;
  const i = STEPS.indexOf(s);
  return i >= 0 ? i : 0;
}

/* ══════════════════════════════════════════════════════
   SETTLEMENT SUB-COMPONENTS
   ══════════════════════════════════════════════════════ */
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
                : i < cur ? "var(--positive)" : i === cur ? "var(--accent)" : "var(--surface-3)",
            }} />
          <span className="font-mono text-[8px] uppercase tracking-wider mt-1"
            style={{
              color: (isFailed || isTimeout) && i === cur ? "var(--negative)"
                : i < cur ? "var(--positive)" : i === cur ? "var(--accent-light)" : "var(--t3)",
            }}>
            {isTimeout && i === cur ? (status === "taker_timed_out" ? "Taker Timeout" : "Maker Default") : LABELS[i]}
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
    <div className="flex items-center gap-3 px-3 py-2 rounded-md mb-2"
      style={{ background: bgColor, border: isWarning || isCritical || isExpired ? `1px solid ${color}20` : "none" }}>
      <div className="flex items-center gap-2 flex-1">
        <span className="text-[12px]" style={{ color: "var(--t3)" }}>{label}</span>
        <span className="mono text-[15px] font-bold tabular-nums" style={{ color }}>
          {isExpired ? "EXPIRED" : `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`}
        </span>
      </div>
      {penaltyWarning && (isWarning || isCritical) && !isExpired && (
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${color}15`, color }}>{penaltyWarning}</span>
      )}
      {isExpired && <span className="text-[11px]" style={{ color: "var(--negative)" }}>Processing timeout...</span>}
    </div>
  );
}

function AuditTrail({ tradeId }: { tradeId: string }) {
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
        <div className="mt-2 overflow-hidden" style={{ border: "1px solid var(--border)" }}>
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
                          <div className="flex items-center gap-1">
                            {nodes.map((nodeId) => {
                              const vote = evtVotes.find((v: any) => v.node_id === nodeId);
                              return (
                                <div key={nodeId} className="px-1.5 py-0.5 rounded text-[9px] mono"
                                  style={{ background: vote ? (vote.decision === "approve" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)") : "var(--surface-2)", color: vote ? (vote.decision === "approve" ? "var(--positive)" : "var(--negative)") : "var(--t3)" }}>
                                  {nodeId.split("-")[1]}:{vote ? (vote.decision === "approve" ? "ok" : "rej") : "--"}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
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
}

/* ══════════════════════════════════════════════════════
   ACTIVE TRADE (settlement UI for in-flight trades)
   ══════════════════════════════════════════════════════ */
function InFlightTrade({ trade, onUpdate, agents }: { trade: Trade; onUpdate: () => void; agents: Agent[] }) {
  const { profile, isDemo, sendSepoliaEth, sendSupraTokens, supraAddress, signAction } = useWallet();
  const [txHash, setTxHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<Array<{ time: string; text: string; color?: string }>>([]);

  const hasWallet = !!profile?.evmVerified && !isDemo;
  const hasSupraWallet = !!supraAddress && !isDemo;
  const isTaker = trade.taker_address === supraAddress;
  const isMaker = trade.maker_address === supraAddress;

  const addLog = (text: string, color?: string) => {
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(prev => [...prev, { time, text, color }]);
  };

  const myChain = isTaker ? trade.source_chain : trade.dest_chain;
  const mySide: "taker" | "maker" = isTaker ? "taker" : "maker";
  const isEvmChain = myChain === "sepolia";
  const isSupraChain = myChain === "supra-testnet";
  const canSettle = isEvmChain ? hasWallet : isSupraChain ? hasSupraWallet : false;

  const [resolvedRecipient, setResolvedRecipient] = useState<string | null>(null);
  const [recipientLoading, setRecipientLoading] = useState(false);

  useEffect(() => {
    if (!isTaker && !isMaker) return;
    const storedAddr = isTaker ? (trade as any).maker_settlement_address : (trade as any).taker_settlement_address;
    if (storedAddr && storedAddr.length > 10) { setResolvedRecipient(storedAddr); return; }
    const counterparty = isTaker ? trade.maker_address : trade.taker_address;

    // Known bot addresses — resolve immediately
    const KNOWN_BOTS: Record<string, string> = {
      "0x02af04c537a6aa319a6704229894fbdc54cdfcae0202c12afaa21efa0831343a": "0x8B122E57Df40686f4ee1fB2FC04227de710a5BfE",
      "0x8622e15E71DdfBCF25721B7D82B729D235201EE3": "0x8B122E57Df40686f4ee1fB2FC04227de710a5BfE",
    };
    if (KNOWN_BOTS[counterparty] && isEvmChain) { setResolvedRecipient(KNOWN_BOTS[counterparty]); return; }
    if (KNOWN_BOTS[counterparty] && isSupraChain) { setResolvedRecipient(counterparty); return; }

    setRecipientLoading(true);
    fetch(`/api/link-address?supra=${encodeURIComponent(counterparty)}`)
      .then(r => r.json()).then(data => {
        const links = data.links || [];
        const match = links.find((l: any) => l.chain === myChain);
        if (match) setResolvedRecipient(match.linked_address);
        else if (links.length > 0 && isEvmChain) setResolvedRecipient(links[0].linked_address);
        else if (data.link?.evm_address && isEvmChain) setResolvedRecipient(data.link.evm_address);
        else if (isSupraChain) setResolvedRecipient(counterparty);
      }).catch(() => {}).finally(() => setRecipientLoading(false));
  }, [trade.id]);

  const isValidRecipient = (() => {
    if (!resolvedRecipient || resolvedRecipient.startsWith("demo_")) return false;
    if (isEvmChain) return resolvedRecipient.startsWith("0x") && resolvedRecipient.length === 42;
    if (isSupraChain) return resolvedRecipient.startsWith("0x") || /^[0-9a-fA-F]{64}$/.test(resolvedRecipient);
    return false;
  })();

  const confirmTx = async (side: "taker" | "maker", hash: string) => {
    const body: any = { tradeId: trade.id, txHash: hash, side };
    try {
      const signed = await signAction("confirm_" + side + "_tx", { tradeId: trade.id, txHash: hash });
      body.signedPayload = signed.payload; body.signature = signed.signature; body.payloadHash = signed.payloadHash;
      body.sessionNonce = signed.payload.sessionNonce; body.sessionPublicKey = signed.sessionPublicKey;
      body.sessionAuthSignature = signed.sessionAuthSignature; body.sessionCreatedAt = signed.sessionCreatedAt;
    } catch {}
    return fetch("/api/confirm-tx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
  };

  const sendOnChain = async (): Promise<string> => {
    if (!resolvedRecipient) throw new Error("No recipient");
    if (isEvmChain) return await sendSepoliaEth(resolvedRecipient.startsWith("0x") ? resolvedRecipient : "0x" + resolvedRecipient, "0x" + BigInt(10000000000000).toString(16));
    if (isSupraChain) return String(await sendSupraTokens(resolvedRecipient, 0.001));
    throw new Error("Unsupported chain");
  };

  const settle = async () => {
    setLoading(true); setLogs([]);
    if (!canSettle) { addLog("No wallet for " + chainName(myChain), "var(--negative)"); setLoading(false); return; }
    if (!isValidRecipient) { addLog("No counterparty address on " + chainName(myChain), "var(--negative)"); setLoading(false); return; }
    try {
      addLog("Settling on " + chainName(myChain) + "...");
      const hash = await sendOnChain();
      addLog("TX: " + hash.slice(0, 20) + "...", "var(--accent-light)");
      await new Promise(r => setTimeout(r, isEvmChain ? 12000 : 3000));
      addLog("Submitting to Council...");
      const result = await confirmTx(mySide, hash);
      if (result.autoSettled) { addLog("Settled in " + (result.settleMs / 1000).toFixed(1) + "s", "var(--positive)"); }
      else if (result.status === "settled") { addLog("Settled!", "var(--positive)"); }
      else if (result.verified) { addLog("Verified (5/5)", "var(--positive)"); if (mySide === "taker") addLog("Waiting for maker...", "var(--t2)"); }
      else { addLog("Council verifying...", "var(--warn)"); }
      onUpdate();
    } catch (e: any) {
      if (e.code === 4001 || e.message?.includes("rejected")) addLog("Rejected", "var(--negative)");
      else addLog("Error: " + (e.message || e), "var(--negative)");
    }
    setLoading(false);
  };

  const submitHash = async () => {
    if (!txHash.trim()) return;
    setLoading(true);
    addLog("Submitting TX hash...");
    const data = await confirmTx(mySide, txHash.trim());
    if (data.error) addLog("Error: " + data.error, "var(--negative)");
    else if (data.status === "settled") addLog("Settled!", "var(--positive)");
    else if (data.verified) addLog("Verified (5/5)", "var(--positive)");
    setTxHash(""); onUpdate(); setLoading(false);
  };

  const takerNeedsToAct = trade.status === "open" || trade.status === "matched";

  return (
    <div className="px-4 py-3" style={{ borderLeft: "3px solid var(--accent)", background: "var(--bg-raised)" }}>
      <Progress status={trade.status} />

      {/* TAKER'S TURN */}
      {takerNeedsToAct && (
        <div>
          {trade.taker_deadline && <CountdownTimer deadline={trade.taker_deadline} label={isTaker ? "Your deadline:" : "Taker deadline:"} penaltyWarning={isTaker ? "-33% reputation" : undefined} />}
          {isTaker ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <button onClick={settle} disabled={loading || !canSettle || recipientLoading || !isValidRecipient}
                  className="px-4 py-[7px] rounded text-[13px] font-semibold disabled:opacity-30"
                  style={{ background: "var(--positive)", color: "#fff", border: "none" }}>
                  {loading ? "Settling..." : "Settle on " + chainName(myChain)}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input type="text" placeholder="or paste TX hash..." value={txHash} onChange={e => setTxHash(e.target.value)}
                  className="flex-1 px-2.5 py-[5px] rounded border text-[14px] font-mono outline-none"
                  style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--t0)" }} />
                <button onClick={submitHash} disabled={loading || !txHash.trim()} className="px-2.5 py-[5px] rounded text-[13px] disabled:opacity-30"
                  style={{ background: "var(--surface-3)", color: "var(--t1)", border: "none" }}>Submit</button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--t2)" }}>
              <Spinner color="var(--accent)" /><span>Waiting for taker to settle...</span>
            </div>
          )}
        </div>
      )}

      {/* TAKER SENT */}
      {trade.status === "taker_sent" && (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--t2)" }}><Spinner color="var(--accent)" /> Council verifying taker TX...</div>
      )}

      {/* TAKER VERIFIED: MAKER'S TURN */}
      {trade.status === "taker_verified" && (
        <div>
          <div className="text-[13px] mb-2" style={{ color: "var(--positive)" }}>Taker TX verified by Council.</div>
          {trade.maker_deadline && <CountdownTimer deadline={trade.maker_deadline} label={isMaker ? "Your deadline:" : "Maker deadline:"} penaltyWarning={isMaker ? "-67% rep + liquidated" : undefined} />}
          {isMaker ? (
            <>
              <div className="px-3 py-2 rounded mb-2" style={{ background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)" }}>
                <span className="text-[13px] font-semibold" style={{ color: "var(--accent-light)" }}>Your turn - send on {chainName(trade.dest_chain)}</span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <button onClick={settle} disabled={loading || !canSettle} className="px-4 py-[7px] rounded text-[13px] font-semibold disabled:opacity-30"
                  style={{ background: "var(--positive)", color: "#fff", border: "none" }}>{loading ? "Settling..." : "Settle"}</button>
              </div>
              <div className="flex items-center gap-2">
                <input type="text" placeholder="or paste TX hash..." value={txHash} onChange={e => setTxHash(e.target.value)}
                  className="flex-1 px-2.5 py-[5px] rounded border text-[14px] font-mono outline-none"
                  style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--t0)" }} />
                <button onClick={submitHash} disabled={loading || !txHash.trim()} className="px-2.5 py-[5px] rounded text-[13px] disabled:opacity-30"
                  style={{ background: "var(--surface-3)", color: "var(--t1)", border: "none" }}>Submit</button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--t2)" }}><Spinner color="var(--positive)" /><span>Waiting for maker...</span></div>
          )}
        </div>
      )}

      {trade.status === "maker_sent" && (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--t2)" }}><Spinner color="var(--positive)" /> Verifying maker TX...</div>
      )}

      {trade.status === "settled" && (
        <div className="text-[13px] font-semibold" style={{ color: "var(--positive)" }}>
          Settled {trade.settle_ms ? "in " + (trade.settle_ms / 1000).toFixed(1) + "s" : ""}
        </div>
      )}

      {(trade.status === "taker_timed_out" || trade.status === "maker_defaulted" || trade.status === "failed") && (
        <div className="px-4 py-3 space-y-2" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: "var(--negative)" }} />
            <span className="text-[14px] font-bold" style={{ color: "var(--negative)" }}>
              {trade.status === "taker_timed_out" ? "Taker Timed Out" : trade.status === "maker_defaulted" ? "Maker Defaulted" : "Trade Failed"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="mono text-[9px] uppercase tracking-wider block" style={{ color: "var(--t3)" }}>Status</span>
              <span style={{ color: "var(--negative)" }}>{trade.status.replace(/_/g, " ").toUpperCase()}</span>
            </div>
            <div>
              <span className="mono text-[9px] uppercase tracking-wider block" style={{ color: "var(--t3)" }}>Duration</span>
              <span style={{ color: "var(--t2)" }}>{trade.settle_ms ? (trade.settle_ms / 1000).toFixed(1) + "s" : "N/A"}</span>
            </div>
            <div>
              <span className="mono text-[9px] uppercase tracking-wider block" style={{ color: "var(--t3)" }}>Defaulting Party</span>
              <span style={{ color: "var(--negative)" }}>
                {trade.status === "taker_timed_out" ? "Taker" : "Maker"}{" "}
                ({trade.status === "taker_timed_out" ? shortAddr(trade.taker_address) : shortAddr(trade.maker_address)})
              </span>
            </div>
            <div>
              <span className="mono text-[9px] uppercase tracking-wider block" style={{ color: "var(--t3)" }}>Penalty</span>
              <span style={{ color: "var(--negative)" }}>
                {trade.status === "taker_timed_out" ? "-33% reputation" : "-67% reputation + vault liquidation"}
              </span>
            </div>
            {trade.taker_deadline && (
              <div>
                <span className="mono text-[9px] uppercase tracking-wider block" style={{ color: "var(--t3)" }}>Taker Deadline</span>
                <span className="mono" style={{ color: "var(--t3)" }}>{new Date(trade.taker_deadline).toLocaleString()}</span>
              </div>
            )}
            {trade.maker_deadline && (
              <div>
                <span className="mono text-[9px] uppercase tracking-wider block" style={{ color: "var(--t3)" }}>Maker Deadline</span>
                <span className="mono" style={{ color: "var(--t3)" }}>{new Date(trade.maker_deadline).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <AuditTrail tradeId={trade.id} />

      {logs.length > 0 && (
        <div className="mt-2 px-2.5 py-2 rounded max-h-36 overflow-y-auto" style={{ background: "var(--bg)" }}>
          {logs.map((l, i) => <LogLine key={i} {...l} />)}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   MAIN DASHBOARD
   ══════════════════════════════════════════════════════ */
function OrderbookDashboard() {
  const { supraAddress, signAction } = useWallet();
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<"profile" | "vault">("profile");

  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);

  // Filters
  const [chainFilter, setChainFilter] = useState("All");
  const [assetFilter, setAssetFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<"all" | "mine">("all");
  const [viewMode, setViewMode] = useState<"list" | "grouped">("list");

  // Quote/accept
  const [expandedRfq, setExpandedRfq] = useState<string | null>(null);
  const [expandedInFlight, setExpandedInFlight] = useState<string | null>(null);
  const [quotingRfq, setQuotingRfq] = useState<string | null>(null);
  const [quotePrice, setQuotePrice] = useState("");
  const [quotingLoading, setQuotingLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [inspectingVault, setInspectingVault] = useState<string | null>(null);
  const [inspectingTaker, setInspectingTaker] = useState<string | null>(null);

  // Sidebar
  const [expandedQuote, setExpandedQuote] = useState<string | null>(null);
  const [quotesView, setQuotesView] = useState<"live" | "past">("live");

  // Oracle
  const [usdPrices, setUsdPrices] = useState<Record<string, number>>({});

  const fetchAll = useCallback(async () => {
    const [r, q, a, t] = await Promise.all([
      supabase.from("rfqs").select("*").order("created_at", { ascending: false }),
      supabase.from("quotes").select("*").order("created_at", { ascending: false }),
      supabase.from("agents").select("*").order("created_at", { ascending: false }),
      supabase.from("trades").select("*").order("created_at", { ascending: false }),
    ]);
    if (r.data) setRfqs(r.data);
    if (q.data) setQuotes(q.data);
    if (a.data) setAgents(a.data);
    if (t.data) setTrades(t.data);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    const channel = supabase.channel("rt-orderbook")
      .on("postgres_changes", { event: "*", schema: "public", table: "rfqs" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "trades" }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchAll]);
  useEffect(() => { const iv = setInterval(fetchAll, 3000); return () => clearInterval(iv); }, [fetchAll]);

  useEffect(() => {
    const pairs = ["ETH/SUPRA", "fxUSDC/SUPRA", "fxAAVE/SUPRA", "fxLINK/SUPRA"];
    Promise.all(pairs.map(p => fetch(`/api/oracle?pair=${encodeURIComponent(p)}`).then(r => r.json()).catch(() => null)))
      .then(results => {
        const prices: Record<string, number> = {};
        for (const d of results) { if (!d) continue; if (d.base?.token && d.base?.price) prices[d.base.token.replace("fx", "")] = d.base.price; if (d.quote?.token && d.quote?.price) prices[d.quote.token.replace("fx", "")] = d.quote.price; }
        if (!prices["USDC"]) prices["USDC"] = 1; if (!prices["USDT"]) prices["USDT"] = 1;
        setUsdPrices(prices);
      });
  }, []);

  function toUsd(amount: number, token: string): string | null {
    const clean = token.replace("fx", ""); const price = usdPrices[clean];
    if (!price || amount <= 0) return null;
    const total = amount * price;
    return total >= 1 ? "$" + total.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "$" + total.toFixed(4);
  }

  // Draggable split panel
  const [splitPercent, setSplitPercent] = useState(75);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.min(90, Math.max(30, pct)));
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  // Filtered RFQs (include matched so in-flight trades are clickable)
  const openRfqs = rfqs.filter(r => r.status === "open" || r.status === "matched");
  const filteredRfqs = openRfqs.filter(r => {
    if (chainFilter === "Cross-chain" && r.source_chain === r.dest_chain) return false;
    if (chainFilter === "Same-chain" && r.source_chain !== r.dest_chain) return false;
    if (chainFilter === "Sepolia" && r.source_chain !== "sepolia" && r.dest_chain !== "sepolia") return false;
    if (chainFilter === "Supra" && r.source_chain !== "supra-testnet" && r.dest_chain !== "supra-testnet") return false;
    if (assetFilter.length > 0) { const pc = displayPair(r.pair); if (!assetFilter.some(a => pc.includes(a))) return false; }
    if (ownerFilter === "mine" && supraAddress) {
      const myQuoteOnRfq = quotes.some(q => q.rfq_id === r.id && q.maker_address === supraAddress && (q.status === "pending" || q.status === "review"));
      if (!myQuoteOnRfq && r.taker_address !== supraAddress) return false;
    }
    return true;
  });

  // In-flight trades (for "My Orders" mode)
  const terminalStatuses = ["settled", "failed", "taker_timed_out", "maker_defaulted", "cancelled"];
  const myInFlightTrades = ownerFilter === "mine" && supraAddress
    ? trades.filter(t => !terminalStatuses.includes(t.status) && (t.taker_address === supraAddress || t.maker_address === supraAddress))
    : [];

  const groupedByPair = filteredRfqs.reduce((acc, r) => { const key = displayPair(r.pair); if (!acc[key]) acc[key] = []; acc[key].push(r); return acc; }, {} as Record<string, RFQ[]>);

  const myQuotes = supraAddress ? quotes.filter(q => q.maker_address === supraAddress && (q.status === "pending" || q.status === "review")) : [];
  const myPastQuotes = supraAddress ? quotes.filter(q => q.maker_address === supraAddress && q.status !== "pending" && q.status !== "review") : [];

  // Actions
  const acceptQuote = async (quoteId: string) => {
    if (!supraAddress) return;
    setAccepting(quoteId);
    try {
      const body: any = { action: "accept_quote", quoteId, agentAddress: supraAddress };
      try {
        const signed = await signAction("accept_quote", { quoteId });
        body.signedPayload = signed.payload; body.signature = signed.signature; body.payloadHash = signed.payloadHash;
        body.sessionNonce = signed.payload.sessionNonce; body.sessionPublicKey = signed.sessionPublicKey;
        body.sessionAuthSignature = signed.sessionAuthSignature; body.sessionCreatedAt = signed.sessionCreatedAt;
      } catch {}
      const res = await fetch("/api/skill/suprafx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else { if (data.trade?.id) setExpandedInFlight(data.trade.id); fetchAll(); }
    } catch (e: any) { alert(e.message); }
    setAccepting(null);
  };

  const placeQuote = async (rfqId: string) => {
    if (!supraAddress || !quotePrice) return;
    setQuotingLoading(true);
    try {
      const body: any = { action: "place_quote", rfqId, makerAddress: supraAddress, rate: quotePrice };
      try {
        const signed = await signAction("place_quote", { rfqId, rate: quotePrice });
        body.signedPayload = signed.payload; body.signature = signed.signature; body.payloadHash = signed.payloadHash;
        body.sessionNonce = signed.payload.sessionNonce; body.sessionPublicKey = signed.sessionPublicKey;
        body.sessionAuthSignature = signed.sessionAuthSignature; body.sessionCreatedAt = signed.sessionCreatedAt;
      } catch {}
      const res = await fetch("/api/skill/suprafx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.error) alert(data.error); else { setQuotePrice(""); setQuotingRfq(null); fetchAll(); }
    } catch (e) { console.error(e); }
    setQuotingLoading(false);
  };

  const withdrawQuote = async (quoteId: string) => {
    if (!supraAddress) return;
    setWithdrawing(quoteId);
    try {
      const res = await fetch("/api/skill/suprafx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "withdraw_quote", quoteId, agentAddress: supraAddress }) });
      const data = await res.json();
      if (data.error) alert(data.error); else fetchAll();
    } catch (e: any) { alert(e.message); }
    setWithdrawing(null);
  };

  /* ── RFQ Row ── */
  const renderRfqRow = (r: RFQ) => {
    const isMine = r.taker_address === supraAddress;
    const rfqQuotes = quotes.filter(q => q.rfq_id === r.id && q.status !== "rejected" && q.status !== "withdrawn").sort((a, b) => b.rate - a.rate);
    // Check if this RFQ has a linked trade (active or terminal)
    const linkedTrade = trades.find(t => t.rfq_id === r.id && !terminalStatuses.includes(t.status));
    const terminalTrade = !linkedTrade ? trades.find(t => t.rfq_id === r.id && terminalStatuses.includes(t.status)) : null;
    const isMatched = !!linkedTrade || (r.status === "matched" && !terminalTrade);
    const isFailed = !!terminalTrade && !linkedTrade;
    // Auto-expand if it's MY in-flight trade (I'm taker or maker on the linked trade)
    const isMyInFlight = !!linkedTrade && !!supraAddress && (linkedTrade.taker_address === supraAddress || linkedTrade.maker_address === supraAddress);
    const isExpanded = expandedRfq === r.id || isMyInFlight;
    const baseClean = r.pair.split("/")[0]?.replace("fx", "") || "";
    const quoteClean = r.pair.split("/")[1]?.replace("fx", "") || "";
    const notionalUsd = toUsd(r.size * r.reference_price, r.pair.split("/")[1] || "");
    const myExistingQuote = supraAddress ? rfqQuotes.find(q => q.maker_address === supraAddress) : null;

    return (
      <div key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.01] transition-colors"
          onClick={() => { if (!isMyInFlight) setExpandedRfq(isExpanded ? null : r.id); }}>
          <span className="mono text-[11px] w-20 shrink-0" style={{ color: "var(--t3)" }}>{generateTxId(r.display_id, r.taker_address)}</span>
          <span className="text-[13px] font-semibold w-24 shrink-0" style={{ color: "var(--t0)" }}>{displayPair(r.pair)}</span>
          <span className="mono text-[12px] w-20 shrink-0" style={{ color: "var(--t2)" }}>{r.size} {baseClean}</span>
          <div className="w-32 shrink-0">
            <span className="mono text-[12px] font-semibold" style={{ color: r.reference_price > 0 ? "var(--t1)" : "var(--t3)" }}>{r.reference_price > 0 ? fmtRate(r.reference_price) : "N/A"}</span>
            {r.reference_price > 0 && <span className="text-[10px] ml-1" style={{ color: "var(--t3)" }}>{quoteClean}</span>}
            {notionalUsd && <div className="mono text-[10px]" style={{ color: "var(--t3)" }}>{notionalUsd}</div>}
          </div>
          <span className="text-[11px] w-32 shrink-0" style={{ color: "var(--t3)" }}>
            {r.source_chain === r.dest_chain ? "Same-chain" : r.source_chain.replace("-testnet", "") + " > " + r.dest_chain.replace("-testnet", "")}
          </span>
          <div className="w-28 shrink-0">
            {(() => {
              const takerAgent = agents.find(a => a.wallet_address === r.taker_address);
              const rep = takerAgent ? Number(takerAgent.rep_total || 0).toFixed(1) : null;
              return (
                <div>
                  <button onClick={(e) => { e.stopPropagation(); setInspectingTaker(inspectingTaker === r.taker_address ? null : r.taker_address); }}
                    className="text-left hover:underline"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    <span className="mono text-[11px]" style={{ color: isMine ? "var(--accent)" : "var(--t2)" }}>{isMine ? "You" : shortAddr(r.taker_address)}</span>
                  </button>
                  {rep !== null && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="mono text-[9px]" style={{ color: Number(rep) >= 4 ? "var(--positive)" : Number(rep) >= 2 ? "var(--warn)" : "var(--negative)" }}>{"*"} {rep}</span>
                      {takerAgent && <span className="mono text-[9px]" style={{ color: "var(--t3)" }}>{(takerAgent as any).trades_completed || 0} trades</span>}
                    </div>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); setInspectingTaker(inspectingTaker === r.taker_address ? null : r.taker_address); }}
                    className="text-[8px] hover:underline mt-0.5 block"
                    style={{ color: inspectingTaker === r.taker_address ? "var(--accent)" : "var(--t3)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    {inspectingTaker === r.taker_address ? "Hide profile" : "View profile"}
                  </button>
                </div>
              );
            })()}
          </div>
          <span className="mono text-[10px] w-12 shrink-0" style={{ color: "var(--t3)" }}>{timeAgo(r.created_at)}</span>
          <div className="flex items-center gap-2 shrink-0">
            {isMatched && <span className="tag tag-matched">in-flight</span>}
            {isFailed && terminalTrade && (
              <span className={`tag tag-${terminalTrade.status}`} style={
                terminalTrade.status === "settled" ? { background: "rgba(34,197,94,0.12)", color: "var(--positive)" } :
                { background: "rgba(239,68,68,0.12)", color: "var(--negative)" }
              }>
                {terminalTrade.status === "settled" ? "settled" :
                 terminalTrade.status === "taker_timed_out" ? "taker timed out" :
                 terminalTrade.status === "maker_defaulted" ? "maker defaulted" :
                 terminalTrade.status === "failed" ? "failed" :
                 terminalTrade.status === "cancelled" ? "cancelled" :
                 terminalTrade.status.replace(/_/g, " ")}
              </span>
            )}
            {!isMatched && !isFailed && <span className="tag tag-open">{rfqQuotes.length} qt{rfqQuotes.length !== 1 ? "s" : ""}</span>}
            {myExistingQuote && !isMatched && !isFailed && <span className="mono text-[9px] px-1.5 py-0.5 rounded" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>quoted</span>}
            <span className="text-[10px]" style={{ color: "var(--t3)" }}>{isExpanded ? "^" : "v"}</span>
          </div>
        </div>

        {isExpanded && (
          <div className="animate-slide-down" style={{ background: "var(--bg-raised)", borderLeft: "3px solid var(--accent)" }}>

            {/* Taker profile inspection panel */}
            {inspectingTaker === r.taker_address && (() => {
              const takerAgent = agents.find(a => a.wallet_address === r.taker_address);
              const takerTrades = trades.filter(t => t.taker_address === r.taker_address || t.maker_address === r.taker_address);
              const settled = takerTrades.filter(t => t.status === "settled");
              const timedOut = takerTrades.filter(t => t.status === "taker_timed_out" || t.status === "maker_defaulted");
              return (
                <div className="px-6 py-3" style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="mono text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>Taker Profile</span>
                      <span className="mono text-[11px] select-all" style={{ color: "var(--t2)" }}>{r.taker_address}</span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setInspectingTaker(null); }} className="text-[10px] hover:underline"
                      style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>close</button>
                  </div>

                  {takerAgent ? (
                    <div className="space-y-3">
                      {/* Rep breakdown */}
                      <div className="flex items-center gap-4">
                        {[
                          { label: "Base", value: Number(takerAgent.rep_deposit_base || 0), color: "var(--t2)" },
                          { label: "Performance", value: Number((takerAgent as any).rep_performance || 0), color: "var(--positive)" },
                          { label: "Speed", value: Number((takerAgent as any).rep_speed || 0), color: "var(--accent-light)" },
                          { label: "Penalties", value: Number(takerAgent.rep_penalties || 0), color: "var(--negative)" },
                          { label: "Total", value: Number(takerAgent.rep_total || 0), color: "var(--t0)" },
                        ].map(item => (
                          <div key={item.label} className="text-center">
                            <div className="mono text-[13px] font-bold" style={{ color: item.color }}>{item.value.toFixed(1)}</div>
                            <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>{item.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Trade summary */}
                      <div className="flex items-center gap-4 text-[11px]">
                        <div><span style={{ color: "var(--t3)" }}>Role:</span> <span style={{ color: "var(--t1)" }}>{takerAgent.role || "taker"}</span></div>
                        <div><span style={{ color: "var(--t3)" }}>Settled:</span> <span style={{ color: "var(--positive)" }}>{settled.length}</span></div>
                        <div><span style={{ color: "var(--t3)" }}>Failed:</span> <span style={{ color: timedOut.length > 0 ? "var(--negative)" : "var(--t2)" }}>{timedOut.length}</span></div>
                        <div><span style={{ color: "var(--t3)" }}>Chains:</span> <span style={{ color: "var(--t2)" }}>{(takerAgent.chains || []).join(", ") || "—"}</span></div>
                      </div>

                      {/* Recent trade history */}
                      {takerTrades.length > 0 && (
                        <div>
                          <span className="mono text-[9px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Recent Trades ({takerTrades.length})</span>
                          <div className="overflow-hidden" style={{ border: "1px solid var(--border)", maxHeight: 120, overflowY: "auto" }}>
                            {takerTrades.slice(0, 8).map((t, i) => (
                              <div key={t.id} className="flex items-center gap-3 px-2 py-1 text-[10px] mono"
                                style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                                <span style={{ color: "var(--t3)" }}>{new Date(t.created_at).toLocaleDateString()}</span>
                                <span style={{ color: "var(--t1)" }}>{(t.pair || "").replace(/fx/g, "")}</span>
                                <span style={{ color: "var(--t2)" }}>{t.size}</span>
                                <span className="flex-1" />
                                <span style={{ color:
                                  t.status === "settled" ? "var(--positive)" :
                                  t.status === "taker_timed_out" || t.status === "maker_defaulted" ? "var(--negative)" :
                                  "var(--warn)"
                                }}>{t.status.replace(/_/g, " ")}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[11px]" style={{ color: "var(--t3)" }}>No agent profile found for this address.</div>
                  )}
                </div>
              );
            })()}

            {/* Existing quotes with ACCEPT button for taker */}
            {rfqQuotes.length > 0 && (
              <div>
                <div className="px-6 py-1 flex items-center gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
                  <span className="mono text-[9px] uppercase tracking-wider font-medium w-28 shrink-0" style={{ color: "var(--t3)" }}>Maker</span>
                  <span className="mono text-[9px] uppercase tracking-wider font-medium w-36 shrink-0" style={{ color: "var(--t3)" }}>Rate</span>
                  <span className="mono text-[9px] uppercase tracking-wider font-medium w-20 shrink-0" style={{ color: "var(--t3)" }}>USD</span>
                  <span className="mono text-[9px] uppercase tracking-wider font-medium w-16 shrink-0" style={{ color: "var(--t3)" }}>vs Ask</span>
                  <span className="mono text-[9px] uppercase tracking-wider font-medium w-20 shrink-0" style={{ color: "var(--t3)" }}>Status</span>
                  <span className="mono text-[9px] uppercase tracking-wider font-medium flex-1" style={{ color: "var(--t3)" }}></span>
                </div>
                {rfqQuotes.map(q => {
                  const diff = r.reference_price > 0 ? ((q.rate - r.reference_price) / r.reference_price) * 100 : 0;
                  const qUsd = toUsd(r.size * q.rate, r.pair.split("/")[1] || "");
                  return (
                    <div key={q.id} className="px-6 py-2 flex items-center gap-3 hover:bg-white/[0.02]" style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                      <div className="w-28 shrink-0">
                        <span className="mono text-[11px] truncate block" style={{ color: q.maker_address === supraAddress ? "var(--accent)" : "var(--t2)" }}>
                          {q.maker_address === supraAddress ? "You" : shortAddr(q.maker_address)}
                        </span>
                        <button onClick={(e) => { e.stopPropagation(); setInspectingVault(inspectingVault === q.maker_address ? null : q.maker_address); }}
                          className="text-[9px] hover:underline mt-0.5"
                          style={{ color: inspectingVault === q.maker_address ? "var(--accent)" : "var(--t3)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                          {inspectingVault === q.maker_address ? "Hide deposit" : "Security deposit"}
                        </button>
                      </div>
                      <span className="mono text-[12px] font-semibold w-36 shrink-0" style={{ color: "var(--t1)" }}>{fmtRate(q.rate)} {quoteClean}</span>
                      <span className="mono text-[10px] w-20 shrink-0" style={{ color: "var(--t3)" }}>{qUsd || "--"}</span>
                      <span className="mono text-[11px] w-16 shrink-0" style={{ color: diff >= 0 ? "var(--positive)" : "var(--negative)" }}>{diff >= 0 ? "+" : ""}{diff.toFixed(2)}%</span>
                      <span className="w-20 shrink-0">
                        <span className="tag" style={q.status === "review" ? { background: "rgba(234,179,8,0.12)", color: "var(--warn)" } : {}}>{q.status === "review" ? "In Review" : q.status}</span>
                      </span>
                      <div className="flex-1 flex items-center gap-2 justify-end">
                        {isMine && ownerFilter === "mine" && q.status === "pending" && (
                          <button onClick={(e) => { e.stopPropagation(); acceptQuote(q.id); }} disabled={accepting === q.id}
                            className="px-3 py-1 rounded text-[11px] font-semibold hover:brightness-110 disabled:opacity-50"
                            style={{ background: "var(--positive)", color: "#fff", border: "none" }}>
                            {accepting === q.id ? "..." : "Accept"}
                          </button>
                        )}
                        {q.maker_address === supraAddress && (q.status === "pending" || q.status === "review") && (
                          <button onClick={(e) => { e.stopPropagation(); withdrawQuote(q.id); }} disabled={withdrawing === q.id}
                            className="mono text-[10px] px-2 py-0.5 rounded hover:brightness-110 disabled:opacity-50"
                            style={{ background: "var(--negative-dim)", color: "var(--negative)", border: "none" }}>{withdrawing === q.id ? "..." : "withdraw"}</button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* Vault inspection sub-panel */}
                {inspectingVault && rfqQuotes.some(q => q.maker_address === inspectingVault) && (
                  <div className="animate-slide-down px-6 py-3" style={{ background: "var(--bg)", borderTop: "1px solid var(--border)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="mono text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>Security Deposit</span>
                        <span className="mono text-[11px]" style={{ color: "var(--t2)" }}>
                          {inspectingVault === "auto-maker-bot" ? "SupraFX Bot" : shortAddr(inspectingVault)}
                        </span>
                      </div>
                      <button onClick={() => setInspectingVault(null)} className="text-[10px] hover:underline"
                        style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>close</button>
                    </div>
                    <MakerVaultDetail address={inspectingVault} />
                  </div>
                )}
              </div>
            )}

            {/* Place quote (only for open RFQs, not your own, not already matched) */}
            {!isMine && !isMatched && !isFailed && supraAddress && !myExistingQuote && (
              <div className="px-6 py-3" style={{ borderTop: rfqQuotes.length > 0 ? "1px solid var(--border)" : "none" }}>
                {quotingRfq === r.id ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="mono text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>Your Rate</span>
                    <input type="number" step="any" min="0" placeholder={r.reference_price > 0 ? fmtRate(r.reference_price) : "Enter rate"} value={quotePrice} onChange={e => setQuotePrice(e.target.value)}
                      className="px-3 py-1.5 rounded mono text-[13px] outline-none" style={{ background: "var(--bg)", color: "var(--t0)", border: "1px solid var(--border)", width: 150 }} autoFocus />
                    <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>{quoteClean}/{baseClean}</span>
                    <button onClick={() => placeQuote(r.id)} disabled={quotingLoading || !quotePrice} className="px-3 py-1.5 rounded text-[12px] font-semibold disabled:opacity-30"
                      style={{ background: "var(--positive)", color: "#fff", border: "none" }}>{quotingLoading ? "..." : "Submit"}</button>
                    <button onClick={() => { setQuotingRfq(null); setQuotePrice(""); }} className="text-[11px] hover:underline"
                      style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>cancel</button>
                  </div>
                ) : (
                  <button onClick={() => { setQuotingRfq(r.id); setQuotePrice(r.reference_price > 0 ? fmtRate(r.reference_price) : ""); }}
                    className="px-4 py-1.5 rounded text-[12px] font-semibold hover:brightness-110" style={{ background: "var(--accent)", color: "#fff", border: "none" }}>Place Quote</button>
                )}
              </div>
            )}

            {/* In-flight trade details (shown inline when RFQ is matched) */}
            {linkedTrade && (
              <div style={{ borderTop: "1px solid var(--border)" }}>
                <div className="px-6 py-2 flex items-center gap-3" style={{ background: "var(--surface-2)" }}>
                  <span className="mono text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--warn)" }}>In-Flight</span>
                  <span className="mono text-[11px]" style={{ color: "var(--t2)" }}>{linkedTrade.display_id}</span>
                  <span className={`tag tag-${linkedTrade.status === "open" ? "open_trade" : linkedTrade.status}`}>{linkedTrade.status.replace(/_/g, " ")}</span>
                </div>
                <InFlightTrade trade={linkedTrade} onUpdate={fetchAll} agents={agents} />
              </div>
            )}

            {/* Terminal trade details (shown when trade settled, failed, or timed out) */}
            {terminalTrade && !linkedTrade && (
              <div style={{ borderTop: "1px solid var(--border)" }}>
                <div className="px-6 py-2 flex items-center gap-3" style={{ background: terminalTrade.status === "settled" ? "rgba(34,197,94,0.04)" : "rgba(239,68,68,0.04)" }}>
                  <span className="mono text-[10px] uppercase tracking-wider font-medium" style={{ color: terminalTrade.status === "settled" ? "var(--positive)" : "var(--negative)" }}>
                    {terminalTrade.status === "settled" ? "Settled" : "Failed"}
                  </span>
                  <span className="mono text-[11px]" style={{ color: "var(--t2)" }}>{terminalTrade.display_id}</span>
                  <span className={`tag tag-${terminalTrade.status}`} style={
                    terminalTrade.status === "settled" ? { background: "rgba(34,197,94,0.12)", color: "var(--positive)" } :
                    { background: "rgba(239,68,68,0.12)", color: "var(--negative)" }
                  }>{terminalTrade.status.replace(/_/g, " ")}</span>
                </div>
                <div className="px-6 py-3" style={{ background: "var(--bg-raised)" }}>
                  {terminalTrade.status === "settled" && (
                    <div className="text-[13px] font-semibold" style={{ color: "var(--positive)" }}>
                      Settled {terminalTrade.settle_ms ? "in " + (terminalTrade.settle_ms / 1000).toFixed(1) + "s" : ""}
                    </div>
                  )}
                  {(terminalTrade.status === "taker_timed_out" || terminalTrade.status === "maker_defaulted" || terminalTrade.status === "failed") && (
                    <div className="px-4 py-3 space-y-2" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ background: "var(--negative)" }} />
                        <span className="text-[14px] font-bold" style={{ color: "var(--negative)" }}>
                          {terminalTrade.status === "taker_timed_out" ? "Taker Timed Out" : terminalTrade.status === "maker_defaulted" ? "Maker Defaulted" : "Trade Failed"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="mono text-[9px] uppercase tracking-wider block" style={{ color: "var(--t3)" }}>Defaulting Party</span>
                          <span style={{ color: "var(--negative)" }}>
                            {terminalTrade.status === "taker_timed_out" ? "Taker" : "Maker"}{" "}
                            ({terminalTrade.status === "taker_timed_out" ? shortAddr(terminalTrade.taker_address) : shortAddr(terminalTrade.maker_address)})
                          </span>
                        </div>
                        <div>
                          <span className="mono text-[9px] uppercase tracking-wider block" style={{ color: "var(--t3)" }}>Penalty</span>
                          <span style={{ color: "var(--negative)" }}>
                            {terminalTrade.status === "taker_timed_out" ? "-33% reputation" : "-67% reputation + vault liquidation"}
                          </span>
                        </div>
                        {terminalTrade.taker_deadline && (
                          <div>
                            <span className="mono text-[9px] uppercase tracking-wider block" style={{ color: "var(--t3)" }}>Taker Deadline</span>
                            <span className="mono" style={{ color: "var(--t3)" }}>{new Date(terminalTrade.taker_deadline).toLocaleString()}</span>
                          </div>
                        )}
                        {terminalTrade.maker_deadline && (
                          <div>
                            <span className="mono text-[9px] uppercase tracking-wider block" style={{ color: "var(--t3)" }}>Maker Deadline</span>
                            <span className="mono" style={{ color: "var(--t3)" }}>{new Date(terminalTrade.maker_deadline).toLocaleString()}</span>
                          </div>
                        )}
                        {terminalTrade.settle_ms && (
                          <div>
                            <span className="mono text-[9px] uppercase tracking-wider block" style={{ color: "var(--t3)" }}>Duration</span>
                            <span style={{ color: "var(--t2)" }}>{(terminalTrade.settle_ms / 1000).toFixed(1)}s</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <AuditTrail tradeId={terminalTrade.id} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <Header onProfileClick={() => { setProfileTab("profile"); setProfileOpen(true); }} activePage="orderbook" />
      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} initialTab={profileTab} />
      <div className="max-w-[1400px] mx-auto px-4 py-3">

        {/* TOP STRIP */}
        <div className="mb-4">
          <OracleTicker />
        </div>

        {/* FILTER BAR */}
        <div className="card mb-4">
          <div className="px-4 py-3 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: "var(--t3)" }}>Route</span>
              {CHAINS.map(c => (
                <button key={c} onClick={() => setChainFilter(c)} className="px-2 py-0.5 rounded text-[11px] font-medium transition-all"
                  style={{ background: chainFilter === c ? "var(--accent)" : "transparent", color: chainFilter === c ? "#fff" : "var(--t3)", border: "1px solid " + (chainFilter === c ? "var(--accent)" : "var(--border)") }}>{c}</button>
              ))}
            </div>
            <div className="w-px h-5" style={{ background: "var(--border)" }} />
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: "var(--t3)" }}>Asset</span>
              {ASSETS.map(a => (
                <button key={a} onClick={() => setAssetFilter(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a])} className="px-2 py-0.5 rounded text-[11px] font-medium transition-all"
                  style={{ background: assetFilter.includes(a) ? "var(--accent)" : "transparent", color: assetFilter.includes(a) ? "#fff" : "var(--t3)", border: "1px solid " + (assetFilter.includes(a) ? "var(--accent)" : "var(--border)") }}>{a}</button>
              ))}
              {assetFilter.length > 0 && <button onClick={() => setAssetFilter([])} className="text-[10px] hover:underline ml-1" style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>clear</button>}
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              {(["list", "grouped"] as const).map(v => (
                <button key={v} onClick={() => setViewMode(v)} className="px-2.5 py-0.5 rounded text-[11px] font-medium transition-all"
                  style={{ background: viewMode === v ? "var(--surface-3)" : "transparent", color: viewMode === v ? "var(--t0)" : "var(--t3)", border: "1px solid " + (viewMode === v ? "var(--border-active)" : "var(--border)") }}>
                  {v === "list" ? "List" : "By Pair"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Open RFQs card — contains the split panel */}
        <div className="card mb-4">
          {/* Card header */}
          <div className="card-header">
            <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>Open RFQs</span>
            <div className="flex items-center gap-2">
              {(["all", "mine"] as const).map(f => (
                <button key={f} onClick={() => setOwnerFilter(f)} className="px-2.5 py-0.5 rounded text-[11px] font-medium transition-all"
                  style={{ background: ownerFilter === f ? "var(--accent)" : "transparent", color: ownerFilter === f ? "#fff" : "var(--t3)", border: "1px solid " + (ownerFilter === f ? "var(--accent)" : "var(--border)") }}>
                  {f === "all" ? "All" : "My Orders"}
                </button>
              ))}
              <span className="mono text-[11px] ml-1" style={{ color: "var(--t3)" }}>{filteredRfqs.length}</span>
            </div>
          </div>

          {/* Split panel inside the card */}
          <div ref={containerRef} className="flex gap-0" style={{ alignItems: "stretch", minHeight: "300px" }}>

            {/* LEFT: RFQ list */}
            <div style={{ width: `${splitPercent}%`, minWidth: 0, overflow: "auto" }}>
              {filteredRfqs.length === 0 ? (
                <div className="py-8 text-center text-[13px]" style={{ color: "var(--t3)" }}>{openRfqs.length === 0 ? "No open RFQs" : "No RFQs match your filters"}</div>
              ) : viewMode === "list" ? (
                <div>
                  <div className="flex items-center gap-3 px-4 py-1.5" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                    {["TX ID", "Pair", "Size", "Asking", "Route", "Taker", "Age", "Quotes"].map(h => (
                      <span key={h} className={"mono text-[9px] uppercase tracking-wider font-medium " + (h === "TX ID" ? "w-20" : h === "Pair" ? "w-24" : h === "Size" ? "w-20" : h === "Asking" ? "w-32" : h === "Route" ? "w-32" : h === "Taker" ? "w-24" : h === "Age" ? "w-12" : "shrink-0")}
                        style={{ color: "var(--t3)" }}>{h}</span>
                    ))}
                  </div>
                  {filteredRfqs.map(renderRfqRow)}
                </div>
              ) : (
                <div>
                  {Object.entries(groupedByPair).sort(([, a], [, b]) => b.length - a.length).map(([pair, pairRfqs]) => (
                    <div key={pair}>
                      <div className="px-4 py-2 flex items-center gap-3" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)", borderTop: "1px solid var(--border)" }}>
                        <span className="text-[13px] font-semibold" style={{ color: "var(--t0)" }}>{pair}</span>
                        <span className="mono text-[11px]" style={{ color: "var(--t3)" }}>{pairRfqs.length} RFQ{pairRfqs.length !== 1 ? "s" : ""}</span>
                      </div>
                      {pairRfqs.map(renderRfqRow)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Drag handle */}
            <div onMouseDown={onMouseDown} className="shrink-0 flex items-center justify-center group" style={{ width: "12px", cursor: "col-resize", position: "relative", borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)" }}>
              <div className="w-[2px] h-full rounded-full transition-colors group-hover:w-[3px]" style={{ background: "var(--border)" }} />
              <div className="absolute w-5 h-10 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "var(--surface-3)", border: "1px solid var(--border)" }}>
                <span className="mono text-[8px]" style={{ color: "var(--t3)" }}>||</span>
              </div>
            </div>

            {/* RIGHT: My Quotes */}
            <div style={{ width: `${100 - splitPercent}%`, minWidth: 0, overflow: "auto" }}>
              <div className="px-3 py-2 flex items-center justify-between" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                <div className="flex items-center gap-1">
                  {(["live", "past"] as const).map(v => (
                    <button key={v} onClick={() => { setQuotesView(v); setExpandedQuote(null); }}
                      className="px-2 py-0.5 rounded text-[10px] font-medium transition-all"
                      style={{ background: quotesView === v ? "var(--accent)" : "transparent", color: quotesView === v ? "#fff" : "var(--t3)", border: "1px solid " + (quotesView === v ? "var(--accent)" : "var(--border)") }}>
                      {v === "live" ? "Live" : "Past"}
                    </button>
                  ))}
                </div>
                <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
                  {quotesView === "live" ? myQuotes.length : myPastQuotes.length}
                </span>
              </div>

              {/* Live Quotes */}
              {quotesView === "live" && (
                myQuotes.length === 0 ? (
                  <div className="py-6 text-center text-[12px]" style={{ color: "var(--t3)" }}>No live quotes</div>
                ) : (
                  <div>
                    {myQuotes.map(q => {
                      const rfq = rfqs.find(r => r.id === q.rfq_id);
                      const baseClean = rfq ? rfq.pair.split("/")[0]?.replace("fx", "") || "" : "";
                      const quoteClean = rfq ? rfq.pair.split("/")[1]?.replace("fx", "") || "" : "";
                      const diff = rfq && rfq.reference_price > 0 ? ((q.rate - rfq.reference_price) / rfq.reference_price) * 100 : 0;
                      const isQExpanded = expandedQuote === q.id;
                      const notionalUsd = rfq ? toUsd(rfq.size * q.rate, rfq.pair.split("/")[1] || "") : null;
                      return (
                        <div key={q.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <div className="px-3 py-2.5 cursor-pointer hover:bg-white/[0.02]" onClick={() => setExpandedQuote(isQExpanded ? null : q.id)}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[13px] font-semibold" style={{ color: "var(--t0)" }}>{rfq ? displayPair(rfq.pair) : "--"}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="tag" style={q.status === "review" ? { background: "rgba(234,179,8,0.12)", color: "var(--warn)" } : {}}>{q.status === "review" ? "review" : q.status}</span>
                                <span className="text-[9px]" style={{ color: "var(--t3)" }}>{isQExpanded ? "^" : "v"}</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="mono text-[12px] font-semibold" style={{ color: "var(--t1)" }}>{fmtRate(q.rate)} {quoteClean}</span>
                              <span className="mono text-[10px]" style={{ color: diff >= 0 ? "var(--positive)" : "var(--negative)" }}>{diff >= 0 ? "+" : ""}{diff.toFixed(2)}%</span>
                            </div>
                          </div>
                          {isQExpanded && (
                            <div className="animate-slide-down px-3 pb-3 space-y-2" style={{ background: "var(--bg-raised)", borderTop: "1px solid var(--border)" }}>
                              <div className="grid grid-cols-2 gap-2 pt-2">
                                <div><div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Size</div><div className="mono text-[12px]" style={{ color: "var(--t1)" }}>{rfq ? rfq.size : "--"} {baseClean}</div></div>
                                <div><div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Notional</div><div className="mono text-[12px]" style={{ color: "var(--t1)" }}>{notionalUsd || "--"}</div></div>
                                <div><div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>RFQ Asking</div><div className="mono text-[12px]" style={{ color: "var(--t2)" }}>{rfq ? fmtRate(rfq.reference_price) : "--"} {quoteClean}</div></div>
                                <div><div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Route</div><div className="text-[11px]" style={{ color: "var(--t2)" }}>{rfq ? (rfq.source_chain === rfq.dest_chain ? "Same-chain" : rfq.source_chain.replace("-testnet", "") + " > " + rfq.dest_chain.replace("-testnet", "")) : "--"}</div></div>
                                <div><div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Taker</div><div className="mono text-[11px]" style={{ color: "var(--t2)" }}>{rfq ? shortAddr(rfq.taker_address) : "--"}</div></div>
                                <div><div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Quoted</div><div className="mono text-[11px]" style={{ color: "var(--t3)" }}>{timeAgo(q.created_at)}</div></div>
                              </div>
                              <div className="pt-1">
                                <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: "var(--t3)" }}>Your Vault</div>
                                <MakerVaultDetail address={supraAddress || ""} />
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); withdrawQuote(q.id); }} disabled={withdrawing === q.id}
                                className="w-full py-1.5 rounded text-[11px] font-semibold hover:brightness-110 disabled:opacity-50"
                                style={{ background: "var(--negative)", color: "#fff", border: "none" }}>{withdrawing === q.id ? "Withdrawing..." : "Withdraw Quote"}</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              )}

              {/* Past Quotes */}
              {quotesView === "past" && (
                myPastQuotes.length === 0 ? (
                  <div className="py-6 text-center text-[12px]" style={{ color: "var(--t3)" }}>No past quotes</div>
                ) : (
                  <div>
                    {myPastQuotes.map(q => {
                      const rfq = rfqs.find(r => r.id === q.rfq_id);
                      const baseClean = rfq ? rfq.pair.split("/")[0]?.replace("fx", "") || "" : "";
                      const quoteClean = rfq ? rfq.pair.split("/")[1]?.replace("fx", "") || "" : "";
                      const diff = rfq && rfq.reference_price > 0 ? ((q.rate - rfq.reference_price) / rfq.reference_price) * 100 : 0;
                      const isQExpanded = expandedQuote === q.id;
                      const statusColor = q.status === "accepted" ? "var(--positive)" : q.status === "rejected" ? "var(--negative)" : "var(--t3)";
                      return (
                        <div key={q.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <div className="px-3 py-2.5 cursor-pointer hover:bg-white/[0.02]" onClick={() => setExpandedQuote(isQExpanded ? null : q.id)}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[13px] font-semibold" style={{ color: "var(--t0)" }}>{rfq ? displayPair(rfq.pair) : "--"}</span>
                              <div className="flex items-center gap-1.5">
                                <span className={`tag tag-${q.status}`}>{q.status}</span>
                                <span className="text-[9px]" style={{ color: "var(--t3)" }}>{isQExpanded ? "^" : "v"}</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="mono text-[12px]" style={{ color: "var(--t2)" }}>{fmtRate(q.rate)} {quoteClean}</span>
                              <span className="mono text-[10px]" style={{ color: diff >= 0 ? "var(--positive)" : "var(--negative)" }}>{diff >= 0 ? "+" : ""}{diff.toFixed(2)}%</span>
                            </div>
                          </div>
                          {isQExpanded && (
                            <div className="animate-slide-down px-3 pb-3 space-y-2" style={{ background: "var(--bg-raised)", borderTop: "1px solid var(--border)" }}>
                              <div className="grid grid-cols-2 gap-2 pt-2">
                                <div><div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Size</div><div className="mono text-[12px]" style={{ color: "var(--t1)" }}>{rfq ? rfq.size : "--"} {baseClean}</div></div>
                                <div><div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Rate</div><div className="mono text-[12px]" style={{ color: "var(--t1)" }}>{fmtRate(q.rate)} {quoteClean}</div></div>
                                <div><div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>RFQ Asking</div><div className="mono text-[12px]" style={{ color: "var(--t2)" }}>{rfq ? fmtRate(rfq.reference_price) : "--"} {quoteClean}</div></div>
                                <div><div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Route</div><div className="text-[11px]" style={{ color: "var(--t2)" }}>{rfq ? (rfq.source_chain === rfq.dest_chain ? "Same-chain" : rfq.source_chain.replace("-testnet", "") + " > " + rfq.dest_chain.replace("-testnet", "")) : "--"}</div></div>
                                <div><div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Taker</div><div className="mono text-[11px]" style={{ color: "var(--t2)" }}>{rfq ? shortAddr(rfq.taker_address) : "--"}</div></div>
                                <div><div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Quoted</div><div className="mono text-[11px]" style={{ color: "var(--t3)" }}>{timeAgo(q.created_at)}</div></div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>

          </div>
        </div>
      </div>

      <div className="text-center py-6 mono text-[11px] uppercase tracking-[2px] border-t mt-10" style={{ color: "var(--t3)", borderColor: "var(--border)" }}>
        SupraFX Protocol · Sepolia ↔ Supra Testnet · Committee-Verified Settlement
      </div>
    </div>
  );
}

export default function OrderbookPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <WalletProvider><OrderbookDashboard /></WalletProvider>;
}
