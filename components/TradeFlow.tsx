"use client";
import { useState } from "react";
import { useWallet } from "./WalletProvider";
import { Trade } from "@/lib/types";

const STEPS = [
  { key: "open", label: "Matched" },
  { key: "taker_sent", label: "Taker Sent" },
  { key: "taker_verified", label: "Taker Verified" },
  { key: "maker_sent", label: "Maker Sent" },
  { key: "settled", label: "Settled" },
];

function stepIndex(status: string) {
  const i = STEPS.findIndex(s => s.key === status);
  return i >= 0 ? i : 0;
}

function fmtUsd(n: number) {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatusBar({ status }: { status: string }) {
  const current = stepIndex(status);
  return (
    <div className="flex items-center gap-0.5 mb-4">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const isFailed = status === "failed";
        return (
          <div key={s.key} className="flex items-center gap-0.5 flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className="h-1 w-full rounded-full mb-1.5"
                style={{
                  background: isFailed ? "var(--negative)"
                    : done ? "var(--positive)"
                    : active ? "var(--accent)"
                    : "var(--surface-3)",
                }} />
              <span className="font-mono text-[9px] uppercase tracking-wider"
                style={{
                  color: isFailed ? "var(--negative)"
                    : done ? "var(--positive)"
                    : active ? "var(--accent)"
                    : "var(--t3)",
                }}>
                {s.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActiveTrade({ trade, onUpdate }: { trade: Trade; onUpdate: () => void }) {
  const { address } = useWallet();
  const [txHash, setTxHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isTaker = trade.taker_address === address;
  const isMaker = trade.maker_address === address;

  const submitTx = async (side: "taker" | "maker") => {
    if (!txHash.trim()) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/confirm-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId: trade.id, txHash: txHash.trim(), side }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg("Error: " + data.error);
      } else {
        setMsg("TX submitted — awaiting committee verification");
        setTxHash("");
        // Trigger verification
        setTimeout(async () => {
          await fetch("/api/cron/verify");
          onUpdate();
        }, 3000);
      }
    } catch (e: any) {
      setMsg("Error: " + e.message);
    }
    setLoading(false);
  };

  // Auto-trigger maker after taker verified
  const triggerMakerSend = async () => {
    setLoading(true);
    setMsg(null);
    try {
      // Simulate maker sending on Supra - use a demo TX hash
      const fakeMakerTx = "a" + Array.from({ length: 63 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      const res = await fetch("/api/confirm-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId: trade.id, txHash: fakeMakerTx, side: "maker" }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg("Error: " + data.error);
      } else {
        setMsg("Maker TX submitted — verifying…");
        setTimeout(async () => {
          await fetch("/api/cron/verify");
          onUpdate();
        }, 3000);
      }
    } catch (e: any) {
      setMsg("Error: " + e.message);
    }
    setLoading(false);
  };

  return (
    <div className="p-4 border-b" style={{ borderColor: "var(--border)" }}>
      {/* Trade info row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4">
          <span className="font-mono text-[11px]" style={{ color: "var(--t2)" }}>{trade.display_id}</span>
          <span className="text-xs font-semibold">{trade.pair}</span>
          <span className="font-mono text-xs">{trade.size}</span>
          <span className="font-mono text-xs" style={{ color: "var(--t2)" }}>@ {fmtUsd(trade.rate)}</span>
        </div>
        <span className={`tag tag-${trade.status}`}>
          {trade.status === "settled" ? "Settled" : trade.status.replace(/_/g, " ")}
        </span>
      </div>

      {/* Progress bar */}
      <StatusBar status={trade.status} />

      {/* Actions based on current status */}
      {trade.status === "open" && (
        <div>
          <div className="text-[11px] mb-2" style={{ color: "var(--t2)" }}>
            Send <strong className="text-white">{trade.size} {trade.pair.split("/")[0]}</strong> on{" "}
            <strong className="text-white">{trade.source_chain}</strong>, then paste the TX hash below.
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="0x… Sepolia transaction hash"
              value={txHash}
              onChange={e => setTxHash(e.target.value)}
              className="flex-1 px-3 py-2 rounded border text-xs font-mono outline-none"
              style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--t0)" }}
            />
            <button
              onClick={() => submitTx("taker")}
              disabled={loading || !txHash.trim()}
              className="px-4 py-2 rounded border text-xs font-medium transition-all disabled:opacity-40"
              style={{ background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }}>
              {loading ? "Submitting…" : "Confirm TX"}
            </button>
          </div>
          <div className="mt-2">
            <button
              onClick={() => {
                const demoHash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
                setTxHash(demoHash);
              }}
              className="font-mono text-[10px] cursor-pointer hover:underline"
              style={{ color: "var(--t3)", background: "none", border: "none" }}>
              Generate demo TX hash
            </button>
          </div>
        </div>
      )}

      {trade.status === "taker_sent" && (
        <div className="flex items-center gap-2 py-2">
          <div className="w-3 h-3 rounded-full border-2 animate-spin"
            style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
          <span className="text-[11px]" style={{ color: "var(--t2)" }}>
            Committee verifying taker transaction on {trade.source_chain}…
          </span>
        </div>
      )}

      {trade.status === "taker_verified" && (
        <div>
          <div className="text-[11px] mb-2" style={{ color: "var(--positive)" }}>
            Taker TX verified by committee. Waiting for maker to send on {trade.dest_chain}.
          </div>
          <button
            onClick={triggerMakerSend}
            disabled={loading}
            className="px-4 py-2 rounded border text-xs font-medium transition-all disabled:opacity-40"
            style={{ background: "var(--surface-2)", borderColor: "var(--border-active)", color: "var(--t0)" }}>
            {loading ? "Sending…" : "Simulate Maker Send"}
          </button>
        </div>
      )}

      {trade.status === "maker_sent" && (
        <div className="flex items-center gap-2 py-2">
          <div className="w-3 h-3 rounded-full border-2 animate-spin"
            style={{ borderColor: "var(--positive)", borderTopColor: "transparent" }} />
          <span className="text-[11px]" style={{ color: "var(--t2)" }}>
            Committee verifying maker transaction on {trade.dest_chain}…
          </span>
        </div>
      )}

      {trade.status === "settled" && (
        <div className="flex items-center gap-3 py-1">
          <span className="text-[11px]" style={{ color: "var(--positive)" }}>
            Trade settled in {trade.settle_ms ? (trade.settle_ms / 1000).toFixed(1) + "s" : "—"}
          </span>
          {trade.taker_tx_hash && (
            <a href={`https://sepolia.etherscan.io/tx/${trade.taker_tx_hash}`} target="_blank"
              className="font-mono text-[10px] hover:underline" style={{ color: "var(--accent)" }}>
              Taker TX ↗
            </a>
          )}
          {trade.maker_tx_hash && (
            <a href={`https://testnet.suprascan.io/tx/${trade.maker_tx_hash}`} target="_blank"
              className="font-mono text-[10px] hover:underline" style={{ color: "var(--accent)" }}>
              Maker TX ↗
            </a>
          )}
        </div>
      )}

      {msg && (
        <div className="mt-2 font-mono text-[11px] px-3 py-2 rounded"
          style={{
            background: msg.startsWith("Error") ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
            color: msg.startsWith("Error") ? "var(--negative)" : "var(--positive)",
          }}>
          {msg}
        </div>
      )}
    </div>
  );
}

export default function TradeFlow({ trades, onUpdate }: { trades: Trade[]; onUpdate: () => void }) {
  // Show active (non-settled, non-failed) trades, plus recently settled
  const active = trades.filter(t => !["settled", "failed"].includes(t.status));
  const recentSettled = trades
    .filter(t => t.status === "settled")
    .slice(0, 2);
  const display = [...active, ...recentSettled];

  if (display.length === 0) return null;

  return (
    <div className="border rounded-md overflow-hidden mb-4 animate-in"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex justify-between items-center px-4 py-3 border-b"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <span className="text-xs font-medium" style={{ color: "var(--t1)" }}>Active Trades</span>
        <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--t3)" }}>
          {active.length} Active
        </span>
      </div>
      {display.map(t => (
        <ActiveTrade key={t.id} trade={t} onUpdate={onUpdate} />
      ))}
    </div>
  );
}
