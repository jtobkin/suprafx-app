"use client";
import { useState, useEffect, useCallback } from "react";
import { WalletProvider, useWallet } from "@/components/WalletProvider";
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

function CounterpartiesInner() {
  const { supraAddress, isVerified, isDemo } = useWallet();

  const miniHeader = (
    <header className="h-12 flex items-center px-5 border-b glass-strong" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2.5">
        <div className="w-2.5 h-2.5 rounded-sm rotate-45" style={{ background: "var(--accent)" }} />
        <span className="mono text-[14px] font-bold tracking-tight">SupraFX</span>
      </div>
    </header>
  );

  if (!supraAddress) {
    return (
      <div>
        {miniHeader}
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-48px)] text-center px-5">
          <div className="card w-[420px] p-8">
            <div className="text-[16px] font-semibold mb-3" style={{ color: "var(--t1)" }}>Connect Wallet</div>
            <p className="text-[13px] mb-5" style={{ color: "var(--t3)" }}>Connect your wallet on the <a href="/" style={{ color: "var(--accent)", textDecoration: "underline" }}>main page</a> to view counterparties.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isVerified && !isDemo) {
    return (
      <div>
        {miniHeader}
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-48px)] text-center px-5">
          <div className="card w-[420px] p-8">
            <div className="text-[16px] font-semibold mb-3" style={{ color: "var(--t1)" }}>Verification Required</div>
            <p className="text-[13px] mb-5" style={{ color: "var(--t3)" }}>Complete your profile setup on the <a href="/" style={{ color: "var(--accent)", textDecoration: "underline" }}>main page</a> first.</p>
          </div>
        </div>
      </div>
    );
  }

  return <CounterpartiesDashboard />;
}

export default function CounterpartiesPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <WalletProvider>
      <CounterpartiesInner />
    </WalletProvider>
  );
}
