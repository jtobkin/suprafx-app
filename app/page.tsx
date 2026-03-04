"use client";
import { useState, useEffect, useCallback } from "react";
import { WalletProvider, useWallet } from "@/components/WalletProvider";
import Header from "@/components/Header";
import ProfilePanel from "@/components/ProfilePanel";
import KPIs from "@/components/KPIs";
import OrderbookTable from "@/components/OrderbookTable";
import MyTrades from "@/components/MyTrades";
import CommitteePanel from "@/components/CommitteePanel";
import AgentsPanel from "@/components/AgentsPanel";
import SubmitRFQ from "@/components/SubmitRFQ";
import { supabase } from "@/lib/supabase";
import type { Trade, RFQ, Agent, CommitteeRequest, Quote } from "@/lib/types";

import { InteractiveGlobe } from "@/components/ui/interactive-globe";

const COMMITTEE_NODES = [
  { id: "N-1", status: "online" },
  { id: "N-2", status: "online" },
  { id: "N-3", status: "online" },
  { id: "N-4", status: "online" },
  { id: "N-5", status: "online" },
];

function Login() {
  const { connect, demo } = useWallet();
  return (
    <div className="grain relative min-h-[calc(100vh-48px)] overflow-hidden">
      {/* Background gradient orbs */}
      <div className="absolute top-[20%] right-[30%] w-[600px] h-[600px] rounded-full blur-[120px] pointer-events-none"
        style={{ background: "rgba(59,130,246,0.04)" }} />
      <div className="absolute bottom-[10%] left-[20%] w-[400px] h-[400px] rounded-full blur-[100px] pointer-events-none"
        style={{ background: "rgba(139,92,246,0.03)" }} />

      <div className="relative z-10 flex flex-col lg:flex-row items-center justify-center min-h-[calc(100vh-48px)] max-w-[1200px] mx-auto px-6">
        <div className="flex-1 flex flex-col justify-center py-12 lg:py-0 lg:pr-12">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 mb-8 w-fit animate-in"
            style={{ background: "var(--positive-dim)", border: "1px solid rgba(34,197,94,0.15)" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: "var(--positive)" }} />
            <span className="mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--positive)" }}>
              Testnet Live
            </span>
          </div>

          <h1 className="font-light text-[48px] lg:text-[56px] tracking-[-0.03em] leading-[1.05] mb-5 animate-in"
            style={{ animationDelay: "0.05s" }}>
            <span style={{ color: "var(--t0)" }}>Cross-Chain</span><br/>
            <span style={{ color: "var(--accent)" }}>FX Settlement</span>
          </h1>

          <p className="text-[16px] max-w-[460px] leading-relaxed mb-10 animate-in"
            style={{ color: "var(--t2)", animationDelay: "0.1s" }}>
            Institutional-grade settlement across blockchains.
            No bridge fees. No DEX fees. No smart contract fees. Committee-verified in seconds.
          </p>

          <div className="flex items-center gap-0 mb-10 animate-in rounded-lg overflow-hidden"
            style={{ animationDelay: "0.15s", border: "1px solid var(--border)" }}>
            {[
              { v: "Multi-Chain", l: "Atomic Settlement" },
              { v: "3-of-5", l: "Committee Multisig" },
            ].map((s, i) => (
              <div key={i} className="flex-1 px-5 py-3.5 text-center"
                style={{ background: "var(--surface)", borderRight: i < 1 ? "1px solid var(--border)" : "none" }}>
                <div className="mono text-[18px] font-bold tracking-tight" style={{ color: "var(--t0)" }}>{s.v}</div>
                <div className="text-[11px] mt-0.5 tracking-wide" style={{ color: "var(--t3)" }}>{s.l}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 animate-in" style={{ animationDelay: "0.2s" }}>
            <button onClick={connect}
              className="px-8 py-3 rounded-lg text-[14px] font-semibold transition-all hover:brightness-110 glow-accent"
              style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
              Connect StarKey
            </button>
            <button onClick={demo}
              className="px-6 py-3 rounded-lg text-[14px] font-medium transition-all hover:bg-white/[0.03]"
              style={{ color: "var(--t2)", background: "var(--surface)", border: "1px solid var(--border)" }}>
              Demo Mode
            </button>
          </div>

          <div className="mt-8 flex items-stretch gap-3 animate-in" style={{ animationDelay: "0.25s" }}>
            {[
              { t: "Cross-Chain", d: "Sepolia ↔ Supra", icon: "⇄" },
              { t: "AI Agents", d: "Autonomous settlement", icon: "◈" },
              { t: "Committee", d: "5-node multisig", icon: "⬡" },
            ].map((c) => (
              <div key={c.t} className="card flex-1 p-3.5 flex items-start gap-3 hover:border-white/10 transition-colors">
                <div className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 text-[14px]"
                  style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>{c.icon}</div>
                <div>
                  <div className="text-[13px] font-semibold" style={{ color: "var(--t1)" }}>{c.t}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--t3)" }}>{c.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center animate-fade" style={{ animationDelay: "0.3s" }}>
          <InteractiveGlobe size={480} />
        </div>
      </div>
    </div>
  );
}

function VerificationGate() {
  const { linkEvmAddress, supraShort, disconnect } = useWallet();
  const [linking, setLinking] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);
  const [showChoice, setShowChoice] = useState(false);
  const handleLink = async (provider: "metamask" | "starkey") => {
    setLinking(true);
    setLinkingProvider(provider);
    setShowChoice(false);
    await linkEvmAddress(provider);
    setLinking(false);
    setLinkingProvider(null);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-48px)] text-center px-5">
      <div className="card w-[420px] p-8">
        <div className="mono text-[11px] uppercase tracking-[1.5px] mb-5 font-semibold" style={{ color: "var(--t3)" }}>
          Complete Profile Setup
        </div>

        <div className="flex items-center gap-3 p-3 rounded-md mb-3" style={{ background: "var(--positive-dim)" }}>
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold"
            style={{ background: "var(--positive)", color: "#fff" }}>✓</div>
          <div className="text-left flex-1">
            <div className="text-[13px] font-medium" style={{ color: "var(--positive)" }}>Supra Address Verified</div>
            <div className="mono text-[12px]" style={{ color: "var(--t3)" }}>{supraShort}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-md mb-5" style={{ background: "var(--warn-dim)", border: "1px solid rgba(234,179,8,0.15)" }}>
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold"
            style={{ background: "var(--warn)", color: "#fff" }}>2</div>
          <div className="text-left flex-1">
            <div className="text-[13px] font-medium" style={{ color: "var(--warn)" }}>Link EVM Address</div>
            <div className="text-[12px]" style={{ color: "var(--t3)" }}>Sign a message to verify address ownership</div>
          </div>
        </div>

        {linking ? (
          <div className="flex items-center justify-center gap-2 py-3">
            <div className="w-3 h-3 rounded-full border-[1.5px] animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
            <span className="text-[13px]" style={{ color: "var(--t2)" }}>
              Waiting for {linkingProvider === "starkey" ? "StarKey" : "MetaMask"} signature...
            </span>
          </div>
        ) : showChoice ? (
          <div className="space-y-2">
            <div className="text-[12px] mb-2" style={{ color: "var(--t3)" }}>Choose wallet to sign with:</div>
            <button onClick={() => handleLink("starkey")}
              className="w-full py-3 rounded-md text-[14px] font-semibold transition-all hover:brightness-110"
              style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
              StarKey (EVM)
            </button>
            <button onClick={() => handleLink("metamask")}
              className="w-full py-3 rounded-md text-[14px] font-semibold transition-all hover:brightness-110"
              style={{ background: "var(--surface-3)", color: "var(--t1)", border: "1px solid var(--border)" }}>
              MetaMask
            </button>
            <button onClick={() => setShowChoice(false)}
              className="w-full py-1.5 text-[12px]"
              style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>
              cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setShowChoice(true)}
            className="w-full py-3 rounded-md text-[14px] font-semibold transition-all disabled:opacity-50 glow-accent"
            style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
            Link EVM Address
          </button>
        )}
        <button onClick={disconnect}
          className="w-full mt-3 py-2 rounded-md text-[12px] mono"
          style={{ color: "var(--t3)", background: "none", border: "1px solid var(--border)" }}>
          Disconnect
        </button>
      </div>
    </div>
  );
}

function Dashboard() {
  const [profileOpen, setProfileOpen] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [requests, setRequests] = useState<CommitteeRequest[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);

  const fetchAll = useCallback(async () => {
    const [t, r, a, cr, q] = await Promise.all([
      supabase.from("trades").select("*").order("created_at", { ascending: false }),
      supabase.from("rfqs").select("*").order("created_at", { ascending: false }),
      supabase.from("agents").select("*").order("created_at", { ascending: false }),
      supabase.from("committee_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("quotes").select("*").order("created_at", { ascending: false }),
    ]);
    if (t.data) setTrades(t.data);
    if (r.data) setRfqs(r.data);
    if (a.data) setAgents(a.data);
    if (cr.data) setRequests(cr.data);
    if (q.data) setQuotes(q.data);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    const channel = supabase.channel("rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "trades" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "rfqs" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "committee_requests" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "committee_votes" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchAll]);
  useEffect(() => { const iv = setInterval(fetchAll, 2000); return () => clearInterval(iv); }, [fetchAll]);

  return (
    <div>
      <Header onProfileClick={() => setProfileOpen(true)} />
      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
      <div className="max-w-[1240px] mx-auto px-5 py-5">
        <KPIs trades={trades} agents={agents} rfqs={rfqs} />
        <SubmitRFQ onSubmitted={fetchAll} />
        <OrderbookTable rfqs={rfqs} trades={trades} quotes={quotes} agents={agents} onAcceptQuote={fetchAll} onUpdate={fetchAll} />
        <MyTrades rfqs={rfqs} trades={trades} quotes={quotes} agents={agents} />
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

export default function Page() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <WalletProvider>
      <Inner />
    </WalletProvider>
  );
}

function Inner() {
  const { supraAddress, isVerified, isDemo } = useWallet();

  const miniHeader = (
    <header className="h-12 flex items-center px-5 border-b glass-strong" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2.5">
        <div className="w-2.5 h-2.5 rounded-sm rotate-45" style={{ background: "var(--accent)" }} />
        <span className="mono text-[14px] font-bold tracking-tight">SupraFX</span>
      </div>
    </header>
  );

  if (!supraAddress) return <div>{miniHeader}<Login /></div>;
  if (!isVerified && !isDemo) return <div>{miniHeader}<VerificationGate /></div>;
  return <Dashboard />;
}
