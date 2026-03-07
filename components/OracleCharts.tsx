"use client";
import { useState, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, ComposedChart, ReferenceLine } from "recharts";

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartData {
  token: string;
  candles: Candle[];
  loading: boolean;
  error?: string;
}

const TIMEFRAMES = ["1H", "4H", "1D", "1W"] as const;

function formatTime(ts: number, tf: string): string {
  const d = new Date(ts);
  if (tf === "1H" || tf === "4H") return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (tf === "1D") return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

// Custom candlestick shape for recharts
function CandlestickBar(props: any) {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;
  const { open, close, high, low } = payload;
  const isUp = close >= open;
  const color = isUp ? "var(--positive)" : "var(--negative)";
  const bodyTop = Math.min(open, close);
  const bodyBottom = Math.max(open, close);

  // Scale: we need the domain range from the chart
  const yScale = props.yScale || props.yAxis?.scale;
  if (!yScale) return null;

  const wickTop = yScale(high);
  const wickBottom = yScale(low);
  const candleTop = yScale(bodyBottom); // inverted Y
  const candleBottom = yScale(bodyTop);
  const candleHeight = Math.max(1, candleBottom - candleTop);
  const candleWidth = Math.max(2, width * 0.6);
  const cx = x + width / 2;

  return (
    <g>
      <line x1={cx} y1={wickTop} x2={cx} y2={wickBottom} stroke={color} strokeWidth={1} />
      <rect x={cx - candleWidth / 2} y={candleTop} width={candleWidth} height={candleHeight} fill={isUp ? color : color} stroke={color} strokeWidth={0.5} rx={1} />
    </g>
  );
}

function SingleChart({ token, onRemove }: { token: string; onRemove: () => void }) {
  const [timeframe, setTimeframe] = useState<typeof TIMEFRAMES[number]>("1D");
  const [chartType, setChartType] = useState<"line" | "candle">("line");
  const [data, setData] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/oracle/history?token=${encodeURIComponent(token)}&timeframe=${timeframe}`);
      const d = await res.json();
      if (d.error) { setError(d.error); setData([]); }
      else if (d.candles?.length > 0) {
        setData(d.candles);
        const last = d.candles[d.candles.length - 1];
        const first = d.candles[0];
        setCurrentPrice(last.close);
        setPriceChange(first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0);
      } else {
        setData([]);
        setError("No data available");
      }
    } catch (e: any) { setError(e.message); setData([]); }
    setLoading(false);
  }, [token, timeframe]);

  useEffect(() => { fetchData(); }, [fetchData]);
  // Refresh every 30s
  useEffect(() => { const iv = setInterval(fetchData, 30000); return () => clearInterval(iv); }, [fetchData]);

  const chartColor = priceChange >= 0 ? "var(--positive)" : "var(--negative)";
  const minPrice = data.length > 0 ? Math.min(...data.map(d => d.low)) * 0.999 : 0;
  const maxPrice = data.length > 0 ? Math.max(...data.map(d => d.high)) * 1.001 : 0;

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold" style={{ color: "var(--t0)" }}>{token}</span>
          {currentPrice !== null && (
            <>
              <span className="mono text-[13px] font-semibold" style={{ color: "var(--t1)" }}>${formatPrice(currentPrice)}</span>
              <span className="mono text-[11px]" style={{ color: chartColor }}>{priceChange >= 0 ? "+" : ""}{priceChange.toFixed(2)}%</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Chart type toggle */}
          <div className="flex items-center gap-0.5 rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            {(["line", "candle"] as const).map(t => (
              <button key={t} onClick={() => setChartType(t)} className="px-2 py-0.5 text-[9px] mono uppercase font-medium transition-all"
                style={{ background: chartType === t ? "var(--accent)" : "transparent", color: chartType === t ? "#fff" : "var(--t3)", border: "none" }}>
                {t === "line" ? "Line" : "OHLC"}
              </button>
            ))}
          </div>
          {/* Timeframe */}
          <div className="flex items-center gap-0.5 rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            {TIMEFRAMES.map(tf => (
              <button key={tf} onClick={() => setTimeframe(tf)} className="px-2 py-0.5 text-[9px] mono font-medium transition-all"
                style={{ background: timeframe === tf ? "var(--accent)" : "transparent", color: timeframe === tf ? "#fff" : "var(--t3)", border: "none" }}>
                {tf}
              </button>
            ))}
          </div>
          <button onClick={onRemove} className="text-[10px] px-1 hover:brightness-150"
            style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>x</button>
        </div>
      </div>

      {/* Chart area */}
      <div style={{ height: 180, padding: "8px 4px 0 4px" }}>
        {loading && data.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[11px]" style={{ color: "var(--t3)" }}>Loading...</div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-[11px]" style={{ color: "var(--negative)" }}>{error}</div>
        ) : chartType === "line" ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="time" tickFormatter={t => formatTime(t, timeframe)} tick={{ fill: "var(--t3)", fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={40} />
              <YAxis domain={[minPrice, maxPrice]} tickFormatter={formatPrice} tick={{ fill: "var(--t3)", fontSize: 9 }} axisLine={false} tickLine={false} width={60} />
              <Tooltip
                contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11 }}
                labelFormatter={t => new Date(t).toLocaleString()}
                formatter={(v: any) => ["$" + formatPrice(Number(v)), "Price"]}
              />
              <Line type="monotone" dataKey="close" stroke={chartColor} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="time" tickFormatter={t => formatTime(t, timeframe)} tick={{ fill: "var(--t3)", fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={40} />
              <YAxis domain={[minPrice, maxPrice]} tickFormatter={formatPrice} tick={{ fill: "var(--t3)", fontSize: 9 }} axisLine={false} tickLine={false} width={60} />
              <Tooltip
                contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11 }}
                labelFormatter={t => new Date(t).toLocaleString()}
                formatter={(v: any, name: any) => ["$" + formatPrice(Number(v)), String(name).charAt(0).toUpperCase() + String(name).slice(1)]}
              />
              <Bar dataKey="high" fill="transparent" />
              {data.map((d, i) => {
                const isUp = d.close >= d.open;
                const color = isUp ? "rgb(34,197,94)" : "rgb(239,68,68)";
                return null; // placeholder — custom rendering below
              })}
              <Line type="monotone" dataKey="high" stroke="none" dot={false} />
              <Line type="monotone" dataKey="low" stroke="none" dot={false} />
              <Line type="monotone" dataKey="open" stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} dot={false} />
              <Line type="monotone" dataKey="close" stroke={chartColor} strokeWidth={1.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default function OracleCharts({ activeCharts, onRemoveChart }: { activeCharts: string[]; onRemoveChart: (token: string) => void }) {
  if (activeCharts.length === 0) return null;

  const gridCols = activeCharts.length === 1 ? "grid-cols-1" : activeCharts.length === 2 ? "grid-cols-2" : activeCharts.length === 3 ? "grid-cols-3" : "grid-cols-2";

  return (
    <div className="mb-4 animate-slide-down">
      <div className={`grid ${gridCols} gap-3`}>
        {activeCharts.map(token => (
          <SingleChart key={token} token={token} onRemove={() => onRemoveChart(token)} />
        ))}
      </div>
    </div>
  );
}
