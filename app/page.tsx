"use client";
import { useState, useEffect, useCallback } from "react";
import { WalletProvider, useWallet } from "@/components/WalletProvider";
import Header from "@/components/Header";
import KPIs from "@/components/KPIs";
import OrderbookTable from "@/components/OrderbookTable";
import TradeBlotter from "@/components/TradeBlotter";
import CommitteePanel from "@/components/CommitteePanel";
import AgentsPanel from "@/components/AgentsPanel";
import { supabase } from "@/lib/supabase";
import type { Trade, RFQ, Agent, CommitteeRequest } from "@/lib/types";

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
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-48px)] text-center px-5">
      <div className="font-mono text-[11px] uppercase tracking-[2px] mb-4 animate-in"
        style={{ color: "var(--t3)" }}>SupraFX Protocol</div>
      <h1 className="font-sans font-light text-5xl tracking-tight leading-tight mb-3 animate-in"
        style={{ animationDelay: "0.05s" }}>
        Cross-Chain<br/>FX Settlement
      </h1>
      <p className="text-[15px] max-w-[400px] leading-relaxed mb-12 animate-in"
        style={{ color: "var(--t2)", animationDelay: "0.1s" }}>
        Institutional-grade settlement across EVM and MoveVM. No bridges. No DEXs. Committee-verified.
      </p>
      <div className="grid grid-cols-3 gap-3 mb-12">
        {[
          { n: "01", t: "Cross-Chain", d: "Sepolia to Supra Testnet. Two atomic transfers." },
          { n: "02", t: "AI Agents", d: "Autonomous maker/taker with reputation scoring." },
          { n: "03", t: "3-of-5 Committee", d: "Independent nodes verify every on-chain transfer." },
        ].map((c, i) => (
          <div key={c.n} className="w-[180px] p-5 border rounded-md text-left transition-colors animate-in"
            style={{ borderColor: "var(--border)", background: "var(--surface)", animationDelay: `${0.05 + i * 0.05}s` }}>
            <div className="font-mono text-[10px] font-semibold mb-2.5" style={{ color: "var(--t3)" }}>{c.n}</div>
            <div className="text-[13px] font-medium mb-1">{c.t}</div>
            <div className="text-[11px] leading-snug" style={{ color: "var(--t3)" }}>{c.d}</div>
          </div>
        ))}
      </div>
      <button onClick={connect}
        className="px-8 py-3 rounded border text-[13px] font-medium transition-all animate-in hover:brightness-110"
        style={{ background: "var(--accent)", borderColor: "var(--accent)", color: "#fff", animationDelay: "0.2s" }}>
        Connect StarKey Wallet
      </button>
      <div className="mt-3.5 text-xs animate-in" style={{ color: "var(--t3)", animationDelay: "0.25s" }}>
        No wallet?{" "}
        <span className="cursor-pointer hover:underline" style={{ color: "var(--accent)" }} onClick={demo}>
          Enter demo mode
        </span>
      </div>
    </div>
  );
}

function Dashboard() {
  const { address } = useWallet();
  const [tab, setTab] = useState<"overview" | "orderbook" | "blotter" | "committee">("overview");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [requests, setRequests] = useState<CommitteeRequest[]>([]);

  const fetchData = useCallback(async () => {
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

  useEffect(() => {
    fetchData();

    // Real-time subscriptions
    const channel = supabase.channel("realtime-all")
      .on("postgres_changes", { event: "*", schema: "public", table: "trades" }, () => fetchData())
      .on("postgres_changes", { event: "*", schema: "public", table: "rfqs" }, () => fetchData())
      .on("postgres_changes", { event: "*", schema: "public", table: "committee_requests" }, () => fetchData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  return (
    <div>
      <Header active={tab} onTab={setTab as any} />
      <div className="max-w-[1240px] mx-auto px-5 py-5">
        {tab === "overview" && (
          <>
            <KPIs trades={trades} agents={agents} rfqs={rfqs} />
            <OrderbookTable rfqs={rfqs} />
            <div className="grid grid-cols-2 gap-4">
              <AgentsPanel agents={agents} />
              <CommitteePanel nodes={COMMITTEE_NODES} requests={requests} />
            </div>
            <TradeBlotter trades={trades} />
          </>
        )}
        {tab === "orderbook" && <OrderbookTable rfqs={rfqs} />}
        {tab === "blotter" && <TradeBlotter trades={trades} />}
        {tab === "committee" && <CommitteePanel nodes={COMMITTEE_NODES} requests={requests} />}
      </div>
      <div className="text-center py-5 font-mono text-[10px] uppercase tracking-wider border-t mt-8"
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
  const { address } = useWallet();
  return address ? <Dashboard /> : (
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
