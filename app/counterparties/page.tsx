"use client";
import { useState, useEffect, useCallback } from "react";
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

  return (
    <div>
      <Header onProfileClick={() => { setProfileTab("profile"); setProfileOpen(true); }} activePage="counterparties" />
      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} initialTab={profileTab} />
      <div className="max-w-[1240px] mx-auto px-5 py-5">
        <div className="grid grid-cols-2 gap-4">
          <AgentsPanel agents={agents} />
          <CommitteePanel nodes={COMMITTEE_NODES} requests={requests} trades={trades} rfqs={rfqs} />
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
