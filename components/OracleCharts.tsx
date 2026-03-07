"use client";
import { useState, useEffect, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const TIMEFRAMES = ["Live", "1H", "24H"] as const;

function formatTime(ts: number, tf: string): string {
  const d = new Date(ts);
  if (tf === "Live") return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  if (tf === "1H") return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

function SingleChart({ token, onRemove }: { token: string; onRemove: () => void }) {
  const [timeframe, setTimeframe] = useState<typeof TIMEFRAMES[number]>("Live");
  const [data, setData] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);

  const fetchData = useCallback(async () => {
    try {
      const apiTf = timeframe === "Live" ? "Live" : timeframe === "1H" ? "1H" : "24H";
      const res = await fetch(`/api/oracle/history?token=${encodeURIComponent(token)}&timeframe=${apiTf}`);
      const d = await res.json();
      if (d.error) { setError(d.error); setData([]); }
      else if (d.candles?.length > 0) {
        setData(d.candles);
        const last = d.candles[d.candles.length - 1];
        const first = d.candles[0];
        setCurrentPrice(last.close);
        setPriceChange(first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0);
        setError(null);
      } else { setData([]); setError("No data"); }
    } catch (e: any) { setError(e.message); setData([]); }
    setLoading(false);
  }, [token, timeframe]);

  useEffect(() => { setLoading(true); fetchData(); }, [fetchData]);
  useEffect(() => {
    // Live = 2s, 1H = 10s, 24H = 30s
    const interval = timeframe === "Live" ? 2000 : timeframe === "1H" ? 10000 : 30000;
    const iv = setInterval(fetchData, interval);
    return () => clearInterval(iv);
  }, [fetchData, timeframe]);

  const isUp = priceChange >= 0;
  const accentColor = isUp ? "#22c55e" : "#ef4444";
  const gradientId = `gradient-${token.replace(/[^a-zA-Z]/g, "")}`;
  const glowId = `glow-${token.replace(/[^a-zA-Z]/g, "")}`;
  const minPrice = data.length > 0 ? Math.min(...data.map(d => d.low)) * 0.9995 : 0;
  const maxPrice = data.length > 0 ? Math.max(...data.map(d => d.high)) * 1.0005 : 0;

  return (
    <div className="overflow-hidden" style={{ background: "linear-gradient(180deg, var(--surface) 0%, rgba(10,10,14,0.95) 100%)", border: "1px solid var(--border)" }}>
      {/* Header — single compact row */}
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[12px] font-bold tracking-wide" style={{ color: "var(--t0)" }}>{token}</span>
          {currentPrice !== null && (
            <>
              <span className="mono text-[12px] font-bold tabular-nums" style={{ color: accentColor }}>
                ${formatPrice(currentPrice)}
              </span>
              <span className="mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: isUp ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", color: accentColor }}>
                {isUp ? "+" : ""}{priceChange.toFixed(2)}%
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)}
              className="px-1.5 py-0.5 text-[8px] mono font-bold uppercase transition-all"
              style={{
                background: timeframe === tf ? accentColor : "transparent",
                color: timeframe === tf ? "#fff" : "var(--t3)",
                border: "none",
                opacity: timeframe === tf ? 1 : 0.6,
              }}>
              {tf}
            </button>
          ))}
          <button onClick={onRemove} className="ml-1 text-[10px] px-1 hover:brightness-150"
            style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>x</button>
        </div>
      </div>

      {/* Chart */}
      <div style={{ height: 160 }}>
        {loading && data.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[11px]" style={{ color: "var(--t3)" }}>Loading...</div>
        ) : error && data.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[11px]" style={{ color: "var(--negative)" }}>{error}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accentColor} stopOpacity={0.3} />
                  <stop offset="50%" stopColor={accentColor} stopOpacity={0.08} />
                  <stop offset="100%" stopColor={accentColor} stopOpacity={0} />
                </linearGradient>
                <filter id={glowId}>
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <XAxis dataKey="time" tickFormatter={t => formatTime(t, timeframe)} tick={{ fill: "var(--t3)", fontSize: 8 }} axisLine={false} tickLine={false} minTickGap={50} />
              <YAxis domain={[minPrice, maxPrice]} tickFormatter={formatPrice} tick={{ fill: "var(--t3)", fontSize: 8 }} axisLine={false} tickLine={false} width={52} />
              <Tooltip
                contentStyle={{ background: "rgba(15,15,20,0.95)", border: `1px solid ${accentColor}40`, borderRadius: 8, fontSize: 11, backdropFilter: "blur(8px)" }}
                labelStyle={{ color: "var(--t3)", fontSize: 9 }}
                labelFormatter={t => new Date(t).toLocaleString()}
                formatter={(v: any) => ["$" + formatPrice(Number(v)), "Price"]}
                cursor={{ stroke: accentColor, strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={accentColor}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 3, fill: accentColor, stroke: "#fff", strokeWidth: 1 }}
                filter={`url(#${glowId})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default function OracleCharts({ activeCharts, onRemoveChart }: { activeCharts: string[]; onRemoveChart: (token: string) => void }) {
  if (activeCharts.length === 0) return null;

  return (
    <div className="mb-4 animate-slide-down">
      <div className="grid grid-cols-4 gap-3">
        {activeCharts.map(token => (
          <SingleChart key={token} token={token} onRemove={() => onRemoveChart(token)} />
        ))}
      </div>
    </div>
  );
}
