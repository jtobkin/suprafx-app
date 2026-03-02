"use client";
import { CommitteeRequest } from "@/lib/types";
interface Node { id: string; status: string; }

export default function CommitteePanel({ nodes, requests }: { nodes: Node[]; requests: CommitteeRequest[] }) {
  return (
    <div className="rounded border overflow-hidden mb-4 animate-in"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <span className="text-[11px] font-medium" style={{ color: "var(--t1)" }}>Settlement Committee</span>
        <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>
          3-of-5
        </span>
      </div>
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
        <div className="py-6 text-center text-[11px]" style={{ color: "var(--t3)" }}>No verifications</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              {["Verification","Trade","Votes","Result"].map(h => (
                <th key={h} className="px-4 py-1.5 text-left text-[9px] font-medium uppercase tracking-wider border-b"
                  style={{ color: "var(--t3)", borderColor: "var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {requests.slice(0, 8).map(r => (
              <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                <td className="px-4 py-2 text-[11px]" style={{ color: "var(--t2)" }}>{r.verification_type.replace(/_/g, " ")}</td>
                <td className="px-4 py-2 font-mono text-[10px]" style={{ color: "var(--t3)" }}>{r.trade_id.slice(0, 8)}…</td>
                <td className="px-4 py-2 font-mono text-[11px]">{r.approvals}/{r.approvals + r.rejections}</td>
                <td className="px-4 py-2"><span className={`tag tag-${r.status}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
