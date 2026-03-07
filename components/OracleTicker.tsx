"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import OracleCharts from "./OracleCharts";

const MAX_CHARTS = 4;

export default function OracleTicker() {
  const [prices, setPrices] = useState<Record<string, { price: number; change: number }>>({});
  const [flashes, setFlashes] = useState<Record<string, "up" | "down" | null>>({});
  const [activeCharts, setActiveCharts] = useState<string[]>([]);
  const prevPrices = useRef<Record<string, number>>({});

  const fetchPrices = useCallback(() => {
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

        const newFlashes: Record<string, "up" | "down" | null> = {};
        for (const [token, data] of Object.entries(m)) {
          const prev = prevPrices.current[token];
          if (prev !== undefined && prev !== data.price) {
            newFlashes[token] = data.price > prev ? "up" : "down";
          }
          prevPrices.current[token] = data.price;
        }

        setPrices(m);
        if (Object.keys(newFlashes).length > 0) {
          setFlashes(newFlashes);
          setTimeout(() => setFlashes({}), 1200);
        }
      });
  }, []);

  useEffect(() => { fetchPrices(); }, [fetchPrices]);
  useEffect(() => { const iv = setInterval(fetchPrices, 5000); return () => clearInterval(iv); }, [fetchPrices]);

  const toggleChart = (token: string) => {
    setActiveCharts(prev => {
      if (prev.includes(token)) return prev.filter(t => t !== token);
      if (prev.length >= MAX_CHARTS) return prev; // max 4
      return [...prev, token];
    });
  };

  const removeChart = (token: string) => {
    setActiveCharts(prev => prev.filter(t => t !== token));
  };

  // Map display names back to oracle-compatible names
  // The ticker shows "AAVE" but the oracle API expects "AAVE" for history
  const tokenToOracleKey = (token: string): string => {
    // These are the display names from the ticker
    return token;
  };

  return (
    <div>
      {/* Ticker strip */}
      <div className="flex items-center gap-3 overflow-x-auto mb-1">
        {Object.entries(prices).map(([token, d]) => {
          const flash = flashes[token];
          const isCharted = activeCharts.includes(token);
          const flashBg = flash === "up" ? "rgba(34,197,94,0.15)" : flash === "down" ? "rgba(239,68,68,0.15)" : isCharted ? "rgba(37,99,235,0.1)" : "var(--surface-2)";
          const flashBorder = flash === "up" ? "rgba(34,197,94,0.3)" : flash === "down" ? "rgba(239,68,68,0.3)" : isCharted ? "rgba(37,99,235,0.4)" : "var(--border)";
          return (
            <button key={token} onClick={() => toggleChart(token)}
              className="flex items-center gap-2 px-3 py-1.5 rounded shrink-0 transition-all duration-300 hover:brightness-110"
              style={{ background: flashBg, border: `1px solid ${flashBorder}`, cursor: "pointer" }}>
              <span className="mono text-[11px] font-semibold" style={{ color: isCharted ? "var(--accent)" : "var(--t1)" }}>{token}</span>
              <span className="mono text-[12px] font-semibold tabular-nums" style={{ color: flash === "up" ? "var(--positive)" : flash === "down" ? "var(--negative)" : "var(--t0)" }}>
                ${d.price >= 1 ? d.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : d.price.toFixed(6)}
              </span>
              <span className="mono text-[10px]" style={{ color: d.change >= 0 ? "var(--positive)" : "var(--negative)" }}>
                {d.change >= 0 ? "+" : ""}{d.change.toFixed(2)}%
              </span>
              {isCharted && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />}
            </button>
          );
        })}
        {activeCharts.length > 0 && (
          <button onClick={() => setActiveCharts([])} className="text-[9px] mono px-2 py-1 rounded shrink-0 hover:underline"
            style={{ color: "var(--t3)", background: "none", border: "1px solid var(--border)", cursor: "pointer" }}>
            Clear charts
          </button>
        )}
        {activeCharts.length === 0 && Object.keys(prices).length > 0 && (
          <span className="text-[9px] shrink-0" style={{ color: "var(--t3)" }}>Click to chart (max {MAX_CHARTS})</span>
        )}
      </div>

      {/* Charts section */}
      <OracleCharts activeCharts={activeCharts} onRemoveChart={removeChart} />
    </div>
  );
}
