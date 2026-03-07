"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import OracleCharts from "./OracleCharts";
import FeedCustomizer from "./FeedCustomizer";
import { DEFAULT_TICKER_FEEDS } from "@/lib/oracle-feeds";
import { supabase } from "@/lib/supabase";

const MAX_CHARTS = 4;

// Fetch price for a single token via the history endpoint (works for all asset types)
async function fetchTokenPrice(token: string): Promise<{ price: number; change: number } | null> {
  try {
    const res = await fetch(`/api/oracle/history?token=${encodeURIComponent(token)}&timeframe=1H`);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.candles?.length > 0) {
      const last = d.candles[d.candles.length - 1];
      const first = d.candles[0];
      const change = first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0;
      return { price: last.close, change };
    }
    return null;
  } catch { return null; }
}

export default function OracleTicker() {
  const [prices, setPrices] = useState<Record<string, { price: number; change: number }>>({});
  const [flashes, setFlashes] = useState<Record<string, "up" | "down" | null>>({});
  const [selectedFeeds, setSelectedFeeds] = useState<string[]>(DEFAULT_TICKER_FEEDS);
  const [chartFeeds, setChartFeeds] = useState<string[]>(["ETH", "SOL", "AAVE", "SUPRA"]);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const prevPrices = useRef<Record<string, number>>({});
  const walletAddr = useRef<string | null>(null);

  // Load preferences from Supabase
  useEffect(() => {
    const addr = typeof window !== "undefined" ? sessionStorage.getItem("suprafx_addr") : null;
    walletAddr.current = addr;
    if (!addr) { setPrefsLoaded(true); return; }

    (async () => {
      try {
        const { data } = await supabase.from("oracle_preferences").select("ticker_feeds, chart_feeds").eq("wallet_address", addr).single();
        if (data) {
          if (Array.isArray(data.ticker_feeds) && data.ticker_feeds.length > 0) setSelectedFeeds(data.ticker_feeds);
          if (Array.isArray(data.chart_feeds)) setChartFeeds(data.chart_feeds);
        }
      } catch {}
      setPrefsLoaded(true);
    })();
  }, []);

  // Save preferences to Supabase
  const savePrefs = useCallback((feeds: string[], charts: string[]) => {
    const addr = walletAddr.current;
    if (!addr) return;
    supabase.from("oracle_preferences").upsert({
      wallet_address: addr,
      ticker_feeds: feeds,
      chart_feeds: charts,
      updated_at: new Date().toISOString(),
    }, { onConflict: "wallet_address" }).then(() => {});
  }, []);

  const updateFeeds = useCallback((feeds: string[]) => {
    setSelectedFeeds(feeds);
    savePrefs(feeds, chartFeeds);
  }, [chartFeeds, savePrefs]);

  const updateCharts = useCallback((charts: string[]) => {
    setChartFeeds(charts);
    savePrefs(selectedFeeds, charts);
  }, [selectedFeeds, savePrefs]);

  // Fetch prices for all selected feeds
  const fetchPrices = useCallback(async () => {
    const results = await Promise.all(
      selectedFeeds.map(async (token) => {
        const data = await fetchTokenPrice(token);
        return { token, data };
      })
    );

    const m: Record<string, { price: number; change: number }> = {};
    for (const { token, data } of results) {
      if (data) m[token] = data;
    }

    // Flash detection
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
  }, [selectedFeeds]);

  useEffect(() => { if (prefsLoaded) fetchPrices(); }, [fetchPrices, prefsLoaded]);
  useEffect(() => { if (!prefsLoaded) return; const iv = setInterval(fetchPrices, 5000); return () => clearInterval(iv); }, [fetchPrices, prefsLoaded]);

  const toggleChart = (token: string) => {
    if (chartFeeds.includes(token)) {
      updateCharts(chartFeeds.filter(t => t !== token));
    } else if (chartFeeds.length < MAX_CHARTS) {
      updateCharts([...chartFeeds, token]);
    }
  };

  const removeChart = (token: string) => {
    updateCharts(chartFeeds.filter(t => t !== token));
  };

  return (
    <div>
      {/* Ticker strip with fixed controls */}
      <div className="flex items-center gap-2 mb-1">
        {/* Scrolling ticker */}
        <div className="flex-1 relative overflow-hidden" style={{ maskImage: "linear-gradient(to right, transparent 0%, black 3%, black 97%, transparent 100%)" }}>
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes ticker-scroll {
              0% { transform: translateX(0); }
              100% { transform: translateX(-50%); }
            }
            .ticker-track { display: flex; gap: 12px; width: max-content; animation: ticker-scroll 40s linear infinite; align-items: center; }
            .ticker-track:hover { animation-play-state: paused; }
          `}} />
          <div className="ticker-track" style={{ paddingRight: 12 }}>
            {/* Render items twice for seamless loop */}
            {[...selectedFeeds, ...selectedFeeds].map((token, idx) => {
              const d = prices[token];
              const flash = flashes[token];
              const isCharted = chartFeeds.includes(token);
              const flashBg = flash === "up" ? "rgba(0,200,83,0.08)" : flash === "down" ? "rgba(255,23,68,0.08)" : "var(--surface-2)";
              const flashBorder = flash === "up" ? "rgba(0,200,83,0.2)" : flash === "down" ? "rgba(255,23,68,0.2)" : "var(--border)";
              return (
                <button key={`${token}-${idx}`} onClick={() => toggleChart(token)}
                  className="flex items-center gap-2 px-3 py-1 shrink-0 transition-all duration-300 hover:brightness-110"
                  style={{ background: flashBg, borderRight: `1px solid ${flashBorder}`, cursor: "pointer", height: 28 }}>
                  <span className="mono text-[10px] font-bold" style={{ color: "var(--t1)", letterSpacing: "0.5px" }}>{token}</span>
                  {d ? (
                    <>
                      <span className="mono text-[12px] font-semibold tabular-nums" style={{ color: flash === "up" ? "var(--positive)" : flash === "down" ? "var(--negative)" : "var(--t0)" }}>
                        ${d.price >= 1 ? d.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : d.price.toFixed(6)}
                      </span>
                      <span className="mono text-[10px]" style={{ color: d.change >= 0 ? "var(--positive)" : "var(--negative)" }}>
                        {d.change >= 0 ? "+" : ""}{d.change.toFixed(2)}%
                      </span>
                    </>
                  ) : (
                    <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>--</span>
                  )}
                  {isCharted && <span className="w-1 h-1" style={{ background: "var(--accent)" }} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Fixed controls */}
        <div className="flex items-center gap-2 shrink-0">
          {chartFeeds.length > 0 && (
            <button onClick={() => updateCharts([])} className="text-[9px] mono hover:underline"
              style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>
              Clear charts
            </button>
          )}
          <button onClick={() => setShowCustomizer(true)} className="text-[10px] hover:underline"
            style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>
            Customize
          </button>
        </div>
      </div>

      {/* Charts section */}
      <OracleCharts activeCharts={chartFeeds} onRemoveChart={removeChart} />

      {/* Customizer modal */}
      <FeedCustomizer
        open={showCustomizer}
        onClose={() => setShowCustomizer(false)}
        selectedFeeds={selectedFeeds}
        chartFeeds={chartFeeds}
        onUpdateFeeds={updateFeeds}
        onUpdateCharts={updateCharts}
      />
    </div>
  );
}
