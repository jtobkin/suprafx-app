"use client";
import { useState } from "react";
import { Agent } from "@/lib/types";

const PAGE_SIZE = 15;

function shortAddr(addr: string) {
  if (addr === "auto-maker-bot") return "SupraFX Bot";
  if (addr.length > 20) return addr.slice(0, 6) + "…" + addr.slice(-4);
  return addr;
}

function addrUrl(addr: string) {
  if (addr === "auto-maker-bot") return null;
  if (addr.startsWith("0x") && addr.length > 50) {
    return `https://testnet.suprascan.io/account/${addr.replace(/^0x/, "")}`;
  }
  return `https://sepolia.etherscan.io/address/${addr}`;
}

type Filter = "all" | "taker" | "maker";

export default function AgentsPanel({ agents }: { agents: Agent[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);

  const filtered = filter === "all" ? agents : agents.filter(a => a.role === filter);

  const sorted = [...filtered].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

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
              return (
                <div key={a.id} className="flex items-center gap-3 px-3 py-2 hover:bg-white/[0.01] transition-colors"
                  style={{ borderBottom: i < pageItems.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <div className="flex items-center gap-2 w-36 shrink-0">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener"
                        className="mono text-[12px] hover:underline truncate" style={{ color: "var(--accent-light)" }}>
                        {a.domain || shortAddr(a.wallet_address)} ↗
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
                      ★ {Number(a.rep_total).toFixed(1)}
                    </span>
                  </div>

                  <div className="w-16 shrink-0">
                    <span className="mono text-[12px]" style={{ color: "var(--t2)" }}>{a.trade_count || 0}</span>
                    <span className="text-[10px] ml-1" style={{ color: "var(--t3)" }}>trades</span>
                  </div>

                  <div className="flex-1 text-right">
                    <span className="mono text-[11px]" style={{ color: "var(--t3)" }}>
                      {new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </div>
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
                ← Prev
              </button>
              <span className="mono text-[11px]" style={{ color: "var(--t3)" }}>
                {safePage + 1} of {totalPages}
              </span>
              <button onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                disabled={safePage >= totalPages - 1}
                className="mono text-[12px] px-2 py-1 rounded transition-all disabled:opacity-30 hover:bg-white/[0.03]"
                style={{ color: "var(--t2)", background: "none", border: "1px solid var(--border)" }}>
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
