"use client";
import { useState, useMemo } from "react";
import { ORACLE_FEEDS, FEED_CATEGORIES, type FeedCategory } from "@/lib/oracle-feeds";

interface Props {
  open: boolean;
  onClose: () => void;
  selectedFeeds: string[];
  chartFeeds: string[];
  onUpdateFeeds: (feeds: string[]) => void;
  onUpdateCharts: (charts: string[]) => void;
}

const MAX_CHARTS = 4;

export default function FeedCustomizer({ open, onClose, selectedFeeds, chartFeeds, onUpdateFeeds, onUpdateCharts }: Props) {
  const [activeTab, setActiveTab] = useState<FeedCategory>("Crypto");
  const [search, setSearch] = useState("");

  const filteredFeeds = useMemo(() => {
    return ORACLE_FEEDS
      .filter(f => f.category === activeTab)
      .filter(f => !search || f.token.toLowerCase().includes(search.toLowerCase()) || f.oraclePair.toLowerCase().includes(search.toLowerCase()));
  }, [activeTab, search]);

  const toggleFeed = (token: string) => {
    if (selectedFeeds.includes(token)) {
      onUpdateFeeds(selectedFeeds.filter(t => t !== token));
      // Also remove from charts if it was pinned
      if (chartFeeds.includes(token)) onUpdateCharts(chartFeeds.filter(t => t !== token));
    } else {
      onUpdateFeeds([...selectedFeeds, token]);
    }
  };

  const toggleChart = (token: string) => {
    if (chartFeeds.includes(token)) {
      onUpdateCharts(chartFeeds.filter(t => t !== token));
    } else if (chartFeeds.length < MAX_CHARTS) {
      // Auto-add to ticker feeds if not already
      if (!selectedFeeds.includes(token)) onUpdateFeeds([...selectedFeeds, token]);
      onUpdateCharts([...chartFeeds, token]);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-[640px] mx-4 rounded-xl overflow-hidden animate-slide-down"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="text-[15px] font-bold" style={{ color: "var(--t0)" }}>Customize Data Feed</div>
            <div className="text-[11px] mt-0.5" style={{ color: "var(--t3)" }}>
              {selectedFeeds.length} feeds selected · {chartFeeds.length}/{MAX_CHARTS} charts pinned
            </div>
          </div>
          <button onClick={onClose} className="px-3 py-1.5 rounded text-[12px] font-semibold hover:brightness-110"
            style={{ background: "var(--accent)", color: "#fff", border: "none" }}>Done</button>
        </div>

        {/* Category tabs */}
        <div className="px-5 pt-3 pb-2 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
          {FEED_CATEGORIES.map(cat => (
            <button key={cat} onClick={() => { setActiveTab(cat); setSearch(""); }}
              className="px-3 py-1 rounded text-[11px] font-medium transition-all"
              style={{
                background: activeTab === cat ? "var(--accent)" : "transparent",
                color: activeTab === cat ? "#fff" : "var(--t3)",
                border: "1px solid " + (activeTab === cat ? "var(--accent)" : "var(--border)"),
              }}>
              {cat}
            </button>
          ))}
          <div className="flex-1" />
          <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
            className="px-2.5 py-1 rounded text-[11px] mono outline-none"
            style={{ background: "var(--bg)", color: "var(--t0)", border: "1px solid var(--border)", width: 140 }} />
        </div>

        {/* Feed list */}
        <div className="flex-1 overflow-y-auto px-5 py-2" style={{ maxHeight: "50vh" }}>
          {filteredFeeds.length === 0 ? (
            <div className="py-8 text-center text-[12px]" style={{ color: "var(--t3)" }}>No feeds match your search</div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {filteredFeeds.map(feed => {
                const isSelected = selectedFeeds.includes(feed.token);
                const isCharted = chartFeeds.includes(feed.token);
                return (
                  <div key={feed.token} className="flex items-center gap-2 px-3 py-2 rounded transition-all"
                    style={{
                      background: isSelected ? "rgba(37,99,235,0.06)" : "transparent",
                      border: "1px solid " + (isCharted ? "var(--accent)" : isSelected ? "rgba(37,99,235,0.2)" : "var(--border)"),
                    }}>
                    {/* Toggle feed */}
                    <button onClick={() => toggleFeed(feed.token)}
                      className="w-4 h-4 rounded-sm flex items-center justify-center shrink-0 transition-all"
                      style={{
                        background: isSelected ? "var(--accent)" : "transparent",
                        border: "1.5px solid " + (isSelected ? "var(--accent)" : "var(--t3)"),
                      }}>
                      {isSelected && <span className="text-[9px] text-white font-bold">&#10003;</span>}
                    </button>

                    {/* Token info */}
                    <div className="flex-1 min-w-0">
                      <span className="text-[12px] font-semibold" style={{ color: isSelected ? "var(--t0)" : "var(--t2)" }}>{feed.token}</span>
                      <span className="mono text-[9px] ml-2" style={{ color: "var(--t3)" }}>{feed.oraclePair}</span>
                    </div>

                    {/* Pin to chart */}
                    <button onClick={() => { if (!isSelected) toggleFeed(feed.token); toggleChart(feed.token); }}
                      className="px-1.5 py-0.5 rounded text-[8px] mono uppercase font-bold transition-all shrink-0"
                      style={{
                        background: isCharted ? "var(--accent)" : "transparent",
                        color: isCharted ? "#fff" : "var(--t3)",
                        border: "1px solid " + (isCharted ? "var(--accent)" : "var(--border)"),
                        opacity: !isCharted && chartFeeds.length >= MAX_CHARTS ? 0.3 : 1,
                      }}
                      disabled={!isCharted && chartFeeds.length >= MAX_CHARTS}>
                      {isCharted ? "Charted" : "Chart"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--border)", background: "var(--surface-2)" }}>
          <span className="text-[10px]" style={{ color: "var(--t3)" }}>Powered by Supra DORA Oracle</span>
          <div className="flex items-center gap-2">
            <button onClick={() => { onUpdateFeeds(["ETH", "SUPRA", "AAVE", "LINK", "USDC", "USDT"]); onUpdateCharts([]); }}
              className="text-[10px] hover:underline" style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>
              Reset defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
