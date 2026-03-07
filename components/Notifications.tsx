"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet } from "./WalletProvider";
import type { Trade, Quote } from "@/lib/types";

interface Notification {
  id: string;
  type: "info" | "action" | "success" | "warning" | "error";
  title: string;
  message: string;
  tradeId?: string;
  timestamp: number;
  dismissed: boolean;
}

export default function Notifications({
  trades,
  quotes,
}: {
  trades: Trade[];
  quotes: Quote[];
}) {
  const { supraAddress } = useWallet();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const prevTradesRef = useRef<Map<string, Trade>>(new Map());
  const prevQuotesRef = useRef<Map<string, Quote>>(new Map());
  const initialLoadRef = useRef(true);

  const addNotification = useCallback((n: Omit<Notification, "id" | "timestamp" | "dismissed">) => {
    const id = Math.random().toString(36).slice(2, 10);
    setNotifications(prev => {
      // Dedupe: don't add if same title+tradeId exists in last 10 seconds
      const isDupe = prev.some(
        p => p.title === n.title && p.tradeId === n.tradeId && Date.now() - p.timestamp < 10000
      );
      if (isDupe) return prev;
      return [{ ...n, id, timestamp: Date.now(), dismissed: false }, ...prev].slice(0, 10);
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, dismissed: true } : n));
  }, []);

  const dismissAll = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, dismissed: true })));
  }, []);

  // Auto-dismiss after 15 seconds
  useEffect(() => {
    const iv = setInterval(() => {
      setNotifications(prev =>
        prev.map(n =>
          !n.dismissed && Date.now() - n.timestamp > 15000
            ? { ...n, dismissed: true }
            : n
        )
      );
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Track trade state changes
  useEffect(() => {
    if (!supraAddress) return;

    // Skip notifications on initial load
    if (initialLoadRef.current) {
      const tradeMap = new Map<string, Trade>();
      trades.forEach(t => tradeMap.set(t.id, t));
      prevTradesRef.current = tradeMap;

      const quoteMap = new Map<string, Quote>();
      quotes.forEach(q => quoteMap.set(q.id, q));
      prevQuotesRef.current = quoteMap;

      initialLoadRef.current = false;
      return;
    }

    // Snapshot prev state BEFORE updating refs
    // This prevents re-detection on rapid re-renders from realtime + polling
    const prevTrades = new Map(prevTradesRef.current);
    const prevQuotes = new Map(prevQuotesRef.current);

    // Update refs IMMEDIATELY so the next render sees current state
    // (prevents the same transition being detected 3x across rapid re-renders)
    const newTradeMap = new Map<string, Trade>();
    trades.forEach(t => newTradeMap.set(t.id, t));
    prevTradesRef.current = newTradeMap;

    const newQuoteMap = new Map<string, Quote>();
    quotes.forEach(q => newQuoteMap.set(q.id, q));
    prevQuotesRef.current = newQuoteMap;

    for (const trade of trades) {
      const prev = prevTrades.get(trade.id);
      const isTaker = trade.taker_address === supraAddress;
      const isMaker = trade.maker_address === supraAddress;
      if (!isTaker && !isMaker) continue;

      const txId = trade.display_id || trade.id.slice(0, 8);

      // New trade created (match confirmed)
      if (!prev && (trade.status === "open" || trade.status === "matched")) {
        if (isMaker) {
          addNotification({
            type: "action",
            title: "Quote Accepted",
            message: `Your quote on ${txId} was accepted. Waiting for taker to send.`,
            tradeId: trade.id,
          });
        }
      }

      if (!prev) continue;

      // Status transitions
      if (prev.status !== trade.status) {
        // Taker sent -> taker_verified: notify maker
        if (trade.status === "taker_verified" && isMaker) {
          addNotification({
            type: "action",
            title: "Your Turn to Send",
            message: `Taker sent on ${txId}. Council verified. Send ${trade.pair.split("/")[1]?.replace("fx","")} on ${trade.dest_chain} now.`,
            tradeId: trade.id,
          });
        }

        // Taker sent: notify taker
        if (trade.status === "taker_sent" && isTaker) {
          addNotification({
            type: "info",
            title: "TX Submitted",
            message: `Your TX on ${txId} is being verified by the Council.`,
            tradeId: trade.id,
          });
        }

        // Maker sent: notify taker
        if (trade.status === "maker_sent" && isTaker) {
          addNotification({
            type: "info",
            title: "Maker Sent",
            message: `Maker sent on ${txId}. Council verifying. Settlement in progress.`,
            tradeId: trade.id,
          });
        }

        // Settled: notify both
        if (trade.status === "settled") {
          const duration = trade.settle_ms ? (trade.settle_ms / 1000).toFixed(1) + "s" : "";
          addNotification({
            type: "success",
            title: "Trade Settled",
            message: `${txId} settled${duration ? " in " + duration : ""}. Attestation complete.`,
            tradeId: trade.id,
          });
        }

        // Taker timed out
        if (trade.status === "taker_timed_out") {
          if (isTaker) {
            addNotification({
              type: "error",
              title: "You Timed Out",
              message: `${txId}: You did not settle within 30 minutes. Your reputation has been reduced by 33%. Check your Profile for updated score.`,
              tradeId: trade.id,
            });
          } else if (isMaker) {
            addNotification({
              type: "info",
              title: "Taker Timed Out",
              message: `${txId}: Taker did not send within 30 minutes. Your earmarked deposit has been released.`,
              tradeId: trade.id,
            });
          }
        }

        // Maker defaulted
        if (trade.status === "maker_defaulted") {
          if (isMaker) {
            addNotification({
              type: "error",
              title: "You Defaulted",
              message: `${txId}: You did not settle within 30 minutes. Your reputation has been reduced by 67% and your deposit has been liquidated to repay the taker.`,
              tradeId: trade.id,
            });
          } else if (isTaker) {
            addNotification({
              type: "warning",
              title: "Maker Defaulted — You Will Be Repaid",
              message: `${txId}: Maker did not send within 30 minutes. You are being repaid from the maker's security deposit. Check your vault for the credit.`,
              tradeId: trade.id,
            });
          }
        }

        // Failed
        if (trade.status === "failed") {
          addNotification({
            type: "error",
            title: "Trade Failed",
            message: `${txId}: Trade failed. Check details.`,
            tradeId: trade.id,
          });
        }
      }
    }

    // Track quote acceptances: if a quote you placed gets accepted
    for (const quote of quotes) {
      const prev = prevQuotes.get(quote.id);
      if (!prev) continue;
      if (quote.maker_address !== supraAddress) continue;

      if (prev.status !== "accepted" && quote.status === "accepted") {
        addNotification({
          type: "action",
          title: "Quote Accepted",
          message: `Your quote was accepted. A trade has been created.`,
        });
      }
    }
  }, [trades, quotes, supraAddress, addNotification]);

  const active = notifications.filter(n => !n.dismissed);
  if (active.length === 0) return null;

  const typeStyles: Record<string, { bg: string; border: string; icon: string; iconColor: string }> = {
    info: { bg: "rgba(37,99,235,0.06)", border: "rgba(37,99,235,0.15)", icon: "i", iconColor: "var(--accent-light)" },
    action: { bg: "rgba(234,179,8,0.06)", border: "rgba(234,179,8,0.2)", icon: "!", iconColor: "var(--warn)" },
    success: { bg: "rgba(34,197,94,0.06)", border: "rgba(34,197,94,0.15)", icon: "*", iconColor: "var(--positive)" },
    warning: { bg: "rgba(234,179,8,0.06)", border: "rgba(234,179,8,0.2)", icon: "!", iconColor: "var(--warn)" },
    error: { bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.15)", icon: "x", iconColor: "var(--negative)" },
  };

  return (
    <div className="fixed top-[52px] right-4 z-40 w-[380px] space-y-2" style={{ pointerEvents: "none" }}>
      {active.length > 1 && (
        <div className="flex justify-end" style={{ pointerEvents: "auto" }}>
          <button
            onClick={dismissAll}
            className="text-[11px] mono px-2 py-0.5 rounded"
            style={{ color: "var(--t3)", background: "var(--surface-3)", border: "none", cursor: "pointer" }}>
            dismiss all
          </button>
        </div>
      )}
      {active.map(n => {
        const s = typeStyles[n.type] || typeStyles.info;
        return (
          <div
            key={n.id}
            className="rounded-lg p-3 border shadow-lg animate-in fade-in slide-in-from-right"
            style={{
              background: s.bg,
              borderColor: s.border,
              backdropFilter: "blur(12px)",
              pointerEvents: "auto",
            }}>
            <div className="flex items-start gap-2.5">
              <span className="text-[14px] mt-0.5" style={{ color: s.iconColor }}>{s.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold" style={{ color: "var(--t0)" }}>{n.title}</span>
                  <button
                    onClick={() => dismiss(n.id)}
                    className="text-[11px] px-1 ml-2 shrink-0"
                    style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>
                    x
                  </button>
                </div>
                <div className="text-[12px] mt-0.5" style={{ color: "var(--t2)" }}>{n.message}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
