"use client";
import { CommitteeRequest } from "@/lib/types";

interface Node { id: string; status: string; }

export default function CommitteePanel({ nodes, requests }: { nodes: Node[]; requests: CommitteeRequest[] }) {
  const online = nodes.filter(n => n.status === "online").length;

  return (
    <div className="border rounded-md overflow-hidden mb-4 animate-in" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex justify-between items-center px-4 py-3 border-b" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <span className="text-xs font-medium" style={{ color: "var(--t1)" }}>Settlement Committee</span>
        <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>3-of-5 Threshold</span>
      </div>

      <div className="flex gap-1.5 p-3 border-b" style={{ borderColor: "var(--border)" }}>
        {nodes.map(n => (
          <div key={n.id} className="flex-1 flex items-center gap-1.5 px-3 py-2 rounded border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
            <div className="w-[5px] h-[5px] rounded-full" style={{ background: "var(--positive)" }} />
            <span className="font-mono text-[10px] font-semibold" style={{ color: "var(--t1)" }}>{n.id}</span>
          </div>
        ))}
      </div>

      {requests.length > 0 && (
        <table className="w-full">
          <thead>
            <tr className="text-left" style={{ background: "var(--surface-2)" }}>
              {["ID","Verification","Trade","Votes","Result"].map(h => (
                <th key={h} className="px-4 py-2 text-[10px] font-medium uppercase tracking-wider border-b"
                  style={{ color: "var(--t3)", borderColor: "var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {requests.slice(0, 6).map(r => (
              <tr key={r.id} className="hover:bg-white/[0.015]" style={{ borderBottom: "1px solid rgba(255,255,255,0.025)" }}>
                <td className="px-4 py-2.5 font-mono text-[11px]" style={{ color: "var(--t2)" }}>{r.id.slice(0, 8)}</td>
                <td className="px-4 py-2.5 text-xs" style={{ color: "var(--t2)" }}>{r.verification_type.replace(/_/g, " ")}</td>
                <td className="px-4 py-2.5 font-mono text-[11px]" style={{ color: "var(--t2)" }}>{r.trade_id.slice(0, 8)}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.approvals}/{r.approvals + r.rejections}</td>
                <td className="px-4 py-2.5"><span className={`tag tag-${r.status}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {requests.length === 0 && (
        <div className="py-8 text-center text-xs" style={{ color: "var(--t3)" }}>No verification requests</div>
      )}
    </div>
  );
}
