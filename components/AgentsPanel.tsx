"use client";
import { Agent } from "@/lib/types";

export default function AgentsPanel({ agents }: { agents: Agent[] }) {
  return (
    <div className="card mb-4 animate-in">
      <div className="card-header">
        <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>Counterparties</span>
        <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>
          {agents.length} active
        </span>
      </div>
      {agents.length === 0 ? (
        <div className="py-6 text-center text-[14px]" style={{ color: "var(--t3)" }}>No agents</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              {["Domain","Role","Reputation","Trades"].map(h => (
                <th key={h} className="px-4 py-2 text-left text-[12px] font-medium uppercase tracking-wider border-b"
                  style={{ color: "var(--t3)", borderColor: "var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map(a => (
              <tr key={a.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                <td className="px-4 py-2.5 text-[14px] font-medium">{a.domain || a.wallet_address.slice(0, 12)}</td>
                <td className="px-4 py-2.5"><span className={`tag tag-${a.role}`}>{a.role}</span></td>
                <td className="px-4 py-2.5 mono text-[14px] font-semibold" style={{ color: "var(--accent)" }}>{Number(a.rep_total).toFixed(1)}</td>
                <td className="px-4 py-2.5 mono text-[14px]">{a.trade_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
