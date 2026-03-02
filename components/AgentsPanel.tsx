"use client";
import { Agent } from "@/lib/types";

export default function AgentsPanel({ agents }: { agents: Agent[] }) {
  return (
    <div className="rounded border overflow-hidden mb-4 animate-in"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <span className="text-[11px] font-medium" style={{ color: "var(--t1)" }}>Counterparties</span>
        <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>
          {agents.length} active
        </span>
      </div>
      {agents.length === 0 ? (
        <div className="py-6 text-center text-[11px]" style={{ color: "var(--t3)" }}>No agents</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              {["Domain","Role","Reputation","Trades"].map(h => (
                <th key={h} className="px-4 py-1.5 text-left text-[9px] font-medium uppercase tracking-wider border-b"
                  style={{ color: "var(--t3)", borderColor: "var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map(a => (
              <tr key={a.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                <td className="px-4 py-2 text-[12px] font-medium">{a.domain || a.wallet_address.slice(0, 12)}</td>
                <td className="px-4 py-2"><span className={`tag tag-${a.role}`}>{a.role}</span></td>
                <td className="px-4 py-2 font-mono text-[12px] font-semibold" style={{ color: "var(--accent-light)" }}>{Number(a.rep_total).toFixed(1)}</td>
                <td className="px-4 py-2 font-mono text-[11px]">{a.trade_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
