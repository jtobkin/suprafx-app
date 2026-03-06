"use client";
import { useState } from "react";
import { Agent, Trade } from "@/lib/types";

const PAGE_SIZE = 15;

function shortAddr(addr: string) {
  if (addr === "auto-maker-bot") return "SupraFX Bot";
  if (addr.length > 20) return addr.slice(0, 6) + "..." + addr.slice(-4);
  return addr;
}

function addrUrl(addr: string) {
  if (addr === "auto-maker-bot") return null;
  if (addr.startsWith("0x") && addr.length > 50) {
    return `https://testnet.suprascan.io/account/${addr.replace(/^0x/, "")}`;
  }
  return `https://sepolia.etherscan.io/address/${addr}`;
}

function displayPair(pair: string) { return pair.replace(/fx/g, ""); }

function fmtRate(n: number) {
  if (n >= 1000) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function repDelta(settleMs: number | null, status: string): { label: string; value: string; color: string } {
  if (status === "taker_timed_out") return { label: "Taker Timeout", value: "-33%", color: "var(--negative)" };
  if (status === "maker_defaulted") return { label: "Maker Default", value: "-67%", color: "var(--negative)" };
  if (status !== "settled" || !settleMs) return { label: status.replace(/_/g, " "), value: "--", color: "var(--t3)" };
  const sec = settleMs / 1000;
  if (sec < 300) return { label: "Speed Bonus", value: "+5.0", color: "var(--positive)" };
  if (sec < 900) return { label: "Good", value: "+3.0", color: "var(--positive)" };
  if (sec < 1800) return { label: "OK", value: "+1.0", color: "var(--accent-light)" };
  return { label: "Settled", value: "+0", color: "var(--t3)" };
}

type Filter = "all" | "taker" | "maker";

interface Props {
  agents: Agent[];
  trades?: Trade[];
}

export default function AgentsPanel({ agents, trades = [] }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = filter === "all" ? agents : agents.filter(a => a.role === filter);

  const sorted = [...filtered].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const getAgentTrades = (addr: string) =>
    trades.filter(t => t.taker_address === addr || t.maker_address === addr)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const filterBtn = (label: string, value: Filter) => (
    <button key={value} onClick={() => { setFilter(value); setPage(0); }}
      className="px-2 py-0.5 rounded text-[11px] font-medium transition-all"
      style={{
        background: filter === value ? "var(--accent)" : "transparent",
        color: filter === value ? "#fff" : "var(--t3)",
        border: "1px solid " + (filter === value ? "var(--accent)" : "var(--border)"),
      }}>
      {label}
    </button>
  );

  return (
    <div className="card mb-4 animate-in" style={{ overflow: "hidden" }}>
      <div className="card-header">
        <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>Counterparties</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            {filterBtn("All", "all")}
            {filterBtn("Takers", "taker")}
            {filterBtn("Makers", "maker")}
          </div>
          <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>
            {sorted.length} agent{sorted.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="py-6 text-center text-[14px]" style={{ color: "var(--t3)" }}>
          No {filter === "all" ? "agents" : filter + "s"} registered
        </div>
      ) : (
        <>
          <div>
            {pageItems.map((a, i) => {
              const url = addrUrl(a.wallet_address);
              const isExpanded = expanded === a.id;
              const agentTrades = isExpanded ? getAgentTrades(a.wallet_address) : [];
              return (
                <div key={a.id} style={{ borderBottom: i < pageItems.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <div
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-white/[0.01] transition-colors"
                    onClick={() => setExpanded(isExpanded ? null : a.id)}>
                    <div className="flex items-center gap-2 w-36 shrink-0">
                      {url ? (
                        <a href={url} target="_blank" rel="noopener"
                          onClick={e => e.stopPropagation()}
                          className="mono text-[12px] hover:underline truncate" style={{ color: "var(--accent-light)" }}>
                          {a.domain || shortAddr(a.wallet_address)}
                        </a>
                      ) : (
                        <span className="mono text-[12px] truncate" style={{ color: "var(--t2)" }}>
                          {a.domain || shortAddr(a.wallet_address)}
                        </span>
                      )}
                    </div>

                    <div className="w-16 shrink-0">
                      <span className={`tag tag-${a.role}`}>{a.role}</span>
                    </div>

                    <div className="flex items-center gap-1 w-28 shrink-0">
                      {(a.chains || []).map(ch => (
                        <span key={ch} className="mono text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: "var(--surface-2)", color: "var(--t3)", border: "1px solid var(--border)" }}>
                          {ch}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center gap-1 w-16 shrink-0">
                      <span className="mono text-[12px] font-semibold" style={{ color: Number(a.rep_total) >= 4 ? "var(--positive)" : "var(--t3)" }}>
                        * {Number(a.rep_total).toFixed(1)}
                      </span>
                    </div>

                    <div className="w-16 shrink-0">
                      <span className="mono text-[12px]" style={{ color: "var(--t2)" }}>{a.trade_count || 0}</span>
                      <span className="text-[10px] ml-1" style={{ color: "var(--t3)" }}>trades</span>
                    </div>

                    <div className="flex-1 flex items-center justify-end gap-2">
                      <span className="mono text-[11px]" style={{ color: "var(--t3)" }}>
                        {new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--t3)" }}>{isExpanded ? "^" : "v"}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="animate-slide-down" style={{ background: "var(--bg-raised)", borderTop: "1px solid var(--border)" }}>
                      {/* Rep breakdown */}
                      <div className="px-5 py-3 flex items-center gap-6" style={{ borderBottom: "1px solid var(--border)" }}>
                        <div className="mono text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>Reputation Breakdown</div>
                        <div className="flex items-center gap-4">
                          {[
                            { label: "Base", value: a.rep_deposit_base, color: "var(--t2)" },
                            { label: "Performance", value: a.rep_performance, color: "var(--positive)" },
                            { label: "Speed", value: a.rep_speed_bonus, color: "var(--accent-light)" },
                            { label: "Penalties", value: a.rep_penalties, color: a.rep_penalties > 0 ? "var(--negative)" : "var(--t3)" },
                            { label: "Total", value: a.rep_total, color: Number(a.rep_total) >= 4 ? "var(--positive)" : "var(--warn)" },
                          ].map(item => (
                            <div key={item.label} className="text-center">
                              <div className="mono text-[13px] font-semibold" style={{ color: item.color }}>
                                {Number(item.value).toFixed(1)}
                              </div>
                              <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>{item.label}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Trade history */}
                      <div className="px-5 py-2">
                        <div className="mono text-[10px] uppercase tracking-wider font-medium mb-2" style={{ color: "var(--t3)" }}>
                          Trade History ({agentTrades.length})
                        </div>
                        {agentTrades.length === 0 ? (
                          <div className="text-[12px] py-2" style={{ color: "var(--t3)" }}>No trades yet</div>
                        ) : (
                          <div className="rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                            <div className="flex items-center gap-3 px-3 py-1" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                              {["Date", "Pair", "Size", "Rate", "Side", "Status", "Duration", "Rep Impact"].map(h => (
                                <span key={h} className={"mono text-[9px] uppercase tracking-wider font-medium " +
                                  (h === "Date" ? "w-20" : h === "Pair" ? "w-24" : h === "Size" ? "w-16" : h === "Rate" ? "w-20" : h === "Side" ? "w-14" : h === "Status" ? "w-24" : h === "Duration" ? "w-16" : "flex-1")}
                                  style={{ color: "var(--t3)" }}>{h}</span>
                              ))}
                            </div>
                            {agentTrades.slice(0, 20).map((t, ti) => {
                              const side = t.taker_address === a.wallet_address ? "taker" : "maker";
                              const delta = repDelta(t.settle_ms, t.status);
                              return (
                                <div key={t.id} className="flex items-center gap-3 px-3 py-1.5"
                                  style={{ borderBottom: ti < Math.min(agentTrades.length, 20) - 1 ? "1px solid var(--border)" : "none" }}>
                                  <span className="mono text-[11px] w-20 shrink-0" style={{ color: "var(--t3)" }}>
                                    {new Date(t.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                  </span>
                                  <span className="text-[12px] font-semibold w-24 shrink-0">{displayPair(t.pair)}</span>
                                  <span className="mono text-[11px] w-16 shrink-0" style={{ color: "var(--t2)" }}>{t.size}</span>
                                  <span className="mono text-[11px] w-20 shrink-0" style={{ color: "var(--t1)" }}>{fmtRate(t.rate)}</span>
                                  <span className="w-14 shrink-0">
                                    <span className={`tag tag-${side}`}>{side}</span>
                                  </span>
                                  <span className="w-24 shrink-0">
                                    <span className={`tag tag-${t.status === "settled" ? "settled" : t.status === "taker_timed_out" || t.status === "maker_defaulted" ? "failed" : t.status}`}>
                                      {t.status.replace(/_/g, " ")}
                                    </span>
                                  </span>
                                  <span className="mono text-[11px] w-16 shrink-0" style={{ color: t.settle_ms ? "var(--t2)" : "var(--t3)" }}>
                                    {t.settle_ms ? (t.settle_ms / 1000).toFixed(1) + "s" : "--"}
                                  </span>
                                  <div className="flex-1 flex items-center gap-1">
                                    <span className="mono text-[11px] font-semibold" style={{ color: delta.color }}>{delta.value}</span>
                                    <span className="text-[9px]" style={{ color: "var(--t3)" }}>{delta.label}</span>
                                  </div>
                                </div>
                              );
                            })}
                            {agentTrades.length > 20 && (
                              <div className="px-3 py-1.5 text-[11px]" style={{ color: "var(--t3)", borderTop: "1px solid var(--border)" }}>
                                + {agentTrades.length - 20} more trades
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

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: "1px solid var(--border)" }}>
              <button onClick={() => setPage(Math.max(0, safePage - 1))}
                disabled={safePage === 0}
                className="mono text-[12px] px-2 py-1 rounded transition-all disabled:opacity-30 hover:bg-white/[0.03]"
                style={{ color: "var(--t2)", background: "none", border: "1px solid var(--border)" }}>
                Prev
              </button>
              <span className="mono text-[11px]" style={{ color: "var(--t3)" }}>
                {safePage + 1} of {totalPages}
              </span>
              <button onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                disabled={safePage >= totalPages - 1}
                className="mono text-[12px] px-2 py-1 rounded transition-all disabled:opacity-30 hover:bg-white/[0.03]"
                style={{ color: "var(--t2)", background: "none", border: "1px solid var(--border)" }}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
