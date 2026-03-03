"use client";
import { useWallet } from "./WalletProvider";
import { RFQ, Trade, Quote, Agent } from "@/lib/types";

function displayPair(pair: string) {
  return pair.replace(/fx/g, "");
}

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

function statusLabel(status: string) {
  switch (status) {
    case "settled": return "Settled";
    case "failed": return "Failed";
    case "open": return "Open";
    case "cancelled": return "Cancelled";
    case "matched": return "Matched";
    case "expired": return "Expired";
    default: return status.replace(/_/g, " ");
  }
}

interface Props {
  rfqs: RFQ[];
  trades: Trade[];
  quotes: Quote[];
  agents: Agent[];
}

export default function MyTrades({ rfqs, trades, quotes, agents }: Props) {
  const { supraAddress } = useWallet();
  if (!supraAddress) return null;

  // All RFQs I created
  const myRfqs = rfqs
    .filter(r => r.taker_address === supraAddress)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // All trades I'm part of (taker or maker)
  const myTrades = trades
    .filter(t => t.taker_address === supraAddress || t.maker_address === supraAddress)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Stats
  const settled = myTrades.filter(t => t.status === "settled").length;
  const inFlight = myTrades.filter(t => !["settled", "failed"].includes(t.status)).length;
  const failed = myTrades.filter(t => t.status === "failed").length;
  const cancelled = myRfqs.filter(r => r.status === "cancelled").length;
  const avgSettleMs = (() => {
    const times = myTrades.filter(t => t.settle_ms).map(t => t.settle_ms!);
    return times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  })();

  const myAgent = agents.find(a => a.wallet_address === supraAddress);

  if (myRfqs.length === 0 && myTrades.length === 0) return null;

  return (
    <div className="card mb-4 animate-in">
      <div className="card-header">
        <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>My Trade History</span>
        <div className="flex items-center gap-3">
          {myAgent && (
            <span className="mono text-[11px] px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--positive)" }}>
              {"★"} {Number(myAgent.rep_total).toFixed(1)} rep
            </span>
          )}
          <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>
            {supraAddress.slice(0, 8)}{"…"}{supraAddress.slice(-4)}
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
          <span className="mono text-[14px] font-semibold" style={{ color: "var(--t3)" }}>{cancelled}</span>
        </div>
        {avgSettleMs > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Avg Settle</span>
            <span className="mono text-[14px] font-semibold" style={{ color: "var(--positive)" }}>{(avgSettleMs / 1000).toFixed(1)}s</span>
          </div>
        )}
      </div>

      {/* Trade list */}
      {myTrades.length > 0 && (
        <div>
          <div className="px-4 py-1.5 flex items-center gap-4" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
            {["ID", "Pair", "Size", "Rate", "Side", "Counterparty", "Route", "Time", "Status"].map(h => (
              <span key={h} className={"mono text-[10px] uppercase tracking-wider font-medium " +
                (h === "ID" ? "w-24" : h === "Pair" ? "w-24" : h === "Size" ? "w-20" : h === "Rate" ? "w-28" : h === "Side" ? "w-14" : h === "Counterparty" ? "w-28" : h === "Route" ? "flex-1" : h === "Time" ? "w-16" : "w-20")}
                style={{ color: "var(--t3)" }}>{h}</span>
            ))}
          </div>
          {myTrades.map(t => {
            const side = t.taker_address === supraAddress ? "Taker" : "Maker";
            const counterparty = side === "Taker" ? t.maker_address : t.taker_address;
            const counterChain = side === "Taker" ? t.dest_chain : t.source_chain;
            const pairClean = displayPair(t.pair);
            const [, quote] = t.pair.split("/");
            const quoteClean = quote?.replace("fx", "") || "";

            return (
              <div key={t.id} className="px-4 py-2.5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                <span className="mono text-[12px] w-24" style={{ color: "var(--t3)" }}>{t.display_id}</span>
                <span className="text-[13px] font-semibold w-24">{pairClean}</span>
                <span className="mono text-[13px] w-20">{t.size}</span>
                <span className="mono text-[13px] w-28" style={{ color: "var(--t1)" }}>{fmtRate(t.rate)} {quoteClean}</span>
                <span className="text-[12px] w-14 font-medium" style={{ color: side === "Taker" ? "var(--accent)" : "var(--positive)" }}>{side}</span>
                <span className="mono text-[12px] w-28" style={{ color: "var(--t2)" }}>{shortAddr(counterparty)}</span>
                <span className="text-[12px] flex-1" style={{ color: "var(--t3)" }}>{t.source_chain} {"→"} {t.dest_chain}</span>
                <span className="mono text-[12px] w-16" style={{ color: t.settle_ms ? "var(--positive)" : "var(--t3)" }}>
                  {t.settle_ms ? (t.settle_ms / 1000).toFixed(1) + "s" : "—"}
                </span>
                <span className="w-20">
                  <span className={`tag tag-${t.status === "open" ? "open_trade" : t.status}`}>{statusLabel(t.status)}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Cancelled RFQs */}
      {cancelled > 0 && (
        <div>
          <div className="px-4 py-1.5" style={{ background: "var(--surface-2)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
            <span className="mono text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>Cancelled RFQs</span>
          </div>
          {myRfqs.filter(r => r.status === "cancelled").map(r => {
            const pairClean = displayPair(r.pair);
            const [base, quote] = r.pair.split("/");
            const baseClean = base.replace("fx", "");
            const quoteClean = quote?.replace("fx", "") || "";
            return (
              <div key={r.id} className="px-4 py-2.5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                <span className="mono text-[12px] w-24" style={{ color: "var(--t3)" }}>{r.display_id}</span>
                <span className="text-[13px] font-semibold w-24">{pairClean}</span>
                <span className="mono text-[13px] w-20">{r.size} {baseClean}</span>
                <span className="mono text-[13px] w-28" style={{ color: "var(--t2)" }}>Asked {fmtRate(r.reference_price)} {quoteClean}</span>
                <span className="text-[12px] flex-1" style={{ color: "var(--t3)" }}>{r.source_chain} {"→"} {r.dest_chain}</span>
                <span className="w-20"><span className="tag tag-cancelled">Cancelled</span></span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
