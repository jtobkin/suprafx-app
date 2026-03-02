"use client";
import { useState } from "react";
import { useWallet } from "./WalletProvider";
import { Trade } from "@/lib/types";

const STEPS = ["open", "taker_sent", "taker_verified", "maker_sent", "settled"];
const LABELS = ["Matched", "Taker Sent", "Verified", "Maker Sent", "Settled"];

// In testnet demo, we send to self (proves on-chain TX without losing funds)
// In production this would be a smart contract escrow
const ESCROW_ADDRESS = "SELF"; // special flag — resolved at send time to sender's address

function stepIdx(s: string) { const i = STEPS.indexOf(s); return i >= 0 ? i : 0; }

function Progress({ status }: { status: string }) {
  const cur = stepIdx(status);
  const failed = status === "failed";
  return (
    <div className="flex items-center gap-1 my-3">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center flex-1 gap-1">
          <div className="flex flex-col items-center flex-1">
            <div className="w-full h-[3px] rounded-full transition-all duration-500"
              style={{
                background: failed ? "var(--negative)"
                  : i < cur ? "var(--positive)"
                  : i === cur ? "var(--accent)"
                  : "var(--surface-3)",
              }} />
            <span className="font-mono text-[8px] uppercase tracking-wider mt-1 transition-colors"
              style={{
                color: failed ? "var(--negative)"
                  : i < cur ? "var(--positive)"
                  : i === cur ? "var(--accent-light)"
                  : "var(--t3)",
              }}>
              {LABELS[i]}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Spinner() {
  return <div className="w-2.5 h-2.5 rounded-full border border-current animate-spin" style={{ borderTopColor: "transparent" }} />;
}

function ActiveTrade({ trade, onUpdate }: { trade: Trade; onUpdate: () => void }) {
  const { address, evmAddress, isDemo, sendSepoliaEth } = useWallet();
  const [txHash, setTxHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const confirmTx = async (side: "taker" | "maker", hash: string) => {
    if (!hash) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/confirm-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId: trade.id, txHash: hash, side }),
      });
      const data = await res.json();
      if (data.error) { setMsg(data.error); }
      else {
        setMsg("TX confirmed — committee verifying…");
        setTxHash("");
        setTimeout(async () => { await fetch("/api/cron/verify"); onUpdate(); }, 3000);
      }
    } catch (e: any) { setMsg(e.message); }
    setLoading(false);
  };

  // REAL Sepolia send via StarKey/MetaMask
  const sendOnSepolia = async () => {
    setLoading(true);
    setMsg(null);
    try {
      // Convert trade size to wei — use a tiny amount for testnet demo
      // Send 0.00001 ETH to testnet escrow
      const valueWei = "0x" + BigInt(10000000000000).toString(16); // 0.00001 ETH
      
      // Testnet escrow — a neutral address (not self, not burn)
      const destination = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";
      
      setMsg("Waiting for wallet approval…");
      const hash = await sendSepoliaEth(destination, valueWei);
      
      setMsg("TX sent! Hash: " + hash.slice(0, 14) + "… — submitting to committee");
      
      // Submit the real TX hash to our API
      await confirmTx("taker", hash);
    } catch (e: any) {
      if (e.code === 4001 || e.message?.includes("rejected")) {
        setMsg("Transaction rejected by user");
      } else {
        setMsg("Wallet error: " + (e.message || e));
      }
    }
    setLoading(false);
  };

  // Demo mode: generate fake TX hash
  const sendDemo = async () => {
    const demoHash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    await confirmTx("taker", demoHash);
  };

  // Manual TX hash input
  const submitManualHash = async () => {
    if (!txHash.trim()) return;
    await confirmTx("taker", txHash.trim());
  };

  const simulateMaker = async () => {
    const hash = "a" + Array.from({ length: 63 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    await confirmTx("maker", hash);
  };

  const hasRealWallet = !!evmAddress && !isDemo;

  return (
    <div className="px-4 py-3 border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
      {/* Trade info row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px]" style={{ color: "var(--t3)" }}>{trade.display_id}</span>
          <span className="text-[12px] font-semibold">{trade.pair}</span>
          <span className="font-mono text-[12px]">{trade.size}</span>
          <span className="font-mono text-[11px]" style={{ color: "var(--t2)" }}>
            @ ${Number(trade.rate)?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
          <span className="font-mono text-[11px]" style={{ color: "var(--t2)" }}>
            = ${Number(trade.notional)?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
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

      {/* === OPEN: taker needs to send === */}
      {trade.status === "open" && (
        <div>
          {hasRealWallet ? (
            <>
              <div className="text-[11px] mb-2" style={{ color: "var(--t2)" }}>
                Send <strong className="text-white">{trade.size} ETH</strong> on Sepolia to escrow.
                Your wallet will prompt you to sign.
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={sendOnSepolia}
                  disabled={loading}
                  className="px-4 py-[7px] rounded text-[11px] font-semibold disabled:opacity-30 transition-all"
                  style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
                  {loading ? "Waiting for wallet…" : "Send on Sepolia"}
                </button>
                <span className="text-[9px] font-mono" style={{ color: "var(--t3)" }}>
                  via {evmAddress ? "StarKey EVM" : "wallet"}
                </span>
              </div>
              {/* Manual fallback */}
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[9px]" style={{ color: "var(--t3)" }}>or paste TX hash:</span>
                <input type="text" placeholder="0x…" value={txHash}
                  onChange={e => setTxHash(e.target.value)}
                  className="flex-1 px-2 py-1 rounded border text-[10px] font-mono outline-none"
                  style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--t0)" }} />
                <button onClick={submitManualHash} disabled={loading || !txHash.trim()}
                  className="px-2 py-1 rounded text-[9px] font-medium disabled:opacity-30"
                  style={{ background: "var(--surface-3)", color: "var(--t1)", border: "none" }}>
                  Submit
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-[11px] mb-2" style={{ color: "var(--t2)" }}>
                Send <strong className="text-white">{trade.size} {trade.pair.split("/")[0]}</strong> on{" "}
                <strong className="text-white">{trade.source_chain}</strong>, then confirm below.
              </div>
              <div className="flex items-center gap-2">
                <input type="text" placeholder="0x… transaction hash" value={txHash}
                  onChange={e => setTxHash(e.target.value)}
                  className="flex-1 px-2.5 py-[6px] rounded border text-[11px] font-mono outline-none"
                  style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--t0)" }} />
                <button onClick={submitManualHash} disabled={loading || !txHash.trim()}
                  className="px-3 py-[6px] rounded text-[10px] font-semibold disabled:opacity-30"
                  style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
                  {loading ? "…" : "Confirm"}
                </button>
                <button onClick={sendDemo}
                  className="px-2 py-[6px] rounded text-[9px] font-mono"
                  style={{ background: "var(--surface-3)", color: "var(--t3)", border: "none" }}>
                  Demo TX
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* === TAKER SENT: waiting for committee === */}
      {trade.status === "taker_sent" && (
        <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--t2)" }}>
          <Spinner /> Committee verifying taker TX on {trade.source_chain}…
          {trade.taker_tx_hash && (
            <a href={`https://sepolia.etherscan.io/tx/${trade.taker_tx_hash}`} target="_blank"
              className="font-mono text-[10px] ml-2" style={{ color: "var(--accent-light)" }}>
              View on Etherscan ↗
            </a>
          )}
        </div>
      )}

      {/* === TAKER VERIFIED: maker needs to send === */}
      {trade.status === "taker_verified" && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px]" style={{ color: "var(--positive)" }}>Taker TX verified by committee (5/5).</span>
            {trade.taker_tx_hash && (
              <a href={`https://sepolia.etherscan.io/tx/${trade.taker_tx_hash}`} target="_blank"
                className="font-mono text-[10px]" style={{ color: "var(--accent-light)" }}>
                Etherscan ↗
              </a>
            )}
          </div>
          <div className="text-[11px] mb-2" style={{ color: "var(--t2)" }}>
            Waiting for maker to send on {trade.dest_chain}.
          </div>
          <button onClick={simulateMaker} disabled={loading}
            className="px-3 py-[6px] rounded text-[10px] font-semibold disabled:opacity-30"
            style={{ background: "var(--surface-3)", color: "var(--t0)", border: "1px solid var(--border-active)" }}>
            {loading ? "…" : "Simulate Maker Send"}
          </button>
        </div>
      )}

      {/* === MAKER SENT: waiting for committee === */}
      {trade.status === "maker_sent" && (
        <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--t2)" }}>
          <Spinner /> Committee verifying maker TX on {trade.dest_chain}…
        </div>
      )}

      {/* === SETTLED === */}
      {trade.status === "settled" && (
        <div className="flex items-center gap-3">
          <span className="text-[11px]" style={{ color: "var(--positive)" }}>
            Settled{trade.settle_ms ? ` in ${(trade.settle_ms / 1000).toFixed(1)}s` : ""}
          </span>
          {trade.taker_tx_hash && (
            <a href={`https://sepolia.etherscan.io/tx/${trade.taker_tx_hash}`} target="_blank"
              className="font-mono text-[10px] hover:underline" style={{ color: "var(--accent-light)" }}>
              Taker TX ↗
            </a>
          )}
          {trade.maker_tx_hash && (
            <a href={`https://testnet.suprascan.io/tx/${trade.maker_tx_hash}`} target="_blank"
              className="font-mono text-[10px] hover:underline" style={{ color: "var(--accent-light)" }}>
              Maker TX ↗
            </a>
          )}
        </div>
      )}

      {msg && (
        <div className="mt-2 font-mono text-[10px] px-2.5 py-1.5 rounded"
          style={{
            background: msg.includes("error") || msg.includes("Error") || msg.includes("rejected")
              ? "rgba(239,68,68,0.08)" : "rgba(37,99,235,0.08)",
            color: msg.includes("error") || msg.includes("Error") || msg.includes("rejected")
              ? "var(--negative)" : "var(--accent-light)",
          }}>
          {msg}
        </div>
      )}
    </div>
  );
}

export default function TradeFlow({ trades, onUpdate }: { trades: Trade[]; onUpdate: () => void }) {
  const active = trades.filter(t => !["settled", "failed"].includes(t.status));
  const recent = trades.filter(t => t.status === "settled").slice(0, 2);
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
