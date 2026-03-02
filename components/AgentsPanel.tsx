"use client";
import { Agent } from "@/lib/types";

export default function AgentsPanel({ agents }: { agents: Agent[] }) {
  return (
    <div className="border rounded-md overflow-hidden mb-4 animate-in" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex justify-between items-center px-4 py-3 border-b" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <span className="text-xs font-medium" style={{ color: "var(--t1)" }}>Counterparties</span>
        <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>{agents.length} Active</span>
      </div>
      {agents.length === 0 ? (
        <div className="py-8 text-center text-xs" style={{ color: "var(--t3)" }}>No agents registered</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left" style={{ background: "var(--surface-2)" }}>
              {["Domain","Role","Chains","Reputation","Trades"].map(h => (
                <th key={h} className="px-4 py-2 text-[10px] font-medium uppercase tracking-wider border-b"
                  style={{ color: "var(--t3)", borderColor: "var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map(a => (
              <tr key={a.id} className="hover:bg-white/[0.015]" style={{ borderBottom: "1px solid rgba(255,255,255,0.025)" }}>
                <td className="px-4 py-2.5 text-xs font-semibold">{a.domain || a.wallet_address.slice(0, 12)}</td>
                <td className="px-4 py-2.5"><span className={`tag tag-${a.role}`}>{a.role}</span></td>
                <td className="px-4 py-2.5 text-[11px]" style={{ color: "var(--t2)" }}>{a.chains?.join(", ") || "—"}</td>
                <td className="px-4 py-2.5 font-mono text-xs font-semibold" style={{ color: "var(--accent)" }}>{a.rep_total?.toFixed(1)}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{a.trade_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
