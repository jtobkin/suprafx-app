"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { WalletProvider } from "@/components/WalletProvider";
import Header from "@/components/Header";
import ProfilePanel from "@/components/ProfilePanel";
import AgentsPanel from "@/components/AgentsPanel";
import CommitteePanel from "@/components/CommitteePanel";
import { supabase } from "@/lib/supabase";
import type { Trade, RFQ, Agent, CommitteeRequest } from "@/lib/types";

const COMMITTEE_NODES = [
  { id: "N-1", status: "online" },
  { id: "N-2", status: "online" },
  { id: "N-3", status: "online" },
  { id: "N-4", status: "online" },
  { id: "N-5", status: "online" },
];

function CounterpartiesDashboard() {
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<"profile" | "vault">("profile");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [requests, setRequests] = useState<CommitteeRequest[]>([]);

  const fetchAll = useCallback(async () => {
    const [t, r, a, cr] = await Promise.all([
      supabase.from("trades").select("*").order("created_at", { ascending: false }),
      supabase.from("rfqs").select("*").order("created_at", { ascending: false }),
      supabase.from("agents").select("*").order("created_at", { ascending: false }),
      supabase.from("committee_requests").select("*").order("created_at", { ascending: false }),
    ]);
    if (t.data) setTrades(t.data);
    if (r.data) setRfqs(r.data);
    if (a.data) setAgents(a.data);
    if (cr.data) setRequests(cr.data);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    const channel = supabase.channel("rt-counterparties")
      .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "committee_requests" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "committee_votes" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "trades" }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchAll]);

  // Draggable split panel state
  const [splitPercent, setSplitPercent] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.min(85, Math.max(15, pct)));
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

  return (
    <div>
      <Header onProfileClick={() => { setProfileTab("profile"); setProfileOpen(true); }} activePage="counterparties" />
      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} initialTab={profileTab} />
      <div className="max-w-[1240px] mx-auto px-5 py-5">
        <div ref={containerRef} className="flex gap-0" style={{ minHeight: "400px" }}>
          {/* Left panel */}
          <div style={{ width: `${splitPercent}%`, minWidth: 0, overflow: "auto" }}>
            <AgentsPanel agents={agents} trades={trades} />
          </div>
          {/* Drag handle */}
          <div
            onMouseDown={onMouseDown}
            className="shrink-0 flex items-center justify-center group"
            style={{ width: "12px", cursor: "col-resize", position: "relative" }}>
            <div className="w-[2px] h-full rounded-full transition-colors group-hover:w-[3px]"
              style={{ background: "var(--border)" }} />
            <div className="absolute w-5 h-10 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: "var(--surface-3)", border: "1px solid var(--border)" }}>
              <span className="mono text-[8px]" style={{ color: "var(--t3)" }}>||</span>
            </div>
          </div>
          {/* Right panel */}
          <div style={{ width: `${100 - splitPercent}%`, minWidth: 0, overflow: "auto" }}>
            <CommitteePanel nodes={COMMITTEE_NODES} requests={requests} trades={trades} rfqs={rfqs} />
          </div>
        </div>
      </div>
      <div className="text-center py-6 mono text-[11px] uppercase tracking-[2px] border-t mt-10"
        style={{ color: "var(--t3)", borderColor: "var(--border)" }}>
        SupraFX Protocol · Sepolia ↔ Supra Testnet · Committee-Verified Settlement
      </div>
    </div>
  );
}

export default function CounterpartiesPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <WalletProvider>
      <CounterpartiesDashboard />
    </WalletProvider>
  );
}
