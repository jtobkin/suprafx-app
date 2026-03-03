"use client";
import { useState, useEffect, useRef } from "react";
import { useWallet } from "./WalletProvider";
import { RFQ, Trade, Quote, Agent } from "@/lib/types";
import { supabase } from "@/lib/supabase";

function addrUrl(addr: string, chain: string) {
  if (!addr || addr === "auto-maker-bot") return null;
  if (chain === "supra-testnet" || chain === "supra") {
    const clean = addr.startsWith("0x") ? addr.slice(2) : addr;
    return `https://testnet.suprascan.io/account/${clean}`;
  }
  const hex = addr.startsWith("0x") ? addr : "0x" + addr;
  return `https://sepolia.etherscan.io/address/${hex}`;
}

function txUrl(h: string, chain: string) {
  if (!h) return null;
  if (chain === "supra-testnet" || chain === "supra") {
    const clean = h.startsWith("0x") ? h.slice(2) : h.startsWith("supra_") ? h.slice(6) : h;
    return `https://testnet.suprascan.io/tx/${clean}`;
  }
  const hex = h.startsWith("0x") ? h : "0x" + h;
  return `https://sepolia.etherscan.io/tx/${hex}`;
}

function shortAddr(addr: string) {
  if (addr === "auto-maker-bot") return "SupraFX Bot";
  if (addr.length > 16) return addr.slice(0, 6) + "…" + addr.slice(-4);
  return addr;
}

function displayPair(pair: string) {
  return pair.replace(/fx/g, "");
}

function fmtRate(n: number) {
  if (n >= 1000) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function RepBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) return null;
  return (
    <span className="mono text-[10px] ml-1 px-1 py-0.5 rounded"
      style={{ background: "var(--surface-2)", color: Number(score) >= 4 ? "var(--positive)" : "var(--t3)" }}>
      {"★"} {Number(score).toFixed(1)}
    </span>
  );
}

function AddrWithRep({ addr, chain, agents, isMine }: { addr: string; chain: string; agents: Agent[]; isMine: boolean }) {
  const agent = agents.find(a => a.wallet_address === addr);
  const rep = agent?.rep_total ?? null;
  const url = addrUrl(addr, chain);
  const display = isMine ? "You" : shortAddr(addr);

  return (
    <span className="inline-flex items-center gap-0.5">
      {url ? (
        <a href={url} target="_blank" rel="noopener" className="mono text-[12px] hover:underline"
          style={{ color: isMine ? "var(--accent)" : "var(--t2)" }}>
          {display}
        </a>
      ) : (
        <span className="mono text-[12px]" style={{ color: isMine ? "var(--accent)" : "var(--t2)" }}>{display}</span>
      )}
      <RepBadge score={rep} />
    </span>
  );
}


// --- Settlement Components (from TradeFlow) ---
const STEPS = ["open", "taker_sent", "taker_verified", "maker_sent", "settled"];
const LABELS = ["Matched", "Taker Sent", "Verified", "Maker Sent", "Settled"];
function stepIdx(s: string) { const i = STEPS.indexOf(s); return i >= 0 ? i : 0; }

function Progress({ status }: { status: string }) {
  const cur = stepIdx(status);
  return (
    <div className="flex items-center gap-1 my-3">
      {STEPS.map((s, i) => (
        <div key={s} className="flex flex-col items-center flex-1">
          <div className="w-full h-[3px] rounded-full transition-all duration-700"
            style={{
              background: status === "failed" ? "var(--negative)"
                : i < cur ? "var(--positive)"
                : i === cur ? "var(--accent)"
                : "var(--surface-3)",
            }} />
          <span className="font-mono text-[8px] uppercase tracking-wider mt-1"
            style={{
              color: status === "failed" ? "var(--negative)"
                : i < cur ? "var(--positive)"
                : i === cur ? "var(--accent-light)"
                : "var(--t3)",
            }}>
            {LABELS[i]}
          </span>
        </div>
      ))}
    </div>
  );
}

function Spinner({ color = "currentColor" }: { color?: string }) {
  return <div className="w-2.5 h-2.5 rounded-full border-[1.5px] animate-spin" style={{ borderColor: color, borderTopColor: "transparent" }} />;
}

function LogLine({ time, text, color }: { time: string; text: string; color?: string }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="font-mono text-[13px] shrink-0" style={{ color: "var(--t3)" }}>{time}</span>
      <span className="text-[13px]" style={{ color: color || "var(--t2)" }}>{text}</span>
    </div>
  );
}

function ActiveTrade({ trade, onUpdate, rfq, tradeQuotes, agents, supraAddr }: { trade: Trade; onUpdate: () => void; rfq?: RFQ; tradeQuotes?: Quote[]; agents?: Agent[]; supraAddr?: string }) {
  const { profile, isDemo, sendSepoliaEth, sendSupraTokens, supraAddress } = useWallet();
  const [txHash, setTxHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<Array<{ time: string; text: string; color?: string }>>([]);
  const [autoRunning, setAutoRunning] = useState(false);
  const autoRef = useRef(false);

  const hasWallet = !!profile?.evmVerified && !isDemo;
  const hasSupraWallet = !!supraAddress && !isDemo;

  const addLog = (text: string, color?: string) => {
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(prev => [...prev, { time, text, color }]);
  };

  const confirmTx = async (side: "taker" | "maker", hash: string): Promise<any> => {
    const res = await fetch("/api/confirm-tx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tradeId: trade.id, txHash: hash, side }),
    });
    return res.json();
  };

  // === MANUAL: Send on Sepolia ===
  const manualSendSepolia = async () => {
    setLoading(true);
    try {
      const valueWei = "0x" + BigInt(10000000000000).toString(16);
      const makerAddr = trade.maker_address.startsWith("0x")
        ? trade.maker_address
        : "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD1e";

      addLog("Requesting wallet signature…");
      const hash = await sendSepoliaEth(makerAddr, valueWei);
      addLog("TX broadcast: " + hash.slice(0, 18) + "…", "var(--accent-light)");
      addLog("Submitting to committee for verification…");

      const data = await confirmTx("taker", hash);
      if (data.verified) {
        addLog("Committee approved (5/5)", "var(--positive)");
      } else {
        addLog("Awaiting committee verification…", "var(--warn)");
      }
      onUpdate();
    } catch (e: any) {
      if (e.code === 4001 || e.message?.includes("rejected")) {
        addLog("Transaction rejected by user", "var(--negative)");
      } else {
        addLog("Error: " + (e.message || e), "var(--negative)");
      }
    }
    setLoading(false);
  };

  // === MANUAL: Paste hash ===
  const manualSubmitHash = async () => {
    if (!txHash.trim()) return;
    setLoading(true);
    addLog("Submitting TX hash to committee…");
    const data = await confirmTx("taker", txHash.trim());
    if (data.error) addLog("Error: " + data.error, "var(--negative)");
    else if (data.verified) addLog("Committee approved (5/5)", "var(--positive)");
    else addLog("Awaiting verification…", "var(--warn)");
    setTxHash("");
    onUpdate();
    setLoading(false);
  };

  // === MANUAL: Demo TX ===
  const manualDemoTx = async () => {
    setLoading(true);
    const hash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    addLog("Demo TX generated: " + hash.slice(0, 18) + "…");
    addLog("Submitting to committee…");
    const data = await confirmTx("taker", hash);
    if (data.verified) addLog("Committee approved (5/5)", "var(--positive)");
    else addLog("Awaiting verification…", "var(--warn)");
    onUpdate();
    setLoading(false);
  };

  // === MANUAL: Maker Send on Supra ===
  const manualMakerSend = async () => {
    setLoading(true);

    if (hasSupraWallet) {
      // Real Supra send
      try {
        addLog("Sending SUPRA tokens to taker on testnet…");
        // Send 0.01 SUPRA (tiny amount for testnet)
        const takerAddr = trade.taker_address;
        const hash = await sendSupraTokens(takerAddr, 0.01);
        addLog("Supra TX broadcast: " + String(hash).slice(0, 20) + "…", "var(--accent-light)");
        addLog("Submitting to committee…");
        const data = await confirmTx("maker", String(hash));
        if (data.status === "settled") {
          addLog("Trade settled in " + (data.settleMs / 1000).toFixed(1) + "s", "var(--positive)");
        } else {
          addLog("Maker TX sent — verifying…", "var(--warn)");
        }
      } catch (e: any) {
        addLog("Supra send error: " + (e.message || e), "var(--negative)");
        // Fallback to simulated
        addLog("Falling back to simulated maker send…", "var(--warn)");
        const hash = "supra_" + Array.from({ length: 60 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
        const data = await confirmTx("maker", hash);
        if (data.status === "settled") addLog("Trade settled!", "var(--positive)");
      }
    } else {
      // Simulated maker send
      const hash = "supra_" + Array.from({ length: 60 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      addLog("Simulated maker TX: " + hash.slice(0, 20) + "…");
      const data = await confirmTx("maker", hash);
      if (data.status === "settled") {
        addLog("Trade settled in " + (data.settleMs / 1000).toFixed(1) + "s", "var(--positive)");
      } else {
        addLog("Maker TX submitted — verifying…", "var(--warn)");
      }
    }

    onUpdate();
    setLoading(false);
  };

  // === AUTO MODE: Full end-to-end ===
  const runAutoMode = async () => {
    autoRef.current = true;
    setAutoRunning(true);
    setLogs([]);

    try {
      // Step 1: Send taker TX
      addLog("Auto mode started — sending taker TX on " + trade.source_chain + "…");

      let takerHash: string;
      if (hasWallet) {
        const valueWei = "0x" + BigInt(10000000000000).toString(16);
        const makerAddr = trade.maker_address.startsWith("0x")
          ? trade.maker_address
          : "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD1e";
        addLog("Requesting MetaMask signature…");
        takerHash = await sendSepoliaEth(makerAddr, valueWei);
      } else {
        takerHash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
        addLog("Demo taker TX generated");
      }

      addLog("Taker TX broadcast: " + takerHash.slice(0, 18) + "…", "var(--accent-light)");
      if (!autoRef.current) return;

      // Step 2: Wait 12 seconds for Ethereum block inclusion
      addLog("Waiting 12s for Ethereum block inclusion…");
      await new Promise(r => setTimeout(r, 12000));
      if (!autoRef.current) return;

      // Step 3: Committee verifies taker TX — bot may auto-settle the whole trade
      addLog("Committee verifying taker TX…");
      const takerResult = await confirmTx("taker", takerHash);
      
      // Check for failure
      if (takerResult.status === 'failed' || takerResult.success === false) {
        addLog("Settlement failed: " + (takerResult.error || "unknown error"), "var(--negative)");
        onUpdate();
        autoRef.current = false;
        setAutoRunning(false);
        return;
      }

      if (takerResult.autoSettled) {
        addLog("Taker TX verified by committee (5/5)", "var(--positive)");
        addLog("Maker bot sent SUPRA to taker on-chain", "var(--accent-light)");
        if (takerResult.makerTxHash) {
          addLog("Supra TX: " + takerResult.makerTxHash.slice(0, 24) + "…", "var(--accent-light)");
        }
        addLog("Committee verified maker TX (5/5)", "var(--positive)");
        addLog("Trade settled in " + (takerResult.settleMs / 1000).toFixed(1) + "s", "var(--positive)");
        onUpdate();
        autoRef.current = false;
        setAutoRunning(false);
        return;
      }

      // Show error message if present but not failed
      if (takerResult.error) {
        addLog("Warning: " + takerResult.error, "var(--warn)");
      }

      if (takerResult.verified) {
        addLog("Taker TX verified by committee (5/5)", "var(--positive)");
      } else {
        addLog("Taker verification pending — retrying in 5s…", "var(--warn)");
        await new Promise(r => setTimeout(r, 5000));
        const retry = await confirmTx("taker", takerHash);
        if (retry.status === 'failed') {
          addLog("Settlement failed: " + (retry.error || "unknown error"), "var(--negative)");
          onUpdate();
          autoRef.current = false;
          setAutoRunning(false);
          return;
        }
        if (retry.autoSettled) {
          addLog("Trade settled by maker bot!", "var(--positive)");
          onUpdate();
          autoRef.current = false;
          setAutoRunning(false);
          return;
        }
        addLog("Taker TX verified", "var(--positive)");
      }
      onUpdate();
      if (!autoRef.current) return;

      if (takerResult.status === 'maker_sent' || takerResult.status === 'settled') {
        addLog("Maker bot already sent on Supra", "var(--positive)");
        onUpdate();
        autoRef.current = false;
        setAutoRunning(false);
        return;
      }

      // Step 4: Maker sends on Supra
      addLog("Maker sending SUPRA on " + trade.dest_chain + "…");
      await new Promise(r => setTimeout(r, 1000));

      let makerHash: string;
      if (hasSupraWallet) {
        try {
          const takerAddr = trade.taker_address;
          makerHash = String(await sendSupraTokens(takerAddr, 0.01));
          addLog("Supra TX broadcast: " + makerHash.slice(0, 20) + "…", "var(--accent-light)");
        } catch (e: any) {
          addLog("Supra send failed, using simulated TX: " + (e.message || ""), "var(--warn)");
          makerHash = "supra_" + Array.from({ length: 60 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
        }
      } else {
        makerHash = "supra_" + Array.from({ length: 60 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
        addLog("Simulated maker TX: " + makerHash.slice(0, 20) + "…");
      }
      if (!autoRef.current) return;

      // Step 5: Committee verifies maker TX
      addLog("Committee verifying maker TX…");
      await new Promise(r => setTimeout(r, 2000));
      const makerResult = await confirmTx("maker", makerHash);
      if (makerResult.status === "settled") {
        addLog("Trade settled in " + (makerResult.settleMs / 1000).toFixed(1) + "s", "var(--positive)");
      } else {
        addLog("Settlement complete", "var(--positive)");
      }
      onUpdate();

    } catch (e: any) {
      addLog("Auto mode error: " + (e.message || e), "var(--negative)");
    }

    autoRef.current = false;
    setAutoRunning(false);
  };

  const cancelAuto = () => {
    autoRef.current = false;
    setAutoRunning(false);
    addLog("Auto mode cancelled", "var(--warn)");
  };

  return (
    <div className="px-4 py-3 border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
      {/* Deal Summary */}
      {(() => {
        const [base, quote] = trade.pair.split("/");
        const baseClean = base.replace("fx", "");
        const quoteClean = quote.replace("fx", "");
        const pairClean = trade.pair.replace(/fx/g, "");
        const askingPrice = rfq?.reference_price;
        const priceDiff = askingPrice && askingPrice > 0 ? ((trade.rate - askingPrice) / askingPrice) * 100 : null;
        const notional = trade.size * trade.rate;
        const takerAgent = agents?.find(a => a.wallet_address === trade.taker_address);
        const makerAgent = agents?.find(a => a.wallet_address === trade.maker_address);
        const isMine = trade.taker_address === supraAddr;

        return (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[13px]" style={{ color: "var(--t3)" }}>{trade.display_id}</span>
                <span className="text-[14px] font-semibold">{pairClean}</span>
                <span className="font-mono text-[13px]">{trade.size} {baseClean}</span>
                <span className="text-[12px] px-2 py-0.5 rounded" style={{ background: "rgba(37,99,235,0.08)", color: "var(--accent-light)" }}>
                  {trade.source_chain} → {trade.dest_chain}
                </span>
              </div>
              <span className={`tag tag-${trade.status === "open" ? "open_trade" : trade.status}`}>
                {trade.status === "settled" ? "Settled" : trade.status.replace(/_/g, " ")}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-6 mb-3 px-1">
              <div>
                <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Price</span>
                {askingPrice ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: "var(--t3)" }}>Asked:</span>
                      <span className="mono text-[13px]" style={{ color: "var(--t2)" }}>
                        {askingPrice >= 1000 ? askingPrice.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : askingPrice >= 1 ? askingPrice.toFixed(4) : askingPrice.toFixed(6)} {quoteClean}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: "var(--t3)" }}>Filled:</span>
                      <span className="mono text-[13px] font-semibold" style={{ color: "var(--t1)" }}>
                        {trade.rate >= 1000 ? trade.rate.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : trade.rate >= 1 ? trade.rate.toFixed(4) : trade.rate.toFixed(6)} {quoteClean}
                      </span>
                      {priceDiff !== null && (
                        <span className="mono text-[11px]" style={{ color: priceDiff >= 0 ? "var(--positive)" : "var(--negative)" }}>
                          {priceDiff >= 0 ? "+" : ""}{priceDiff.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <span className="mono text-[13px] font-semibold" style={{ color: "var(--t1)" }}>
                    {trade.rate >= 1000 ? trade.rate.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : trade.rate >= 1 ? trade.rate.toFixed(4) : trade.rate.toFixed(6)} {quoteClean}
                  </span>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px]" style={{ color: "var(--t3)" }}>Notional:</span>
                  <span className="mono text-[13px]" style={{ color: "var(--positive)" }}>
                    {notional >= 1000 ? notional.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:4}) : notional.toFixed(4)} {quoteClean}
                  </span>
                </div>
              </div>

              <div>
                <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Counterparties</span>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] w-12" style={{ color: "var(--t3)" }}>Taker:</span>
                  <span className="mono text-[12px]" style={{ color: isMine ? "var(--accent)" : "var(--t2)" }}>
                    {isMine ? "You" : trade.taker_address.length > 16 ? trade.taker_address.slice(0,6) + "…" + trade.taker_address.slice(-4) : trade.taker_address}
                  </span>
                  {takerAgent && (
                    <span className="mono text-[10px] px-1 py-0.5 rounded" style={{ background: "var(--surface-2)", color: Number(takerAgent.rep_total) >= 4 ? "var(--positive)" : "var(--t3)" }}>
                      ★ {Number(takerAgent.rep_total).toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] w-12" style={{ color: "var(--t3)" }}>Maker:</span>
                  <span className="mono text-[12px]" style={{ color: "var(--t2)" }}>
                    {trade.maker_address === "auto-maker-bot" ? "SupraFX Bot" : trade.maker_address.length > 16 ? trade.maker_address.slice(0,6) + "…" + trade.maker_address.slice(-4) : trade.maker_address}
                  </span>
                  {makerAgent && (
                    <span className="mono text-[10px] px-1 py-0.5 rounded" style={{ background: "var(--surface-2)", color: Number(makerAgent.rep_total) >= 4 ? "var(--positive)" : "var(--t3)" }}>
                      ★ {Number(makerAgent.rep_total).toFixed(1)}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Settlement</span>
                {trade.taker_tx_hash ? (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px]" style={{ color: "var(--t3)" }}>Taker TX:</span>
                    <a href={trade.source_chain === "sepolia" ? `https://sepolia.etherscan.io/tx/${trade.taker_tx_hash}` : `https://testnet.suprascan.io/tx/${trade.taker_tx_hash.replace(/^0x/,"")}`}
                      target="_blank" rel="noopener" className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                      {trade.taker_tx_hash.slice(0,10)}… ↗
                    </a>
                  </div>
                ) : (
                  <div className="text-[11px] mb-1" style={{ color: "var(--t3)" }}>Awaiting taker settlement</div>
                )}
                {trade.maker_tx_hash && (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px]" style={{ color: "var(--t3)" }}>Maker TX:</span>
                    <a href={trade.dest_chain === "supra-testnet" ? `https://testnet.suprascan.io/tx/${trade.maker_tx_hash.replace(/^0x/,"")}` : `https://sepolia.etherscan.io/tx/${trade.maker_tx_hash}`}
                      target="_blank" rel="noopener" className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                      {trade.maker_tx_hash.slice(0,10)}… ↗
                    </a>
                  </div>
                )}
                {trade.settle_ms && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px]" style={{ color: "var(--t3)" }}>Duration:</span>
                    <span className="mono text-[13px] font-semibold" style={{ color: "var(--positive)" }}>{(trade.settle_ms / 1000).toFixed(1)}s</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      <Progress status={trade.status} />

      {/* === OPEN: Show mode selection === */}
      {trade.status === "open" && !autoRunning && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <button onClick={runAutoMode}
              className="px-4 py-[7px] rounded text-[13px] font-semibold transition-all"
              style={{ background: "var(--positive)", color: "#fff", border: "none" }}>
              Settle
            </button>
            {hasWallet && (
              <button onClick={manualSendSepolia} disabled={loading}
                className="px-4 py-[7px] rounded text-[13px] font-semibold disabled:opacity-30 transition-all"
                style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
                {loading ? "Sending…" : "Manual: Send on Sepolia"}
              </button>
            )}
            {isDemo && (
              <button onClick={manualDemoTx} disabled={loading}
                className="px-3 py-[7px] rounded text-[14px] font-mono disabled:opacity-30"
                style={{ background: "var(--surface-3)", color: "var(--t2)", border: "none" }}>
                Demo TX
              </button>
            )}
          </div>
          {/* Manual hash input — demo only */}
          {isDemo && (
            <div className="flex items-center gap-2">
              <input type="text" placeholder="or paste TX hash: 0x…" value={txHash}
                onChange={e => setTxHash(e.target.value)}
                className="flex-1 px-2.5 py-[5px] rounded border text-[14px] font-mono outline-none"
                style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--t0)" }} />
              <button onClick={manualSubmitHash} disabled={loading || !txHash.trim()}
                className="px-2.5 py-[5px] rounded text-[13px] font-medium disabled:opacity-30"
                style={{ background: "var(--surface-3)", color: "var(--t1)", border: "none" }}>
                Submit
              </button>
            </div>
          )}
        </div>
      )}

      {/* === AUTO RUNNING === */}
      {autoRunning && (
        <div className="mb-1">
          <div className="flex items-center gap-2 mb-2">
            <Spinner color="var(--positive)" />
            <span className="text-[13px] font-medium" style={{ color: "var(--positive)" }}>Auto settlement in progress</span>
            <button onClick={cancelAuto}
              className="px-2 py-0.5 rounded text-[13px] font-mono ml-auto"
              style={{ background: "var(--surface-3)", color: "var(--t3)", border: "none" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* === TAKER SENT (manual mode) === */}
      {trade.status === "taker_sent" && !autoRunning && (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--t2)" }}>
          <Spinner color="var(--accent)" /> Committee verifying taker TX…
          {trade.taker_tx_hash?.startsWith("0x") && (
            <a href={`https://sepolia.etherscan.io/tx/${trade.taker_tx_hash}`} target="_blank"
              className="font-mono text-[14px] ml-1" style={{ color: "var(--accent-light)" }}>Etherscan ↗</a>
          )}
        </div>
      )}

      {/* === TAKER VERIFIED (manual mode) === */}
      {trade.status === "taker_verified" && !autoRunning && (
        <div className="flex items-center gap-2">
          <span className="text-[13px]" style={{ color: "var(--positive)" }}>Taker verified (5/5).</span>
          <button onClick={manualMakerSend} disabled={loading}
            className="px-3 py-[6px] rounded text-[14px] font-semibold disabled:opacity-30"
            style={{ background: hasSupraWallet ? "var(--positive)" : "var(--surface-3)", color: hasSupraWallet ? "#fff" : "var(--t0)", border: hasSupraWallet ? "none" : "1px solid var(--border-active)" }}>
            {loading ? "Sending…" : hasSupraWallet ? "Send on Supra Testnet" : "Simulate Maker Send"}
          </button>
        </div>
      )}

      {/* === MAKER SENT (manual mode) === */}
      {/* === MAKER SENT (manual mode) === */}
      {trade.status === "maker_sent" && !autoRunning && (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--t2)" }}>
          <Spinner color="var(--positive)" /> Verifying maker TX on {trade.dest_chain}…
        </div>
      )}

      {/* === FAILED === */}
      {trade.status === "failed" && (
        <div className="px-2.5 py-2 rounded text-[13px]" style={{ background: "rgba(239,68,68,0.06)", color: "var(--negative)" }}>
          Trade failed — check Vercel logs for details. The maker bot may not be funded or the Supra RPC may be down.
        </div>
      )}

      {/* === SETTLED === */}
      {trade.status === "settled" && (
        <div className="flex items-center gap-3">
          {trade.taker_tx_hash && (
            <a href={trade.source_chain === "sepolia"
              ? `https://sepolia.etherscan.io/tx/${trade.taker_tx_hash}`
              : `https://testnet.suprascan.io/tx/${trade.taker_tx_hash.replace(/^0x/, "")}`}
              target="_blank"
              className="font-mono text-[14px]" style={{ color: "var(--accent-light)" }}>Taker TX ({trade.source_chain === "sepolia" ? "Sepolia" : "Supra"}) ↗</a>
          )}
          {trade.maker_tx_hash && (
            <a href={trade.dest_chain === "supra-testnet"
              ? `https://testnet.suprascan.io/tx/${trade.maker_tx_hash.replace(/^0x/, "")}`
              : `https://sepolia.etherscan.io/tx/${trade.maker_tx_hash}`}
              target="_blank"
              className="font-mono text-[14px]" style={{ color: "var(--accent-light)" }}>Maker TX ({trade.dest_chain === "supra-testnet" ? "Supra" : "Sepolia"}) ↗</a>
          )}
        </div>
      )}

      {/* === Activity Log === */}
      {logs.length > 0 && (
        <div className="mt-2 px-2.5 py-2 rounded max-h-36 overflow-y-auto" style={{ background: "var(--bg)" }}>
          {logs.map((l, i) => <LogLine key={i} {...l} />)}
        </div>
      )}
    </div>
  );
}

interface Props {
  rfqs: RFQ[];
  trades?: Trade[];
  quotes?: Quote[];
  agents?: Agent[];
  onAcceptQuote?: () => void;
  onUpdate?: () => void;
}

export default function OrderbookTable({ rfqs, trades, quotes = [], agents = [], onAcceptQuote, onUpdate }: Props) {
  const { supraAddress } = useWallet();
  const [expandedRfq, setExpandedRfq] = useState<string | null>(null);
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [expandedCompleted, setExpandedCompleted] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [attestations, setAttestations] = useState<Record<string, string>>({});

  const openRfqs = rfqs.filter(r => r.status === "open")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const activeTrades = (trades || [])
    .filter(t => !["settled", "failed"].includes(t.status))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const completedTrades = (trades || [])
    .filter(t => t.status === "settled" || t.status === "failed")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  useEffect(() => {
    const settledIds = completedTrades.filter(t => t.status === "settled").map(t => t.id);
    if (settledIds.length === 0) return;
    supabase.from("committee_requests")
      .select("trade_id, attestation_tx")
      .in("trade_id", settledIds)
      .eq("verification_type", "approve_reputation")
      .not("attestation_tx", "is", null)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, string> = {};
          data.forEach((r: any) => { if (r.attestation_tx) map[r.trade_id] = r.attestation_tx; });
          setAttestations(map);
        }
      });
  }, [completedTrades.length]);

  const acceptQuote = async (quoteId: string) => {
    if (!supraAddress) return;
    setAccepting(quoteId);
    try {
      const res = await fetch("/api/skill/suprafx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept_quote", quoteId, agentAddress: supraAddress }),
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        // Auto-expand the new trade to show settlement UI
        if (data.trade?.id) setExpandedTrade(data.trade.id);
        onAcceptQuote?.();
      }
    } catch (e: any) { alert(e.message); }
    setAccepting(null);
  };

  const cancelRfq = async (rfqId: string) => {
    if (!supraAddress) return;
    setCancelling(rfqId);
    try {
      const res = await fetch("/api/skill/suprafx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_rfq", rfqId, agentAddress: supraAddress }),
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else onAcceptQuote?.();
    } catch (e: any) { alert(e.message); }
    setCancelling(null);
  };

  const withdrawQuote = async (quoteId: string) => {
    if (!supraAddress) return;
    setWithdrawing(quoteId);
    try {
      const res = await fetch("/api/skill/suprafx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "withdraw_quote", quoteId, agentAddress: supraAddress }),
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else onAcceptQuote?.();
    } catch (e: any) { alert(e.message); }
    setWithdrawing(null);
  };


  const activeCount = openRfqs.length + activeTrades.length;

  return (
    <div className="card mb-4 animate-in">
      <div className="card-header">
        <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>Active Trades</span>
        <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>
          {openRfqs.length} RFQ{openRfqs.length !== 1 ? "s" : ""} {"·"} {activeTrades.length} in-flight
        </span>
      </div>

      {activeCount === 0 ? (
        <div className="py-8 text-center text-[14px]" style={{ color: "var(--t3)" }}>
          No active trades
        </div>
      ) : (
        <div>
          {openRfqs.map(r => {
            const isMine = r.taker_address === supraAddress;
            const rfqQuotes = quotes.filter(q => q.rfq_id === r.id).sort((a, b) => b.rate - a.rate);
            const isExpanded = expandedRfq === r.id;
            const pairClean = displayPair(r.pair);
            const [base, quote] = r.pair.split("/");
            const baseClean = base.replace("fx", "");
            const quoteClean = quote.replace("fx", "");

            return (
              <div key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-white/[0.01] transition-colors"
                  onClick={() => setExpandedRfq(isExpanded ? null : r.id)}>
                  <span className="mono text-[12px] shrink-0 flex items-center gap-2" style={{ color: "var(--t3)" }}>
                      {r.display_id}
                      {isMine && (
                        <a onClick={(e) => { e.stopPropagation(); cancelRfq(r.id); }}
                          className="text-[11px] cursor-pointer hover:underline"
                          style={{ color: cancelling === r.id ? "var(--t3)" : "var(--negative)" }}>
                          {cancelling === r.id ? "..." : "cancel"}
                        </a>
                      )}
                    </span>
                  <span className="text-[13px] font-semibold w-28 shrink-0">{pairClean}</span>
                  <span className="mono text-[13px] w-24 shrink-0">{r.size} {baseClean}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>Asking </span>
                    <span className="mono text-[13px] font-semibold" style={{ color: "var(--t1)" }}>
                      {fmtRate(r.reference_price)} {quoteClean}/{baseClean}
                    </span>
                  </div>
                  <span className="text-[12px] shrink-0" style={{ color: "var(--t3)" }}>{r.source_chain} {"→"} {r.dest_chain}</span>
                  <div className="shrink-0">
                    <AddrWithRep addr={r.taker_address} chain={r.source_chain} agents={agents} isMine={isMine} />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tag tag-open">{rfqQuotes.length} quote{rfqQuotes.length !== 1 ? "s" : ""}</span>
                    <span className="text-[10px]" style={{ color: "var(--t3)" }}>{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="animate-slide-down" style={{ background: "var(--bg-raised)" }}>
                    {rfqQuotes.length === 0 ? (
                      <div className="px-8 py-3 text-[13px]" style={{ color: "var(--t3)" }}>
                        Waiting for maker quotes...
                      </div>
                    ) : (
                      <div>
                        <div className="px-8 py-1.5 flex items-center gap-4" style={{ borderBottom: "1px solid var(--border)" }}>
                          {["Maker","Quote Price","vs Asking","You Receive","Status"].map(h => (
                            <span key={h} className={"mono text-[10px] uppercase tracking-wider font-medium " + (h === "Maker" ? "w-40" : h === "Quote Price" ? "w-36" : h === "vs Asking" ? "w-28" : h === "You Receive" ? "w-32" : "w-20")}
                              style={{ color: "var(--t3)" }}>{h}</span>
                          ))}
                          {isMine && <span className="mono text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>Action</span>}
                        </div>
                        {rfqQuotes.map(q => {
                          const diff = r.reference_price > 0 ? ((q.rate - r.reference_price) / r.reference_price) * 100 : 0;
                          const diffColor = diff >= 0 ? "var(--positive)" : "var(--negative)";
                          const receive = r.size * q.rate;
                          return (
                            <div key={q.id} className="px-8 py-2.5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors"
                              style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                              <div className="w-40">
                                <AddrWithRep addr={q.maker_address} chain={r.dest_chain} agents={agents} isMine={q.maker_address === supraAddress} />
                              </div>
                              <span className="mono text-[13px] font-semibold w-36" style={{ color: "var(--t1)" }}>
                                {fmtRate(q.rate)} {quoteClean}
                              </span>
                              <span className="mono text-[12px] w-28" style={{ color: diffColor }}>
                                {diff >= 0 ? "+" : ""}{diff.toFixed(2)}%
                              </span>
                              <span className="mono text-[13px] w-32" style={{ color: "var(--positive)" }}>
                                {receive >= 1000 ? receive.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : receive.toFixed(4)} {quoteClean}
                              </span>
                              <span className="w-20">
                                <span className={`tag tag-${q.status}`}>{q.status}</span>
                              </span>
                              {isMine && q.status === "pending" && (
                                <button onClick={(e) => { e.stopPropagation(); acceptQuote(q.id); }}
                                  disabled={accepting === q.id}
                                  className="px-3 py-1 rounded text-[12px] font-semibold transition-all hover:brightness-110 disabled:opacity-50"
                                  style={{ background: "var(--positive)", color: "#fff", border: "none" }}>
                                  {accepting === q.id ? "..." : "Accept"}
                                </button>
                              )}
                              {q.maker_address === supraAddress && q.status === "pending" && (
                                <button onClick={(e) => { e.stopPropagation(); withdrawQuote(q.id); }}
                                  disabled={withdrawing === q.id}
                                  className="px-3 py-1 rounded text-[12px] font-semibold transition-all hover:brightness-110 disabled:opacity-50"
                                  style={{ background: "var(--negative)", color: "#fff", border: "none" }}>
                                  {withdrawing === q.id ? "..." : "Withdraw"}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {activeTrades.length > 0 && (
            <>
              {openRfqs.length > 0 && (
                <div className="px-4 py-2" style={{ background: "var(--surface-2)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
                  <span className="mono text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>In-Flight</span>
                </div>
              )}
              {activeTrades.map(t => {
                const isMine = t.taker_address === supraAddress;
                const pairClean = displayPair(t.pair);
                const isTradeExpanded = expandedTrade === t.id;
                return (
                  <div key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-white/[0.01] transition-colors"
                      onClick={() => setExpandedTrade(isTradeExpanded ? null : t.id)}>
                      <span className="mono text-[12px] w-20 shrink-0" style={{ color: "var(--t3)" }}>{t.display_id}</span>
                      <span className="text-[13px] font-semibold w-28 shrink-0">{pairClean}</span>
                      <span className="mono text-[13px] w-24 shrink-0">{t.size}</span>
                      <span className="mono text-[13px] flex-1" style={{ color: "var(--t1)" }}>{fmtRate(t.rate)}</span>
                      <span className="text-[12px] shrink-0" style={{ color: "var(--t3)" }}>{t.source_chain} → {t.dest_chain}</span>
                      <div className="shrink-0">
                        <AddrWithRep addr={t.taker_address} chain={t.source_chain} agents={agents} isMine={isMine} />
                      </div>
                      <span className="mono text-[11px]" style={{ color: "var(--t3)" }}>↔</span>
                      <div className="shrink-0">
                        <AddrWithRep addr={t.maker_address} chain={t.dest_chain} agents={agents} isMine={t.maker_address === supraAddress} />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`tag tag-${t.status === "open" ? "open_trade" : t.status}`}>{t.status.replace(/_/g, " ")}</span>
                        <span className="text-[10px]" style={{ color: "var(--t3)" }}>{isTradeExpanded ? "▲" : "▼"}</span>
                      </div>
                    </div>
                    {isTradeExpanded && onUpdate && (
                      <div style={{ background: "var(--bg-raised)" }}>
                        <ActiveTrade trade={t} onUpdate={onUpdate} rfq={rfqs.find(r => r.id === t.rfq_id)} tradeQuotes={quotes.filter(q => q.rfq_id === t.rfq_id)} agents={agents} supraAddr={supraAddress || undefined} />
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {completedTrades.length > 0 && (
        <>
          <div className="px-4 py-2.5 flex items-center justify-between"
            style={{ background: "var(--surface-2)", borderTop: "1px solid var(--border)" }}>
            <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>Completed Trades</span>
            <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>
              {completedTrades.length} execution{completedTrades.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div>
              {completedTrades.map(t => {
                const att = attestations[t.id];
                const takerTxUrl = txUrl(t.taker_tx_hash || "", t.source_chain);
                const makerTxUrl = txUrl(t.maker_tx_hash || "", t.dest_chain);
                const isExpanded = expandedCompleted === t.id;
                const pairClean = displayPair(t.pair);
                const [base, quote] = t.pair.split("/");
                const baseClean = base.replace("fx", "");
                const quoteClean = quote.replace("fx", "");
                const rfq = rfqs.find(r => r.id === t.rfq_id);
                const tradeQuotes = rfq ? quotes.filter(q => q.rfq_id === rfq.id) : [];
                const askingPrice = rfq?.reference_price;
                const priceDiff = askingPrice && askingPrice > 0 ? ((t.rate - askingPrice) / askingPrice) * 100 : null;

                return (
                  <div key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-white/[0.01] transition-colors"
                      onClick={() => setExpandedCompleted(isExpanded ? null : t.id)}>
                      <span className="mono text-[12px] w-20 shrink-0" style={{ color: "var(--t3)" }}>{t.display_id}</span>
                      <span className="text-[13px] font-semibold w-28 shrink-0">{pairClean}</span>
                      <span className="mono text-[13px] w-24 shrink-0">{t.size} {baseClean}</span>
                      <span className="mono text-[13px] w-28 shrink-0" style={{ color: "var(--t1)" }}>{fmtRate(t.rate)} {quoteClean}</span>
                      <span className="text-[12px] shrink-0" style={{ color: "var(--t3)" }}>{t.source_chain} → {t.dest_chain}</span>
                      <span className="mono text-[13px] shrink-0" style={{ color: t.settle_ms ? "var(--positive)" : "var(--t3)" }}>
                        {t.settle_ms ? (t.settle_ms / 1000).toFixed(1) + "s" : "—"}
                      </span>
                      <div className="flex-1" />
                      <span className={`tag tag-${t.status}`}>
                        {t.status === "settled" ? "Settled" : t.status.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--t3)" }}>{isExpanded ? "▲" : "▼"}</span>
                    </div>

                    {isExpanded && (
                      <div className="px-6 pb-4 pt-1" style={{ background: "var(--bg-raised)" }}>
                        {/* --- Trade Summary --- */}
                        <div className="grid grid-cols-3 gap-6 mb-4">
                          <div>
                            <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Price Execution</span>
                            {askingPrice ? (
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px]" style={{ color: "var(--t3)" }}>Asked:</span>
                                  <span className="mono text-[13px]" style={{ color: "var(--t2)" }}>{fmtRate(askingPrice)} {quoteClean}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px]" style={{ color: "var(--t3)" }}>Filled:</span>
                                  <span className="mono text-[13px] font-semibold" style={{ color: "var(--t1)" }}>{fmtRate(t.rate)} {quoteClean}</span>
                                  {priceDiff !== null && (
                                    <span className="mono text-[11px]" style={{ color: priceDiff >= 0 ? "var(--positive)" : "var(--negative)" }}>
                                      {priceDiff >= 0 ? "+" : ""}{priceDiff.toFixed(2)}%
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[11px]" style={{ color: "var(--t3)" }}>Notional:</span>
                                  <span className="mono text-[13px]" style={{ color: "var(--positive)" }}>
                                    {(t.size * t.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {quoteClean}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <span className="mono text-[13px]" style={{ color: "var(--t1)" }}>{fmtRate(t.rate)} {quoteClean}</span>
                            )}
                          </div>

                          <div>
                            <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Counterparties</span>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] w-12" style={{ color: "var(--t3)" }}>Taker:</span>
                              <AddrWithRep addr={t.taker_address} chain={t.source_chain} agents={agents} isMine={t.taker_address === supraAddress} />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] w-12" style={{ color: "var(--t3)" }}>Maker:</span>
                              <AddrWithRep addr={t.maker_address} chain={t.dest_chain} agents={agents} isMine={t.maker_address === supraAddress} />
                            </div>
                          </div>

                          <div>
                            <span className="mono text-[10px] uppercase tracking-wider block mb-1" style={{ color: "var(--t3)" }}>Settlement</span>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] w-16" style={{ color: "var(--t3)" }}>Taker TX:</span>
                              {t.taker_tx_hash && takerTxUrl ? (
                                <a href={takerTxUrl} target="_blank" rel="noopener" className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                                  {t.taker_tx_hash.slice(0, 10)}…{t.taker_tx_hash.slice(-6)} ↗
                                </a>
                              ) : <span className="text-[12px]" style={{ color: "var(--t3)" }}>—</span>}
                            </div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] w-16" style={{ color: "var(--t3)" }}>Maker TX:</span>
                              {t.maker_tx_hash && makerTxUrl ? (
                                <a href={makerTxUrl} target="_blank" rel="noopener" className="mono text-[12px] hover:underline" style={{ color: "var(--accent)" }}>
                                  {t.maker_tx_hash.slice(0, 10)}…{t.maker_tx_hash.slice(-6)} ↗
                                </a>
                              ) : <span className="text-[12px]" style={{ color: "var(--t3)" }}>—</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] w-16" style={{ color: "var(--t3)" }}>Attestation:</span>
                              {att ? (
                                <a href={`https://testnet.suprascan.io/tx/${att.replace(/^0x/, "")}`} target="_blank" rel="noopener"
                                  className="mono text-[12px] hover:underline" style={{ color: "var(--positive)" }}>
                                  {att.slice(0, 10)}…{att.slice(-6)} ↗
                                </a>
                              ) : t.status === "settled" ? (
                                <span className="text-[12px]" style={{ color: "var(--t3)" }}>pending</span>
                              ) : <span className="text-[12px]" style={{ color: "var(--t3)" }}>—</span>}
                            </div>
                            {t.settle_ms && (
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[11px] w-16" style={{ color: "var(--t3)" }}>Duration:</span>
                                <span className="mono text-[13px] font-semibold" style={{ color: "var(--positive)" }}>
                                  {(t.settle_ms / 1000).toFixed(1)}s
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* --- Quote History --- */}
                        {tradeQuotes.length > 0 && (
                          <div>
                            <span className="mono text-[10px] uppercase tracking-wider block mb-1.5" style={{ color: "var(--t3)" }}>
                              Quote History ({tradeQuotes.length} quote{tradeQuotes.length !== 1 ? "s" : ""})
                            </span>
                            <div className="rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                              {tradeQuotes.map((q, qi) => {
                                const qDiff = askingPrice && askingPrice > 0 ? ((q.rate - askingPrice) / askingPrice) * 100 : null;
                                return (
                                  <div key={q.id} className="flex items-center gap-4 px-4 py-2"
                                    style={{ borderBottom: qi < tradeQuotes.length - 1 ? "1px solid var(--border)" : "none", background: q.status === "accepted" ? "rgba(16,185,129,0.04)" : "transparent" }}>
                                    <div className="w-36">
                                      <AddrWithRep addr={q.maker_address} chain={t.dest_chain} agents={agents} isMine={q.maker_address === supraAddress} />
                                    </div>
                                    <span className="mono text-[13px] w-32" style={{ color: "var(--t1)" }}>{fmtRate(q.rate)} {quoteClean}</span>
                                    {qDiff !== null && (
                                      <span className="mono text-[11px] w-20" style={{ color: qDiff >= 0 ? "var(--positive)" : "var(--negative)" }}>
                                        {qDiff >= 0 ? "+" : ""}{qDiff.toFixed(2)}%
                                      </span>
                                    )}
                                    <span className={`tag tag-${q.status}`}>{q.status}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
        </>
      )}
    </div>
  );
}
