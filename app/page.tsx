"use client";
import { useState, useEffect, useCallback } from "react";
import { WalletProvider, useWallet } from "@/components/WalletProvider";
import Header from "@/components/Header";
import ProfilePanel from "@/components/ProfilePanel";
import KPIs from "@/components/KPIs";
import OrderbookTable from "@/components/OrderbookTable";
import TradeBlotter from "@/components/TradeBlotter";
import CommitteePanel from "@/components/CommitteePanel";
import AgentsPanel from "@/components/AgentsPanel";
import SubmitRFQ from "@/components/SubmitRFQ";
import TradeFlow from "@/components/TradeFlow";
import { supabase } from "@/lib/supabase";
import type { Trade, RFQ, Agent, CommitteeRequest } from "@/lib/types";

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
    <div className="relative min-h-[calc(100vh-48px)] overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-1/4 right-1/4 w-[500px] h-[500px] rounded-full blur-3xl pointer-events-none"
        style={{ background: "rgba(37,99,235,0.04)" }} />

      <div className="relative z-10 flex flex-col lg:flex-row items-center justify-center min-h-[calc(100vh-48px)] max-w-[1200px] mx-auto px-6">
        {/* Left — content */}
        <div className="flex-1 flex flex-col justify-center py-12 lg:py-0 lg:pr-8">
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 mb-6 w-fit animate-in"
            style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: "var(--positive)" }} />
            <span className="font-mono text-[11px]" style={{ color: "var(--t2)" }}>Testnet Live</span>
          </div>

          <h1 className="font-sans font-light text-4xl lg:text-5xl tracking-tight leading-[1.1] mb-4 animate-in"
            style={{ animationDelay: "0.05s" }}>
            Cross-Chain<br/>
            <span style={{ color: "var(--accent-light)" }}>FX Settlement</span>
          </h1>

          <p className="text-[15px] max-w-[440px] leading-relaxed mb-10 animate-in"
            style={{ color: "var(--t2)", animationDelay: "0.1s" }}>
            Institutional-grade settlement across EVM and MoveVM.
            No bridges. No DEXs. Committee-verified in seconds.
          </p>

          <div className="flex items-center gap-6 mb-10 animate-in" style={{ animationDelay: "0.15s" }}>
            {[
              { v: "2-Chain", l: "Atomic Settlement" },
              { v: "3-of-5", l: "Committee Verified" },
              { v: "<20s", l: "Avg Settle Time" },
            ].map((s, i) => (
              <div key={i} className={i > 0 ? "pl-6 border-l" : ""} style={{ borderColor: "var(--border)" }}>
                <div className="text-xl font-semibold" style={{ color: "var(--t0)" }}>{s.v}</div>
                <div className="text-[12px] font-mono" style={{ color: "var(--t3)" }}>{s.l}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 animate-in" style={{ animationDelay: "0.2s" }}>
            <button onClick={connect}
              className="px-8 py-3 rounded text-[14px] font-semibold transition-all hover:brightness-110"
              style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
              Connect StarKey
            </button>
            <button onClick={demo}
              className="px-6 py-3 rounded text-[14px] font-medium transition-all"
              style={{ color: "var(--t2)", background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              Demo Mode
            </button>
          </div>

          <div className="mt-6 flex items-center gap-4 animate-in" style={{ animationDelay: "0.25s" }}>
            {[
              { n: "01", t: "Cross-Chain", d: "Sepolia ↔ Supra Testnet" },
              { n: "02", t: "AI Agents", d: "Autonomous maker/taker bots" },
              { n: "03", t: "Committee", d: "5-node multisig verification" },
            ].map((c, i) => (
              <div key={c.n} className="flex items-start gap-2.5 p-3 rounded border"
                style={{ borderColor: "var(--border)", background: "var(--surface)", flex: 1 }}>
                <div className="font-mono text-[11px] font-bold mt-0.5" style={{ color: "var(--t3)" }}>{c.n}</div>
                <div>
                  <div className="text-[13px] font-medium" style={{ color: "var(--t1)" }}>{c.t}</div>
                  <div className="text-[11px]" style={{ color: "var(--t3)" }}>{c.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right — Globe */}
        <div className="flex-1 flex items-center justify-center animate-fade" style={{ animationDelay: "0.3s" }}>
          <InteractiveGlobe size={480} />
        </div>
      </div>
    </div>
  );
}

/* Verification gate — shown when logged in but EVM not linked */
function VerificationGate() {
  const { linkEvmAddress, supraShort, disconnect } = useWallet();
  const [linking, setLinking] = useState(false);

  const handleLink = async () => {
    setLinking(true);
    await linkEvmAddress();
    setLinking(false);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-48px)] text-center px-5">
      <div className="w-[420px] rounded-lg border p-8" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="text-[13px] font-mono uppercase tracking-wider mb-4" style={{ color: "var(--t3)" }}>
          Complete Profile Setup
        </div>

        {/* Step 1: Supra — done */}
        <div className="flex items-center gap-3 p-3 rounded mb-3" style={{ background: "rgba(16,185,129,0.06)" }}>
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[14px] font-bold"
            style={{ background: "var(--positive)", color: "#fff" }}>✓</div>
          <div className="text-left flex-1">
            <div className="text-[13px] font-medium" style={{ color: "var(--positive)" }}>Supra Address Verified</div>
            <div className="font-mono text-[14px]" style={{ color: "var(--t3)" }}>{supraShort}</div>
          </div>
        </div>

        {/* Step 2: EVM — pending */}
        <div className="flex items-center gap-3 p-3 rounded mb-5 border" style={{ borderColor: "var(--warn)", background: "rgba(245,158,11,0.04)" }}>
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[14px] font-bold"
            style={{ background: "var(--warn)", color: "#fff" }}>2</div>
          <div className="text-left flex-1">
            <div className="text-[13px] font-medium" style={{ color: "var(--warn)" }}>Link EVM Address</div>
            <div className="text-[14px]" style={{ color: "var(--t3)" }}>Sign with MetaMask to verify ownership</div>
          </div>
        </div>

        <button onClick={handleLink} disabled={linking}
          className="w-full py-3 rounded text-[14px] font-semibold transition-all disabled:opacity-50"
          style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
          {linking ? "Waiting for MetaMask…" : "Link EVM Address via MetaMask"}
        </button>

        <button onClick={disconnect}
          className="w-full mt-3 py-2 rounded text-[13px] font-mono"
          style={{ color: "var(--t3)", background: "none", border: "1px solid var(--border)" }}>
          Disconnect
        </button>
      </div>
    </div>
  );
}

function Dashboard() {
  const [tab, setTab] = useState<"overview" | "orderbook" | "blotter" | "committee">("overview");
  const [profileOpen, setProfileOpen] = useState(false);
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
    const channel = supabase.channel("rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "trades" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "rfqs" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "committee_requests" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "committee_votes" }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchAll]);

  useEffect(() => {
    const interval = setInterval(fetchAll, 2000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  return (
    <div>
      <Header active={tab} onTab={setTab as any} onProfileClick={() => setProfileOpen(true)} />
      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
      <div className="max-w-[1240px] mx-auto px-5 py-5">
        {tab === "overview" && (
          <>
            <KPIs trades={trades} agents={agents} rfqs={rfqs} />
            <SubmitRFQ onSubmitted={fetchAll} />
            <TradeFlow trades={trades} onUpdate={fetchAll} />
            <OrderbookTable rfqs={rfqs} />
            <div className="grid grid-cols-2 gap-4">
              <AgentsPanel agents={agents} />
              <CommitteePanel nodes={COMMITTEE_NODES} requests={requests} />
            </div>
            <TradeBlotter trades={trades} />
          </>
        )}
        {tab === "orderbook" && (
          <>
            <SubmitRFQ onSubmitted={fetchAll} />
            <OrderbookTable rfqs={rfqs} />
          </>
        )}
        {tab === "blotter" && (
          <>
            <TradeFlow trades={trades} onUpdate={fetchAll} />
            <TradeBlotter trades={trades} />
          </>
        )}
        {tab === "committee" && <CommitteePanel nodes={COMMITTEE_NODES} requests={requests} />}
      </div>
      <div className="text-center py-5 font-mono text-[14px] uppercase tracking-wider border-t mt-8"
        style={{ color: "var(--t3)", borderColor: "var(--border)" }}>
        SupraFX Protocol · Sepolia (EVM) ↔ Supra Testnet (MoveVM) · Committee-Verified Settlement
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

  if (!supraAddress) {
    return (
      <div>
        <header className="h-12 flex items-center px-5 border-b" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="flex items-center gap-2">
            <div className="w-[6px] h-[6px] rounded-[1px]" style={{ background: "var(--accent)" }} />
            <span className="font-mono font-semibold text-sm tracking-tight">SupraFX</span>
          </div>
        </header>
        <Login />
      </div>
    );
  }

  // Connected but EVM not verified — show gate (skip for demo)
  if (!isVerified && !isDemo) {
    return (
      <div>
        <header className="h-12 flex items-center px-5 border-b" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="flex items-center gap-2">
            <div className="w-[6px] h-[6px] rounded-[1px]" style={{ background: "var(--accent)" }} />
            <span className="font-mono font-semibold text-sm tracking-tight">SupraFX</span>
          </div>
        </header>
        <VerificationGate />
      </div>
    );
  }

  return <Dashboard />;
}
