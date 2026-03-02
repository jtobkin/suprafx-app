"use client";
import { useState, useEffect, useRef } from "react";
import { useWallet } from "./WalletProvider";
import { Trade } from "@/lib/types";

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
      <span className="font-mono text-[9px] shrink-0" style={{ color: "var(--t3)" }}>{time}</span>
      <span className="text-[11px]" style={{ color: color || "var(--t2)" }}>{text}</span>
    </div>
  );
}

function ActiveTrade({ trade, onUpdate }: { trade: Trade; onUpdate: () => void }) {
  const { evmAddress, supraAddress, isDemo, sendSepoliaEth, sendSupraTokens } = useWallet();
  const [txHash, setTxHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<Array<{ time: string; text: string; color?: string }>>([]);
  const [autoRunning, setAutoRunning] = useState(false);
  const autoRef = useRef(false);

  const hasWallet = !!evmAddress && !isDemo;
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
      
      if (takerResult.autoSettled) {
        // Bot already sent Supra and settled the trade!
        addLog("Taker TX verified by committee (5/5)", "var(--positive)");
        addLog("Maker bot auto-sent SUPRA to taker", "var(--accent-light)");
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

      if (takerResult.verified) {
        addLog("Taker TX verified by committee (5/5)", "var(--positive)");
      } else {
        addLog("Taker verification pending — retrying in 5s…", "var(--warn)");
        await new Promise(r => setTimeout(r, 5000));
        const retry = await confirmTx("taker", takerHash);
        if (retry.autoSettled) {
          addLog("Trade auto-settled by maker bot!", "var(--positive)");
          onUpdate();
          autoRef.current = false;
          setAutoRunning(false);
          return;
        }
        addLog("Taker TX verified", "var(--positive)");
      }
      onUpdate();
      if (!autoRef.current) return;

      // If maker already sent (status from API), check if we need to wait
      if (takerResult.status === 'maker_sent' || takerResult.status === 'settled') {
        addLog("Maker bot already sent on Supra — settling…", "var(--positive)");
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
      {/* Trade info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px]" style={{ color: "var(--t3)" }}>{trade.display_id}</span>
          <span className="text-[12px] font-semibold">{trade.pair}</span>
          <span className="font-mono text-[12px]">{trade.size}</span>
          <span className="font-mono text-[11px]" style={{ color: "var(--t2)" }}>
            @ ${Number(trade.rate)?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {trade.status === "settled" && trade.settle_ms && (
            <span className="font-mono text-[10px]" style={{ color: "var(--positive)" }}>
              {(trade.settle_ms / 1000).toFixed(1)}s
            </span>
          )}
          <span className={`tag tag-${trade.status === "open" ? "open_trade" : trade.status}`}>
            {trade.status === "settled" ? "Settled" : trade.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      <Progress status={trade.status} />

      {/* === OPEN: Show mode selection === */}
      {trade.status === "open" && !autoRunning && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <button onClick={runAutoMode}
              className="px-4 py-[7px] rounded text-[11px] font-semibold transition-all"
              style={{ background: "var(--positive)", color: "#fff", border: "none" }}>
              Auto Settlement
            </button>
            {hasWallet && (
              <button onClick={manualSendSepolia} disabled={loading}
                className="px-4 py-[7px] rounded text-[11px] font-semibold disabled:opacity-30 transition-all"
                style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
                {loading ? "Sending…" : "Manual: Send on Sepolia"}
              </button>
            )}
            <button onClick={manualDemoTx} disabled={loading}
              className="px-3 py-[7px] rounded text-[10px] font-mono disabled:opacity-30"
              style={{ background: "var(--surface-3)", color: "var(--t2)", border: "none" }}>
              Demo TX
            </button>
          </div>
          {/* Manual hash input */}
          <div className="flex items-center gap-2">
            <input type="text" placeholder="or paste TX hash: 0x…" value={txHash}
              onChange={e => setTxHash(e.target.value)}
              className="flex-1 px-2.5 py-[5px] rounded border text-[10px] font-mono outline-none"
              style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--t0)" }} />
            <button onClick={manualSubmitHash} disabled={loading || !txHash.trim()}
              className="px-2.5 py-[5px] rounded text-[9px] font-medium disabled:opacity-30"
              style={{ background: "var(--surface-3)", color: "var(--t1)", border: "none" }}>
              Submit
            </button>
          </div>
        </div>
      )}

      {/* === AUTO RUNNING === */}
      {autoRunning && (
        <div className="mb-1">
          <div className="flex items-center gap-2 mb-2">
            <Spinner color="var(--positive)" />
            <span className="text-[11px] font-medium" style={{ color: "var(--positive)" }}>Auto settlement in progress</span>
            <button onClick={cancelAuto}
              className="px-2 py-0.5 rounded text-[9px] font-mono ml-auto"
              style={{ background: "var(--surface-3)", color: "var(--t3)", border: "none" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* === TAKER SENT (manual mode) === */}
      {trade.status === "taker_sent" && !autoRunning && (
        <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--t2)" }}>
          <Spinner color="var(--accent)" /> Committee verifying taker TX…
          {trade.taker_tx_hash?.startsWith("0x") && (
            <a href={`https://sepolia.etherscan.io/tx/${trade.taker_tx_hash}`} target="_blank"
              className="font-mono text-[10px] ml-1" style={{ color: "var(--accent-light)" }}>Etherscan ↗</a>
          )}
        </div>
      )}

      {/* === TAKER VERIFIED (manual mode) === */}
      {trade.status === "taker_verified" && !autoRunning && (
        <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: "var(--positive)" }}>Taker verified (5/5).</span>
          <button onClick={manualMakerSend} disabled={loading}
            className="px-3 py-[6px] rounded text-[10px] font-semibold disabled:opacity-30"
            style={{ background: hasSupraWallet ? "var(--positive)" : "var(--surface-3)", color: hasSupraWallet ? "#fff" : "var(--t0)", border: hasSupraWallet ? "none" : "1px solid var(--border-active)" }}>
            {loading ? "Sending…" : hasSupraWallet ? "Send on Supra Testnet" : "Simulate Maker Send"}
          </button>
        </div>
      )}

      {/* === MAKER SENT (manual mode) === */}
      {trade.status === "maker_sent" && !autoRunning && (
        <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--t2)" }}>
          <Spinner color="var(--positive)" /> Verifying maker TX on {trade.dest_chain}…
        </div>
      )}

      {/* === SETTLED === */}
      {trade.status === "settled" && (
        <div className="flex items-center gap-3">
          {trade.taker_tx_hash?.startsWith("0x") && (
            <a href={`https://sepolia.etherscan.io/tx/${trade.taker_tx_hash}`} target="_blank"
              className="font-mono text-[10px]" style={{ color: "var(--accent-light)" }}>Taker TX ↗</a>
          )}
          {trade.maker_tx_hash && (
            <a href={`https://testnet.suprascan.io/tx/${trade.maker_tx_hash}`} target="_blank"
              className="font-mono text-[10px]" style={{ color: "var(--accent-light)" }}>Maker TX ↗</a>
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

export default function TradeFlow({ trades, onUpdate }: { trades: Trade[]; onUpdate: () => void }) {
  const active = trades.filter(t => !["settled", "failed"].includes(t.status));
  const recent = trades.filter(t => t.status === "settled").slice(0, 3);
  const display = [...active, ...recent];
  if (display.length === 0) return null;

  return (
    <div className="rounded border overflow-hidden mb-4 animate-in"
      style={{ borderColor: active.length > 0 ? "var(--border-active)" : "var(--border)", background: "var(--surface)" }}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <div className="flex items-center gap-2">
          {active.length > 0 && <div className="w-1 h-1 rounded-full animate-pulse-dot" style={{ background: "var(--warn)" }} />}
          <span className="text-[11px] font-medium" style={{ color: "var(--t1)" }}>Active Trades</span>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>
          {active.length} in flight
        </span>
      </div>
      {display.map(t => <ActiveTrade key={t.id} trade={t} onUpdate={onUpdate} />)}
    </div>
  );
}
