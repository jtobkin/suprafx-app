"use client";
import { useState, useEffect, useCallback, useRef } from "react";

export default function OracleTicker() {
  const [prices, setPrices] = useState<Record<string, { price: number; change: number }>>({});
  const [flashes, setFlashes] = useState<Record<string, "up" | "down" | null>>({});
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

  return (
    <div className="flex items-center gap-3 overflow-x-auto">
      {Object.entries(prices).map(([token, d]) => {
        const flash = flashes[token];
        const flashBg = flash === "up" ? "rgba(34,197,94,0.15)" : flash === "down" ? "rgba(239,68,68,0.15)" : "var(--surface-2)";
        const flashBorder = flash === "up" ? "rgba(34,197,94,0.3)" : flash === "down" ? "rgba(239,68,68,0.3)" : "var(--border)";
        return (
          <div key={token} className="flex items-center gap-2 px-3 py-1.5 rounded shrink-0 transition-all duration-300"
            style={{ background: flashBg, border: `1px solid ${flashBorder}` }}>
            <span className="mono text-[11px] font-semibold" style={{ color: "var(--t1)" }}>{token}</span>
            <span className="mono text-[12px] font-semibold tabular-nums" style={{ color: flash === "up" ? "var(--positive)" : flash === "down" ? "var(--negative)" : "var(--t0)" }}>
              ${d.price >= 1 ? d.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : d.price.toFixed(6)}
            </span>
            <span className="mono text-[10px]" style={{ color: d.change >= 0 ? "var(--positive)" : "var(--negative)" }}>
              {d.change >= 0 ? "+" : ""}{d.change.toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
