"use client";
import { useState, useEffect, useRef } from "react";

const DORA_SOURCES = [
  "Binance", "Coinbase", "Kraken", "OKX", "Bybit",
  "KuCoin", "Gate.io", "Bitstamp", "Bitfinex", "Huobi",
  "Gemini", "Crypto.com", "MEXC", "BingX", "Bitget",
  "WhiteBIT", "Upbit", "Bithumb", "CoinW", "Phemex", "LBank"
];

const TOKEN_LABELS: Record<string, string> = {
  ETH: "Ethereum", SUPRA: "Supra",
  fxAAVE: "Aave", fxLINK: "Chainlink", fxUSDC: "USDC", fxUSDT: "USDT",
  AAVE: "Aave", LINK: "Chainlink", USDC: "USDC", USDT: "USDT",
};

function fmt(n: number, decimals?: number) {
  if (n >= 1000) return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return "$" + n.toFixed(decimals ?? 4);
  return "$" + n.toFixed(decimals ?? 6);
}

function fmtRate(n: number) {
  if (n >= 1000) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

interface OracleData {
  pair: string;
  base: { token: string; oraclePair: string; price: number; high24h: number; low24h: number; change24h: number; timestamp: string };
  quote: { token: string; oraclePair: string; price: number; high24h: number; low24h: number; change24h: number; timestamp: string } | null;
  conversionRate: number;
  updatedAt: number;
}

export default function OraclePrice({ pair }: { pair: string }) {
  const [data, setData] = useState<OracleData | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<any>(null);

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch("/api/oracle?pair=" + encodeURIComponent(pair));
        if (!res.ok) { setError("Oracle unavailable"); return; }
        const d = await res.json();
        if (d.error) { setError(d.error); return; }
        setError(null);
        setData(prev => {
          if (prev && prev.base.price !== d.base.price) {
            setFlash(d.base.price > prev.base.price ? "up" : "down");
            setTimeout(() => setFlash(null), 600);
          }
          return d;
        });
      } catch { setError("Failed to fetch oracle data"); }
    };
    fetchPrice();
    intervalRef.current = setInterval(fetchPrice, 2000);
    return () => clearInterval(intervalRef.current);
  }, [pair]);

  if (error) return (
    <div className="px-4 py-3 border-t" style={{ borderColor: "var(--border)" }}>
      <div className="text-[12px]" style={{ color: "var(--t3)" }}>Oracle: {error}</div>
    </div>
  );

  if (!data) return (
    <div className="px-4 py-3 border-t" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full animate-spin" style={{ border: "2px solid var(--accent)", borderTopColor: "transparent" }} />
        <span className="text-[13px]" style={{ color: "var(--t3)" }}>Loading Supra Oracle feed...</span>
      </div>
    </div>
  );

  const [base, quote] = pair.split("/");
  const baseName = TOKEN_LABELS[base] || base;
  const quoteName = TOKEN_LABELS[quote] || quote;
  const changeColor = data.base.change24h >= 0 ? "var(--positive)" : "var(--negative)";
  const changePrefix = data.base.change24h >= 0 ? "+" : "";
  const ago = Math.max(0, Math.round((Date.now() - data.updatedAt) / 1000));

  const flashBg = flash === "up" ? "rgba(34,197,94,0.08)"
    : flash === "down" ? "rgba(239,68,68,0.08)" : "transparent";

  return (
    <div className="border-t" style={{ borderColor: "var(--border)" }}>
      <div className="px-4 py-3" style={{ background: flashBg, transition: "background 0.4s" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold" style={{ color: "var(--t1)" }}>Reference Price</span>
            <span className="mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>Supra Oracle</span>
          </div>
          <span className="mono text-[11px]" style={{ color: "var(--t3)" }}>{ago}s ago</span>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="text-[12px] mb-0.5" style={{ color: "var(--t3)" }}>{baseName} S-Value</div>
            <div className="flex items-baseline gap-2">
              <span className="mono text-[22px] font-bold tracking-tight" style={{ color: "var(--t0)" }}>{fmt(data.base.price)}</span>
              <span className="mono text-[13px] font-semibold" style={{ color: changeColor }}>{changePrefix}{data.base.change24h.toFixed(2)}%</span>
            </div>
          </div>

          <div>
            <div className="text-[12px] mb-0.5" style={{ color: "var(--t3)" }}>24h Range</div>
            <div className="mono text-[13px]" style={{ color: "var(--t2)" }}>{fmt(data.base.low24h)} — {fmt(data.base.high24h)}</div>
          </div>

          {data.quote && (
            <div>
              <div className="text-[12px] mb-0.5" style={{ color: "var(--t3)" }}>{quoteName} S-Value</div>
              <div className="mono text-[14px] font-semibold" style={{ color: "var(--t1)" }}>{fmt(data.quote.price)}</div>
            </div>
          )}

          <div>
            <div className="text-[12px] mb-0.5" style={{ color: "var(--t3)" }}>Conversion Rate</div>
            <div className="mono text-[14px] font-semibold" style={{ color: "var(--accent)" }}>1 {baseName} = {fmtRate(data.conversionRate)} {quoteName}</div>
          </div>
        </div>

        <button onClick={() => setShowSources(!showSources)}
          className="mt-2 text-[12px] transition-colors hover:underline"
          style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          {showSources ? "Hide Sources" : "View Sources"} ({DORA_SOURCES.length})
        </button>
      </div>

      {showSources && (
        <div className="px-4 pb-3 animate-slide-down">
          <div className="rounded-md p-3" style={{ background: "var(--bg-raised)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="mono text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>DORA Aggregation Sources</span>
              <span className="text-[11px]" style={{ color: "var(--t3)" }}>BFT consensus across {DORA_SOURCES.length} exchanges</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DORA_SOURCES.map(s => (
                <span key={s} className="mono text-[11px] px-2 py-1 rounded"
                  style={{ background: "var(--surface-2)", color: "var(--t2)", border: "1px solid var(--border)" }}>{s}</span>
              ))}
            </div>
            <div className="text-[11px] mt-2" style={{ color: "var(--t3)" }}>
              S-Value computed via Supra DORA protocol. Each node obtains data from multiple assigned sources and computes the median. Randomized Tribe-Clan architecture with dVRF ensures decentralization.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}