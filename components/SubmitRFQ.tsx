"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useWallet } from "./WalletProvider";
import OraclePrice from "./OraclePrice";

const COIN_LOGOS: Record<string, string> = {
  ETH: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
  SUPRA: "https://supra.com/images/brand/Supra-Red-Dark-Symbol.png",
  AAVE: "https://assets.coingecko.com/coins/images/12645/small/AAVE.png",
  LINK: "https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png",
  USDC: "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
  USDT: "https://assets.coingecko.com/coins/images/325/small/Tether.png",
};

const CHAINS: Record<string, { name: string; tokens: string[] }> = {
  sepolia: { name: "Sepolia", tokens: ["ETH", "AAVE", "LINK", "USDC", "USDT"] },
  "supra-testnet": { name: "Supra Testnet", tokens: ["SUPRA"] },
};

// Map display tokens to internal pair format
function toInternal(token: string): string {
  const map: Record<string, string> = {
    AAVE: "fxAAVE", LINK: "fxLINK", USDC: "fxUSDC", USDT: "fxUSDT",
  };
  return map[token] || token;
}

function buildPair(sellToken: string, buyToken: string): string {
  return toInternal(sellToken) + "/" + toInternal(buyToken);
}

// Map internal pair to oracle pair format
function toOraclePair(sellToken: string, buyToken: string): string {
  return toInternal(sellToken) + "/" + toInternal(buyToken);
}

function CoinIcon({ token, size = 18 }: { token: string; size?: number }) {
  const src = COIN_LOGOS[token];
  if (!src) return null;
  return <img src={src} alt={token} width={size} height={size} className="rounded-full" style={{ minWidth: size, minHeight: size }} />;
}

function ChainTokenSelector({
  label,
  chain,
  token,
  onChainChange,
  onTokenChange,
  excludeChain,
  excludeToken,
}: {
  label: string;
  chain: string;
  token: string;
  onChainChange: (c: string) => void;
  onTokenChange: (t: string) => void;
  excludeChain?: string;
  excludeToken?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <label className="block mono text-[11px] uppercase tracking-wider mb-1.5 font-medium" style={{ color: "var(--t3)" }}>{label}</label>
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 rounded-md transition-colors w-full"
        style={{ background: "var(--bg-raised)", border: open ? "1px solid var(--border-active)" : "1px solid var(--border)", height: 46 }}>
        <CoinIcon token={token} size={18} />
        <div className="flex flex-col items-start">
          <span className="mono text-[13px] font-semibold leading-tight" style={{ color: "var(--t0)" }}>{token}</span>
          <span className="mono text-[10px] leading-tight" style={{ color: "var(--t3)" }}>{CHAINS[chain]?.name}</span>
        </div>
        <span className="text-[10px] ml-auto" style={{ color: "var(--t3)" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 rounded-md overflow-hidden z-[100] animate-slide-down"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", minWidth: 200 }}>
          <div className="max-h-[300px] overflow-y-auto">
            {Object.entries(CHAINS).map(([chainId, chainData]) => (
              <div key={chainId}>
                <div className="px-3 py-1.5 mono text-[10px] uppercase tracking-wider font-semibold sticky top-0"
                  style={{ color: "var(--t3)", background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                  {chainData.name}
                </div>
                {chainData.tokens.map(t => {
                  const isActive = t === token && chainId === chain;
                  const isSameAsCross = chainId === excludeChain && t === excludeToken;
                  if (isSameAsCross) return null;
                  return (
                    <button key={chainId + t} onClick={() => { onChainChange(chainId); onTokenChange(t); setOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/[0.03]"
                      style={{ background: isActive ? "var(--accent-dim)" : "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                      <CoinIcon token={t} size={16} />
                      <span className="mono text-[13px] font-medium" style={{ color: "var(--t0)" }}>{t}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SubmitRFQ({ onSubmitted }: { onSubmitted?: () => void }) {
  const { supraAddress } = useWallet();
  const [sellChain, setSellChain] = useState("sepolia");
  const [sellToken, setSellToken] = useState("ETH");
  const [buyChain, setBuyChain] = useState("supra-testnet");
  const [buyToken, setBuyToken] = useState("SUPRA");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [oracleRate, setOracleRate] = useState<number | null>(null);
  const [priceEdited, setPriceEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const pair = buildPair(sellToken, buyToken);
  const isCrossChain = sellChain !== buyChain;

  // Fetch oracle rate for autofill
  const fetchRate = useCallback(async () => {
    try {
      const res = await fetch("/api/oracle?pair=" + encodeURIComponent(pair));
      if (!res.ok) return;
      const d = await res.json();
      if (d.conversionRate) {
        setOracleRate(d.conversionRate);
        if (!priceEdited) {
          setPrice(formatPrice(d.conversionRate));
        }
      }
    } catch {}
  }, [pair, priceEdited]);

  useEffect(() => {
    setPriceEdited(false);
    setPrice("");
    setOracleRate(null);
    fetchRate();
  }, [sellToken, buyToken]);

  useEffect(() => {
    const iv = setInterval(fetchRate, 3000);
    return () => clearInterval(iv);
  }, [fetchRate]);

  function formatPrice(n: number): string {
    if (n >= 1000) return n.toFixed(2);
    if (n >= 1) return n.toFixed(4);
    return n.toFixed(6);
  }

  const parsedAmount = parseFloat(amount) || 0;
  const parsedPrice = parseFloat(price) || 0;
  const receiveAmount = parsedAmount * parsedPrice;

  const submit = async () => {
    if (!supraAddress || parsedAmount <= 0 || parsedPrice <= 0) return;
    setLoading(true); setResult(null);
    try {
      const res = await fetch("/api/skill/suprafx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_rfq",
          agentAddress: supraAddress,
          pair,
          size: amount,
          quotedPrice: price,
        }),
      });
      const data = await res.json();
      if (data.error) { setResult({ ok: false, msg: data.error }); }
      else {
        setResult({ ok: true, msg: (data.rfq?.displayId || "RFQ") + " created" });
        setAmount("");
        setPriceEdited(false);
        onSubmitted?.();
      }
    } catch (e: any) { setResult({ ok: false, msg: e.message }); }
    setLoading(false);
  };

  return (
    <div className="mb-5 animate-in relative" style={{ background: "var(--surface)", border: "1px solid rgba(37,99,235,0.4)", borderRadius: "var(--radius)", zIndex: 30, boxShadow: "0 0 20px rgba(37,99,235,0.15), 0 0 40px rgba(37,99,235,0.05)" }}>
      <div className="card-header">
        <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>New RFQ</span>
        <div className="flex items-center gap-3">
          {isCrossChain && <span className="tag" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>cross-chain</span>}
          <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>{CHAINS[sellChain]?.name} → {CHAINS[buyChain]?.name}</span>
        </div>
      </div>
      <div className="px-4 py-4" style={{ position: "relative", zIndex: 10 }}>
        {/* Single row: Selling | Amount | arrow | Buying | Price | Receive | Submit */}
        <div className="flex items-start gap-3 flex-wrap justify-center">
          {/* Selling */}
          <div style={{ width: 150 }}>
            <ChainTokenSelector label="Selling" chain={sellChain} token={sellToken}
              onChainChange={setSellChain} onTokenChange={setSellToken}
              excludeChain={buyChain} excludeToken={buyToken} />
          </div>

          {/* Amount */}
          <div style={{ width: 120 }}>
            <label className="block mono text-[11px] uppercase tracking-wider mb-1.5 font-medium" style={{ color: "var(--t3)" }}>Amount</label>
            <input type="number" step="0.01" min="0" placeholder="0.00" value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full px-3 rounded-md mono text-[14px] outline-none"
              style={{ background: "var(--bg-raised)", color: "var(--t0)", border: "1px solid var(--border)", height: 46 }} />
          </div>

          {/* Arrow */}
          <div style={{ paddingTop: 22 }}>
            <div className="flex items-center" style={{ color: "var(--t3)", height: 46 }}>
              <span className="text-[16px]">→</span>
            </div>
          </div>

          {/* Buying */}
          <div style={{ width: 150 }}>
            <ChainTokenSelector label="Buying" chain={buyChain} token={buyToken}
              onChainChange={setBuyChain} onTokenChange={setBuyToken}
              excludeChain={sellChain} excludeToken={sellToken} />
          </div>

          {/* Your Price */}
          <div style={{ width: 160 }}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="mono text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>Price</label>
              {oracleRate && priceEdited && (
                <button onClick={() => { setPrice(formatPrice(oracleRate)); setPriceEdited(false); }}
                  className="mono text-[9px] hover:underline"
                  style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  reset
                </button>
              )}
            </div>
            <div className="flex items-center rounded-md overflow-hidden" style={{ border: "1px solid var(--border)", height: 46 }}>
              <input type="number" step="any" min="0" placeholder="0.00" value={price}
                onChange={e => { setPrice(e.target.value); setPriceEdited(true); }}
                className="flex-1 px-3 mono text-[14px] outline-none h-full" style={{ minWidth: 0, background: "var(--bg-raised)", color: "var(--t0)", border: "none" }} />
              <div className="px-2 flex items-center" style={{ background: "var(--surface-2)", borderLeft: "1px solid var(--border)", height: "100%" }}>
                <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>/{sellToken}</span>
              </div>
            </div>
          </div>

          {/* You Receive */}
          <div style={{ width: 160 }}>
            <label className="block mono text-[11px] uppercase tracking-wider mb-1.5 font-medium" style={{ color: "var(--t3)" }}>You Receive</label>
            <div className="flex items-center rounded-md px-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", height: 46 }}>
              <span className="mono text-[14px] font-semibold flex-1" style={{ color: receiveAmount > 0 ? "var(--positive)" : "var(--t3)" }}>
                {receiveAmount > 0 ? (receiveAmount >= 1000 ? receiveAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : receiveAmount.toFixed(4)) : "—"}
              </span>
              <div className="flex items-center gap-1 ml-2">
                <CoinIcon token={buyToken} size={14} />
                <span className="mono text-[11px]" style={{ color: "var(--t2)" }}>{buyToken}</span>
              </div>
            </div>
          </div>

          {/* Submit */}
          <div>
            <label className="block mono text-[11px] uppercase tracking-wider mb-1.5 font-medium" style={{ color: "transparent" }}>.</label>
            <button onClick={submit} disabled={loading || parsedAmount <= 0 || parsedPrice <= 0}
              className="px-5 rounded-md text-[13px] font-semibold transition-all disabled:opacity-30 hover:brightness-110 whitespace-nowrap"
              style={{ background: "var(--accent)", color: "#fff", border: "none", height: 46 }}>
              {loading ? "..." : "Submit RFQ"}
            </button>
          </div>
        </div>

        {result && (
          <div className="flex items-center gap-2 mt-3 animate-slide-down justify-center">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: result.ok ? "var(--positive)" : "var(--negative)" }} />
            <span className="mono text-[13px]" style={{ color: result.ok ? "var(--positive)" : "var(--negative)" }}>{result.msg}</span>
          </div>
        )}
      </div>
      <OraclePrice pair={pair} />
    </div>
  );
}
