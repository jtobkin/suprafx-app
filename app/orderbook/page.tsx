"use client";
import { useState, useEffect, useCallback } from "react";
import { WalletProvider, useWallet } from "@/components/WalletProvider";
import Header from "@/components/Header";
import ProfilePanel from "@/components/ProfilePanel";
import { supabase } from "@/lib/supabase";
import { generateTxId } from "@/lib/tx-id";
import type { RFQ, Quote, Agent } from "@/lib/types";

/* ── helpers ── */
function displayPair(p: string) { return p.replace(/fx/g, ""); }
function fmtRate(n: number) {
  if (n >= 1000) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
function shortAddr(a: string) {
  if (a === "auto-maker-bot") return "SupraFX Bot";
  if (a.length > 16) return a.slice(0, 6) + "..." + a.slice(-4);
  return a;
}
function timeAgo(iso: string) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return sec + "s ago";
  if (sec < 3600) return Math.floor(sec / 60) + "m ago";
  return Math.floor(sec / 3600) + "h ago";
}
const ASSETS = ["ETH", "SUPRA", "AAVE", "LINK", "USDC", "USDT"];
const CHAINS = ["All", "Cross-chain", "Same-chain", "Sepolia", "Supra"];

/* ── Oracle Ticker ── */
function OracleTicker() {
  const [prices, setPrices] = useState<Record<string, { price: number; change: number }>>({});
  useEffect(() => {
    const pairs = ["ETH/SUPRA", "fxUSDC/SUPRA", "fxAAVE/SUPRA", "fxLINK/SUPRA"];
    Promise.all(pairs.map(p => fetch(`/api/oracle?pair=${encodeURIComponent(p)}`).then(r => r.json()).catch(() => null)))
      .then(results => {
        const m: Record<string, { price: number; change: number }> = {};
        for (const d of results) {
          if (!d) continue;
          if (d.base?.token && d.base?.price) m[d.base.token.replace("fx", "")] = { price: d.base.price, change: d.base.change24h || 0 };
          if (d.quote?.token && d.quote?.price) m[d.quote.token.replace("fx", "")] = { price: d.quote.price, change: d.quote.change24h || 0 };
        }
        if (!m["USDC"]) m["USDC"] = { price: 1, change: 0 };
        if (!m["USDT"]) m["USDT"] = { price: 1, change: 0 };
        setPrices(m);
      });
  }, []);

  return (
    <div className="flex items-center gap-4 overflow-x-auto">
      {Object.entries(prices).map(([token, d]) => (
        <div key={token} className="flex items-center gap-2 px-3 py-1.5 rounded shrink-0"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
          <span className="mono text-[11px] font-semibold" style={{ color: "var(--t1)" }}>{token}</span>
          <span className="mono text-[12px]" style={{ color: "var(--t0)" }}>${d.price >= 1 ? d.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : d.price.toFixed(6)}</span>
          <span className="mono text-[10px]" style={{ color: d.change >= 0 ? "var(--positive)" : "var(--negative)" }}>
            {d.change >= 0 ? "+" : ""}{d.change.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Vault Capacity Strip ── */
function VaultStrip({ addr }: { addr: string | null }) {
  const [vault, setVault] = useState<any>(null);
  useEffect(() => {
    if (!addr) return;
    Promise.all([
      fetch(`/api/vault?address=${encodeURIComponent(addr)}`).then(r => r.json()).catch(() => null),
      fetch(`/api/maker-capacity?address=${encodeURIComponent(addr)}`).then(r => r.json()).catch(() => null),
    ]).then(([v, c]) => {
      if (v?.balance) setVault({ ...v.balance, availableCapacity: c?.availableCapacity ?? Number(v.balance.matching_limit || 0), totalEarmarked: c?.totalEarmarked ?? 0 });
    });
  }, [addr]);

  if (!vault) return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
      <span className="text-[11px]" style={{ color: "var(--t3)" }}>No vault deposit</span>
      <button onClick={() => window.dispatchEvent(new Event("suprafx:open-vault"))}
        className="mono text-[10px] px-2 py-0.5 rounded hover:brightness-110"
        style={{ background: "var(--accent)", color: "#fff", border: "none" }}>Deposit</button>
    </div>
  );

  const usedPct = vault.total_deposited > 0 ? ((Number(vault.committed) + vault.totalEarmarked) / Number(vault.total_deposited)) * 100 : 0;

  return (
    <div className="flex items-center gap-4 px-3 py-1.5 rounded" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Vault</span>
        <span className="mono text-[12px] font-semibold" style={{ color: "var(--t0)" }}>
          ${Number(vault.total_deposited).toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </div>
      <div className="w-px h-4" style={{ background: "var(--border)" }} />
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Available</span>
        <span className="mono text-[12px] font-semibold" style={{ color: "var(--positive)" }}>
          ${vault.availableCapacity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </div>
      <div className="w-px h-4" style={{ background: "var(--border)" }} />
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Committed</span>
        <span className="mono text-[12px]" style={{ color: "var(--warn)" }}>
          ${Number(vault.committed).toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </div>
      <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, usedPct)}%`, background: usedPct > 80 ? "var(--negative)" : "var(--accent)" }} />
      </div>
      <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>{usedPct.toFixed(0)}% used</span>
    </div>
  );
}

/* ── Main Orderbook Dashboard ── */
function OrderbookDashboard() {
  const { supraAddress, signAction } = useWallet();
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<"profile" | "vault">("profile");

  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  // Filters
  const [chainFilter, setChainFilter] = useState("All");
  const [assetFilter, setAssetFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<"all" | "mine">("all");
  const [viewMode, setViewMode] = useState<"list" | "grouped">("list");

  // Quote placement
  const [expandedRfq, setExpandedRfq] = useState<string | null>(null);
  const [quotingRfq, setQuotingRfq] = useState<string | null>(null);
  const [quotePrice, setQuotePrice] = useState("");
  const [quotingLoading, setQuotingLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  // My quotes sidebar
  const [expandedQuote, setExpandedQuote] = useState<string | null>(null);

  // Oracle prices for USD conversion
  const [usdPrices, setUsdPrices] = useState<Record<string, number>>({});

  const fetchAll = useCallback(async () => {
    const [r, q, a] = await Promise.all([
      supabase.from("rfqs").select("*").order("created_at", { ascending: false }),
      supabase.from("quotes").select("*").order("created_at", { ascending: false }),
      supabase.from("agents").select("*").order("created_at", { ascending: false }),
    ]);
    if (r.data) setRfqs(r.data);
    if (q.data) setQuotes(q.data);
    if (a.data) setAgents(a.data);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    const channel = supabase.channel("rt-orderbook")
      .on("postgres_changes", { event: "*", schema: "public", table: "rfqs" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchAll]);
  useEffect(() => { const iv = setInterval(fetchAll, 3000); return () => clearInterval(iv); }, [fetchAll]);

  // Oracle prices
  useEffect(() => {
    const pairs = ["ETH/SUPRA", "fxUSDC/SUPRA", "fxAAVE/SUPRA", "fxLINK/SUPRA"];
    Promise.all(pairs.map(p => fetch(`/api/oracle?pair=${encodeURIComponent(p)}`).then(r => r.json()).catch(() => null)))
      .then(results => {
        const prices: Record<string, number> = {};
        for (const d of results) {
          if (!d) continue;
          if (d.base?.token && d.base?.price) prices[d.base.token.replace("fx", "")] = d.base.price;
          if (d.quote?.token && d.quote?.price) prices[d.quote.token.replace("fx", "")] = d.quote.price;
        }
        if (!prices["USDC"]) prices["USDC"] = 1;
        if (!prices["USDT"]) prices["USDT"] = 1;
        setUsdPrices(prices);
      });
  }, []);

  function toUsd(amount: number, token: string): string | null {
    const clean = token.replace("fx", "");
    const price = usdPrices[clean];
    if (!price || amount <= 0) return null;
    const total = amount * price;
    return total >= 1 ? "$" + total.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "$" + total.toFixed(4);
  }

  // Filtered RFQs
  const openRfqs = rfqs.filter(r => r.status === "open");
  const filteredRfqs = openRfqs.filter(r => {
    // Chain filter
    if (chainFilter === "Cross-chain" && r.source_chain === r.dest_chain) return false;
    if (chainFilter === "Same-chain" && r.source_chain !== r.dest_chain) return false;
    if (chainFilter === "Sepolia" && r.source_chain !== "sepolia" && r.dest_chain !== "sepolia") return false;
    if (chainFilter === "Supra" && r.source_chain !== "supra-testnet" && r.dest_chain !== "supra-testnet") return false;
    // Asset filter
    if (assetFilter.length > 0) {
      const pairClean = displayPair(r.pair);
      const hasAsset = assetFilter.some(a => pairClean.includes(a));
      if (!hasAsset) return false;
    }
    // Ownership filter
    if (ownerFilter === "mine" && supraAddress) {
      const myQuoteOnRfq = quotes.some(q => q.rfq_id === r.id && q.maker_address === supraAddress && (q.status === "pending" || q.status === "review"));
      const isTaker = r.taker_address === supraAddress;
      if (!myQuoteOnRfq && !isTaker) return false;
    }
    return true;
  });

  // Grouped by pair
  const groupedByPair = filteredRfqs.reduce((acc, r) => {
    const key = displayPair(r.pair);
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {} as Record<string, RFQ[]>);

  // My active quotes
  const myQuotes = supraAddress
    ? quotes.filter(q => q.maker_address === supraAddress && (q.status === "pending" || q.status === "review"))
    : [];

  // Actions
  const placeQuote = async (rfqId: string) => {
    if (!supraAddress || !quotePrice) return;
    setQuotingLoading(true);
    try {
      const body: any = { action: "place_quote", rfqId, makerAddress: supraAddress, rate: quotePrice };
      try {
        const signed = await signAction("place_quote", { rfqId, rate: quotePrice });
        body.signedPayload = signed.payload; body.signature = signed.signature; body.payloadHash = signed.payloadHash;
        body.sessionNonce = signed.payload.sessionNonce; body.sessionPublicKey = signed.sessionPublicKey;
        body.sessionAuthSignature = signed.sessionAuthSignature; body.sessionCreatedAt = signed.sessionCreatedAt;
      } catch (e) { console.warn("[SupraFX] Signing failed:", e); }
      const res = await fetch("/api/skill/suprafx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.error) { alert(data.error); } else { setQuotePrice(""); setQuotingRfq(null); fetchAll(); }
    } catch (e) { console.error(e); }
    setQuotingLoading(false);
  };

  const withdrawQuote = async (quoteId: string) => {
    if (!supraAddress) return;
    setWithdrawing(quoteId);
    try {
      const res = await fetch("/api/skill/suprafx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "withdraw_quote", quoteId, agentAddress: supraAddress }) });
      const data = await res.json();
      if (data.error) alert(data.error); else fetchAll();
    } catch (e: any) { alert(e.message); }
    setWithdrawing(null);
  };

  // RFQ Row renderer (reused in both views)
  const renderRfqRow = (r: RFQ) => {
    const isMine = r.taker_address === supraAddress;
    const rfqQuotes = quotes.filter(q => q.rfq_id === r.id && q.status !== "rejected" && q.status !== "withdrawn").sort((a, b) => b.rate - a.rate);
    const isExpanded = expandedRfq === r.id;
    const pairClean = displayPair(r.pair);
    const baseClean = r.pair.split("/")[0]?.replace("fx", "") || "";
    const quoteClean = r.pair.split("/")[1]?.replace("fx", "") || "";
    const oracleBase = usdPrices[baseClean];
    const notionalUsd = toUsd(r.size * r.reference_price, r.pair.split("/")[1] || "");
    const myExistingQuote = supraAddress ? rfqQuotes.find(q => q.maker_address === supraAddress) : null;

    return (
      <div key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.01] transition-colors"
          onClick={() => setExpandedRfq(isExpanded ? null : r.id)}>
          <span className="mono text-[11px] w-20 shrink-0" style={{ color: "var(--t3)" }}>{generateTxId(r.display_id, r.taker_address)}</span>
          <span className="text-[13px] font-semibold w-24 shrink-0" style={{ color: "var(--t0)" }}>{pairClean}</span>
          <span className="mono text-[12px] w-20 shrink-0" style={{ color: "var(--t2)" }}>{r.size} {baseClean}</span>
          <div className="w-32 shrink-0">
            <span className="mono text-[12px] font-semibold" style={{ color: "var(--t1)" }}>{fmtRate(r.reference_price)}</span>
            <span className="text-[10px] ml-1" style={{ color: "var(--t3)" }}>{quoteClean}</span>
            {notionalUsd && <div className="mono text-[10px]" style={{ color: "var(--t3)" }}>{notionalUsd}</div>}
          </div>
          <span className="text-[11px] w-32 shrink-0" style={{ color: "var(--t3)" }}>
            {r.source_chain === r.dest_chain ? "Same-chain" : r.source_chain.replace("-testnet", "") + " > " + r.dest_chain.replace("-testnet", "")}
          </span>
          <div className="w-24 shrink-0">
            <span className="mono text-[11px]" style={{ color: isMine ? "var(--accent)" : "var(--t2)" }}>
              {isMine ? "You" : shortAddr(r.taker_address)}
            </span>
            {(() => { const ag = agents.find(a => a.wallet_address === r.taker_address); return ag ? <span className="mono text-[9px] ml-1" style={{ color: Number(ag.rep_total) >= 4 ? "var(--positive)" : "var(--t3)" }}>* {Number(ag.rep_total).toFixed(1)}</span> : null; })()}
          </div>
          <span className="mono text-[10px] w-12 shrink-0" style={{ color: "var(--t3)" }}>{timeAgo(r.created_at)}</span>
          <div className="flex items-center gap-2 shrink-0">
            <span className="tag tag-open">{rfqQuotes.length} qt{rfqQuotes.length !== 1 ? "s" : ""}</span>
            {myExistingQuote && <span className="mono text-[9px] px-1.5 py-0.5 rounded" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>quoted</span>}
            <span className="text-[10px]" style={{ color: "var(--t3)" }}>{isExpanded ? "^" : "v"}</span>
          </div>
        </div>

        {isExpanded && (
          <div className="animate-slide-down" style={{ background: "var(--bg-raised)", borderLeft: "3px solid var(--accent)" }}>
            {/* Existing quotes */}
            {rfqQuotes.length > 0 && (
              <div>
                <div className="px-6 py-1 flex items-center gap-4" style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Maker", "Rate", "USD", "vs Asking", "Status"].map(h => (
                    <span key={h} className={"mono text-[9px] uppercase tracking-wider font-medium " +
                      (h === "Maker" ? "w-32" : h === "Rate" ? "w-28" : h === "USD" ? "w-24" : h === "vs Asking" ? "w-20" : "flex-1")}
                      style={{ color: "var(--t3)" }}>{h}</span>
                  ))}
                </div>
                {rfqQuotes.map(q => {
                  const diff = r.reference_price > 0 ? ((q.rate - r.reference_price) / r.reference_price) * 100 : 0;
                  const qUsd = toUsd(r.size * q.rate, r.pair.split("/")[1] || "");
                  return (
                    <div key={q.id} className="px-6 py-2 flex items-center gap-4 hover:bg-white/[0.02]"
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                      <span className="mono text-[11px] w-32 shrink-0" style={{ color: q.maker_address === supraAddress ? "var(--accent)" : "var(--t2)" }}>
                        {q.maker_address === supraAddress ? "You" : shortAddr(q.maker_address)}
                      </span>
                      <span className="mono text-[12px] font-semibold w-28 shrink-0" style={{ color: "var(--t1)" }}>{fmtRate(q.rate)} {quoteClean}</span>
                      <span className="mono text-[10px] w-24 shrink-0" style={{ color: "var(--t3)" }}>{qUsd || "--"}</span>
                      <span className="mono text-[11px] w-20 shrink-0" style={{ color: diff >= 0 ? "var(--positive)" : "var(--negative)" }}>{diff >= 0 ? "+" : ""}{diff.toFixed(2)}%</span>
                      <div className="flex-1 flex items-center gap-2">
                        <span className="tag" style={q.status === "review" ? { background: "rgba(234,179,8,0.12)", color: "var(--warn)" } : {}}>
                          {q.status === "review" ? "In Review" : q.status}
                        </span>
                        {q.maker_address === supraAddress && (q.status === "pending" || q.status === "review") && (
                          <button onClick={(e) => { e.stopPropagation(); withdrawQuote(q.id); }} disabled={withdrawing === q.id}
                            className="mono text-[10px] px-2 py-0.5 rounded hover:brightness-110 disabled:opacity-50"
                            style={{ background: "var(--negative-dim)", color: "var(--negative)", border: "none" }}>
                            {withdrawing === q.id ? "..." : "withdraw"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Place quote form */}
            {!isMine && supraAddress && !myExistingQuote && (
              <div className="px-6 py-3" style={{ borderTop: rfqQuotes.length > 0 ? "1px solid var(--border)" : "none" }}>
                {quotingRfq === r.id ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="mono text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>Your Rate</span>
                    <input type="number" step="any" min="0" placeholder={fmtRate(r.reference_price)} value={quotePrice}
                      onChange={e => setQuotePrice(e.target.value)}
                      className="px-3 py-1.5 rounded mono text-[13px] outline-none"
                      style={{ background: "var(--bg)", color: "var(--t0)", border: "1px solid var(--border)", width: 150 }} autoFocus />
                    <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>{quoteClean}/{baseClean}</span>
                    {parseFloat(quotePrice) > 0 && (
                      <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
                        = {toUsd(r.size * parseFloat(quotePrice), r.pair.split("/")[1] || "") || "..."} notional
                      </span>
                    )}
                    <button onClick={() => placeQuote(r.id)} disabled={quotingLoading || !quotePrice}
                      className="px-3 py-1.5 rounded text-[12px] font-semibold transition-all hover:brightness-110 disabled:opacity-30"
                      style={{ background: "var(--positive)", color: "#fff", border: "none" }}>
                      {quotingLoading ? "..." : "Submit"}
                    </button>
                    <button onClick={() => { setQuotingRfq(null); setQuotePrice(""); }}
                      className="text-[11px] hover:underline" style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>cancel</button>
                  </div>
                ) : (
                  <button onClick={() => { setQuotingRfq(r.id); setQuotePrice(fmtRate(r.reference_price)); }}
                    className="px-4 py-1.5 rounded text-[12px] font-semibold transition-all hover:brightness-110"
                    style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
                    Place Quote
                  </button>
                )}
              </div>
            )}
            {myExistingQuote && (
              <div className="px-6 py-2 text-[11px]" style={{ color: "var(--accent)", borderTop: "1px solid var(--border)" }}>
                You already have a {myExistingQuote.status} quote at {fmtRate(myExistingQuote.rate)} {quoteClean}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <Header onProfileClick={() => { setProfileTab("profile"); setProfileOpen(true); }} activePage="orderbook" />
      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} initialTab={profileTab} />

      <div className="max-w-[1440px] mx-auto px-5 py-5">

        {/* ── TOP STRIP: Vault + Oracle ── */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <VaultStrip addr={supraAddress} />
          <OracleTicker />
        </div>

        {/* ── FILTER BAR ── */}
        <div className="card mb-4">
          <div className="px-4 py-3 flex items-center gap-4 flex-wrap">
            {/* Ownership filter */}
            <div className="flex items-center gap-1">
              {(["all", "mine"] as const).map(f => (
                <button key={f} onClick={() => setOwnerFilter(f)}
                  className="px-2.5 py-0.5 rounded text-[11px] font-medium transition-all"
                  style={{ background: ownerFilter === f ? "var(--accent)" : "transparent", color: ownerFilter === f ? "#fff" : "var(--t3)", border: "1px solid " + (ownerFilter === f ? "var(--accent)" : "var(--border)") }}>
                  {f === "all" ? "All" : "My Orders"}
                </button>
              ))}
            </div>

            <div className="w-px h-5" style={{ background: "var(--border)" }} />

            {/* Chain filter */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: "var(--t3)" }}>Route</span>
              {CHAINS.map(c => (
                <button key={c} onClick={() => setChainFilter(c)}
                  className="px-2 py-0.5 rounded text-[11px] font-medium transition-all"
                  style={{ background: chainFilter === c ? "var(--accent)" : "transparent", color: chainFilter === c ? "#fff" : "var(--t3)", border: "1px solid " + (chainFilter === c ? "var(--accent)" : "var(--border)") }}>
                  {c}
                </button>
              ))}
            </div>

            <div className="w-px h-5" style={{ background: "var(--border)" }} />

            {/* Asset filter */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: "var(--t3)" }}>Asset</span>
              {ASSETS.map(a => (
                <button key={a} onClick={() => setAssetFilter(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a])}
                  className="px-2 py-0.5 rounded text-[11px] font-medium transition-all"
                  style={{ background: assetFilter.includes(a) ? "var(--accent)" : "transparent", color: assetFilter.includes(a) ? "#fff" : "var(--t3)", border: "1px solid " + (assetFilter.includes(a) ? "var(--accent)" : "var(--border)") }}>
                  {a}
                </button>
              ))}
              {assetFilter.length > 0 && (
                <button onClick={() => setAssetFilter([])}
                  className="text-[10px] hover:underline ml-1" style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>clear</button>
              )}
            </div>

            <div className="flex-1" />

            {/* View toggle */}
            <div className="flex items-center gap-1">
              {(["list", "grouped"] as const).map(v => (
                <button key={v} onClick={() => setViewMode(v)}
                  className="px-2.5 py-0.5 rounded text-[11px] font-medium transition-all"
                  style={{ background: viewMode === v ? "var(--surface-3)" : "transparent", color: viewMode === v ? "var(--t0)" : "var(--t3)", border: "1px solid " + (viewMode === v ? "var(--border-active)" : "var(--border)") }}>
                  {v === "list" ? "List" : "By Pair"}
                </button>
              ))}
            </div>

            <span className="mono text-[11px]" style={{ color: "var(--t3)" }}>{filteredRfqs.length} RFQ{filteredRfqs.length !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* ── MAIN CONTENT: RFQ Feed (left) + My Quotes sidebar (right) ── */}
        <div className="flex gap-4" style={{ alignItems: "flex-start" }}>

          {/* LEFT: RFQ Feed */}
          <div className="flex-1 min-w-0">
            <div className="card mb-4">
              <div className="card-header">
                <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>Open RFQs</span>
              </div>

              {filteredRfqs.length === 0 ? (
                <div className="py-8 text-center text-[13px]" style={{ color: "var(--t3)" }}>
                  {openRfqs.length === 0 ? "No open RFQs" : "No RFQs match your filters"}
                </div>
              ) : viewMode === "list" ? (
                <div>
                  {/* Header row */}
                  <div className="flex items-center gap-3 px-4 py-1.5" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                    {["TX ID", "Pair", "Size", "Asking", "Route", "Taker", "Age", "Quotes"].map(h => (
                      <span key={h} className={"mono text-[9px] uppercase tracking-wider font-medium " +
                        (h === "TX ID" ? "w-20" : h === "Pair" ? "w-24" : h === "Size" ? "w-20" : h === "Asking" ? "w-32" : h === "Route" ? "w-32" : h === "Taker" ? "w-24" : h === "Age" ? "w-12" : "shrink-0")}
                        style={{ color: "var(--t3)" }}>{h}</span>
                    ))}
                  </div>
                  {filteredRfqs.map(renderRfqRow)}
                </div>
              ) : (
                /* Grouped by pair */
                <div>
                  {Object.entries(groupedByPair).sort(([, a], [, b]) => b.length - a.length).map(([pair, pairRfqs]) => (
                    <div key={pair}>
                      <div className="px-4 py-2 flex items-center gap-3" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)", borderTop: "1px solid var(--border)" }}>
                        <span className="text-[13px] font-semibold" style={{ color: "var(--t0)" }}>{pair}</span>
                        <span className="mono text-[11px]" style={{ color: "var(--t3)" }}>{pairRfqs.length} RFQ{pairRfqs.length !== 1 ? "s" : ""}</span>
                        {usdPrices[pair.split("/")[0]] && (
                          <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
                            Oracle: ${usdPrices[pair.split("/")[0]].toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </span>
                        )}
                      </div>
                      {pairRfqs.map(renderRfqRow)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: My Active Quotes sidebar */}
          <div className="shrink-0" style={{ width: "300px", position: "sticky", top: "60px" }}>
            <div className="card">
              <div className="card-header">
                <span className="text-[13px] font-semibold" style={{ color: "var(--t1)" }}>My Quotes</span>
                <span className="mono text-[11px]" style={{ color: "var(--t3)" }}>{myQuotes.length}</span>
              </div>
              {myQuotes.length === 0 ? (
                <div className="py-6 text-center text-[12px]" style={{ color: "var(--t3)" }}>No active quotes</div>
              ) : (
                <div className="max-h-[calc(100vh-140px)] overflow-y-auto">
                  {myQuotes.map(q => {
                    const rfq = rfqs.find(r => r.id === q.rfq_id);
                    const pairClean = rfq ? displayPair(rfq.pair) : "--";
                    const baseClean = rfq ? rfq.pair.split("/")[0]?.replace("fx", "") || "" : "";
                    const quoteClean = rfq ? rfq.pair.split("/")[1]?.replace("fx", "") || "" : "";
                    const diff = rfq && rfq.reference_price > 0 ? ((q.rate - rfq.reference_price) / rfq.reference_price) * 100 : 0;
                    const isQExpanded = expandedQuote === q.id;
                    const notionalUsd = rfq ? toUsd(rfq.size * q.rate, rfq.pair.split("/")[1] || "") : null;
                    const takerAgent = rfq ? agents.find(a => a.wallet_address === rfq.taker_address) : null;

                    return (
                      <div key={q.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        {/* Collapsed card */}
                        <div className="px-3 py-2.5 cursor-pointer hover:bg-white/[0.02] transition-colors"
                          onClick={() => setExpandedQuote(isQExpanded ? null : q.id)}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[13px] font-semibold" style={{ color: "var(--t0)" }}>{pairClean}</span>
                            <div className="flex items-center gap-1.5">
                              <span className="tag" style={q.status === "review" ? { background: "rgba(234,179,8,0.12)", color: "var(--warn)" } : {}}>
                                {q.status === "review" ? "review" : q.status}
                              </span>
                              <span className="text-[9px]" style={{ color: "var(--t3)" }}>{isQExpanded ? "^" : "v"}</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="mono text-[12px] font-semibold" style={{ color: "var(--t1)" }}>{fmtRate(q.rate)} {quoteClean}</span>
                            <span className="mono text-[10px]" style={{ color: diff >= 0 ? "var(--positive)" : "var(--negative)" }}>
                              {diff >= 0 ? "+" : ""}{diff.toFixed(2)}%
                            </span>
                          </div>
                        </div>

                        {/* Expanded details */}
                        {isQExpanded && (
                          <div className="animate-slide-down px-3 pb-3 space-y-2" style={{ background: "var(--bg-raised)", borderTop: "1px solid var(--border)" }}>
                            <div className="grid grid-cols-2 gap-2 pt-2">
                              <div>
                                <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Size</div>
                                <div className="mono text-[12px]" style={{ color: "var(--t1)" }}>{rfq ? rfq.size : "--"} {baseClean}</div>
                              </div>
                              <div>
                                <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Notional</div>
                                <div className="mono text-[12px]" style={{ color: "var(--t1)" }}>{notionalUsd || "--"}</div>
                              </div>
                              <div>
                                <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>RFQ Asking</div>
                                <div className="mono text-[12px]" style={{ color: "var(--t2)" }}>{rfq ? fmtRate(rfq.reference_price) : "--"} {quoteClean}</div>
                              </div>
                              <div>
                                <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Route</div>
                                <div className="text-[11px]" style={{ color: "var(--t2)" }}>
                                  {rfq ? (rfq.source_chain === rfq.dest_chain ? "Same-chain" : rfq.source_chain.replace("-testnet", "") + " > " + rfq.dest_chain.replace("-testnet", "")) : "--"}
                                </div>
                              </div>
                              <div>
                                <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Taker</div>
                                <div className="mono text-[11px]" style={{ color: "var(--t2)" }}>
                                  {rfq ? shortAddr(rfq.taker_address) : "--"}
                                  {takerAgent && <span className="ml-1" style={{ color: Number(takerAgent.rep_total) >= 4 ? "var(--positive)" : "var(--t3)" }}>* {Number(takerAgent.rep_total).toFixed(1)}</span>}
                                </div>
                              </div>
                              <div>
                                <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Quoted</div>
                                <div className="mono text-[11px]" style={{ color: "var(--t3)" }}>{timeAgo(q.created_at)}</div>
                              </div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); withdrawQuote(q.id); }} disabled={withdrawing === q.id}
                              className="w-full py-1.5 rounded text-[11px] font-semibold transition-all hover:brightness-110 disabled:opacity-50"
                              style={{ background: "var(--negative)", color: "#fff", border: "none" }}>
                              {withdrawing === q.id ? "Withdrawing..." : "Withdraw Quote"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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

export default function OrderbookPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <WalletProvider>
      <OrderbookDashboard />
    </WalletProvider>
  );
}
