"use client";
import { useState, useEffect, useRef, useCallback } from "react";

const DEMO_PAIRS = [
  { pair: "ETH/SUPRA", sizes: [0.5, 1, 2, 5, 10] },
  { pair: "SUPRA/ETH", sizes: [100, 500, 1000, 2500] },
  { pair: "AAVE/SUPRA", sizes: [1, 5, 10, 25] },
  { pair: "LINK/SUPRA", sizes: [10, 50, 100, 250] },
  { pair: "USDC/SUPRA", sizes: [100, 500, 1000, 5000] },
  { pair: "USDT/SUPRA", sizes: [100, 500, 1000, 5000] },
  { pair: "ETH/USDC", sizes: [0.1, 0.5, 1, 2] },
  { pair: "ETH/USDT", sizes: [0.1, 0.5, 1, 2] },
  { pair: "AAVE/USDC", sizes: [1, 5, 10, 20] },
  { pair: "LINK/USDC", sizes: [10, 25, 50, 100] },
];

function randomHexAddr(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface LogEntry {
  time: string;
  text: string;
  color?: string;
}

export default function AutoTaker({ onActivity }: { onActivity?: () => void }) {
  const [active, setActive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [cycleCount, setCycleCount] = useState(0);
  const intervalRef = useRef<any>(null);
  const pendingRfq = useRef<{ rfqId: string; address: string; pair: string } | null>(null);
  const acceptTimerRef = useRef<any>(null);

  const addLog = useCallback((text: string, color?: string) => {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(prev => [...prev.slice(-30), { time, text, color }]);
  }, []);

  const runCycle = useCallback(async () => {
    try {
      // Step 1: Generate random taker + RFQ
      const takerAddr = randomHexAddr();
      const pairConfig = pick(DEMO_PAIRS);
      const size = pick(pairConfig.sizes);

      addLog(`New taker: ${takerAddr.slice(0, 10)}...`);
      addLog(`Submitting RFQ: ${pairConfig.pair} x ${size}`);

      const rfqRes = await fetch("/api/skill/suprafx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_rfq",
          agentAddress: takerAddr,
          pair: pairConfig.pair,
          size: String(size),
        }),
      });
      const rfqData = await rfqRes.json();

      if (rfqData.error) {
        addLog("RFQ failed: " + rfqData.error, "var(--negative)");
        return;
      }

      addLog(`RFQ created: ${rfqData.rfq?.displayId || rfqData.rfq?.id?.slice(0, 8)}`, "var(--accent-light)");
      onActivity?.();

      // Store pending RFQ for acceptance
      pendingRfq.current = { rfqId: rfqData.rfq.id, address: takerAddr, pair: pairConfig.pair };

      // Step 2: Wait 10 seconds then accept the bot's quote
      acceptTimerRef.current = setTimeout(async () => {
        if (!pendingRfq.current) return;
        const { rfqId, address } = pendingRfq.current;

        try {
          // Fetch quotes for this RFQ
          addLog("Looking for bot quote...");
          const checkRes = await fetch("/api/skill/suprafx", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "list_trades", agentAddress: address }),
          });

          // Find the bot's pending quote directly from supabase via the quotes
          const quotesRes = await fetch(`/api/skill/suprafx`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "check_trade", tradeId: rfqId }),
          }).catch(() => null);

          // Simpler approach: just query for pending quotes on this RFQ via accept
          // The bot auto-quotes immediately, so the quote should exist
          // We need to find the quote ID — fetch from supabase
          const { createClient } = await import("@supabase/supabase-js");
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
          const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
          const sb = createClient(supabaseUrl, supabaseKey);

          const { data: quotes } = await sb
            .from("quotes")
            .select("id, maker_address, rate, status")
            .eq("rfq_id", rfqId)
            .eq("status", "pending")
            .order("created_at", { ascending: false });

          if (!quotes || quotes.length === 0) {
            addLog("No pending quotes found, skipping accept", "var(--warn)");
            pendingRfq.current = null;
            return;
          }

          const botQuote = quotes.find((q: any) => q.maker_address === "auto-maker-bot") || quotes[0];
          addLog(`Accepting quote from ${botQuote.maker_address === "auto-maker-bot" ? "Bot" : botQuote.maker_address.slice(0, 8)} at ${botQuote.rate}`);

          const acceptRes = await fetch("/api/skill/suprafx", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "accept_quote",
              quoteId: botQuote.id,
              agentAddress: address,
            }),
          });
          const acceptData = await acceptRes.json();

          if (acceptData.error) {
            addLog("Accept failed: " + acceptData.error, "var(--negative)");
          } else {
            addLog(`Trade created: ${acceptData.trade?.displayId || "ok"}`, "var(--positive)");
            setCycleCount(c => c + 1);

            // Step 3: Auto-settle taker side with fake TX hash
            const tradeId = acceptData.trade?.id;
            if (tradeId) {
              addLog("Taker sending (simulated)...");
              await new Promise(r => setTimeout(r, 3000));

              const fakeTxHash = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
              const confirmRes = await fetch("/api/confirm-tx", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tradeId, txHash: fakeTxHash, side: "taker" }),
              });
              const confirmData = await confirmRes.json();

              if (confirmData.status === "settled") {
                addLog(`Settled in ${(confirmData.settleMs / 1000).toFixed(1)}s`, "var(--positive)");
              } else if (confirmData.verified) {
                addLog("Taker verified, maker settling...", "var(--accent-light)");
                if (confirmData.autoSettled) {
                  addLog(`Auto-settled in ${(confirmData.settleMs / 1000).toFixed(1)}s`, "var(--positive)");
                }
              } else {
                addLog("TX submitted: " + (confirmData.status || "pending"), "var(--t2)");
              }
            }
          }

          onActivity?.();
          pendingRfq.current = null;
        } catch (e: any) {
          addLog("Accept error: " + (e.message || e), "var(--negative)");
          pendingRfq.current = null;
        }
      }, 10000);

    } catch (e: any) {
      addLog("Cycle error: " + (e.message || e), "var(--negative)");
    }
  }, [addLog, onActivity]);

  useEffect(() => {
    if (active) {
      addLog("Auto-taker started", "var(--positive)");
      runCycle(); // run immediately
      intervalRef.current = setInterval(runCycle, 30000);
    } else {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      if (acceptTimerRef.current) { clearTimeout(acceptTimerRef.current); acceptTimerRef.current = null; }
      pendingRfq.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (acceptTimerRef.current) clearTimeout(acceptTimerRef.current);
    };
  }, [active, runCycle]);

  return (
    <div className="fixed bottom-5 right-5 z-50" style={{ maxWidth: expanded ? "380px" : "auto" }}>
      {expanded && (
        <div className="card mb-2 animate-slide-down" style={{ maxHeight: "300px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div className="card-header">
            <span className="text-[12px] font-semibold" style={{ color: "var(--t1)" }}>Auto-Taker</span>
            <div className="flex items-center gap-2">
              <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>{cycleCount} trades</span>
              <button onClick={() => setExpanded(false)} className="text-[10px]"
                style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>x</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2" style={{ fontSize: 0 }}>
            {logs.length === 0 ? (
              <div className="text-[11px] py-2" style={{ color: "var(--t3)" }}>No activity yet</div>
            ) : (
              logs.map((l, i) => (
                <div key={i} className="flex items-start gap-2 py-0.5">
                  <span className="mono text-[10px] shrink-0" style={{ color: "var(--t3)" }}>{l.time}</span>
                  <span className="text-[10px]" style={{ color: l.color || "var(--t2)" }}>{l.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        {!expanded && (
          <button onClick={() => setExpanded(true)}
            className="px-2 py-1 rounded text-[10px] mono transition-all hover:brightness-110"
            style={{ background: "var(--surface-2)", color: "var(--t3)", border: "1px solid var(--border)" }}>
            {cycleCount > 0 ? `${cycleCount} trades` : "log"}
          </button>
        )}
        <button
          onClick={() => setActive(!active)}
          className="px-4 py-2 rounded-lg text-[12px] font-semibold transition-all hover:brightness-110"
          style={{
            background: active ? "var(--negative)" : "var(--positive)",
            color: "#fff",
            border: "none",
            boxShadow: active ? "0 0 20px rgba(239,68,68,0.2)" : "0 0 20px rgba(34,197,94,0.2)",
          }}>
          {active ? "Stop Demo" : "Start Demo"}
        </button>
      </div>
    </div>
  );
}
