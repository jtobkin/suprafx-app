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

// Pool of fake maker names for variety
const MAKER_NAMES = [
  "demo-maker-alpha", "demo-maker-bravo", "demo-maker-charlie",
  "demo-maker-delta", "demo-maker-echo", "demo-maker-foxtrot",
  "demo-maker-golf", "demo-maker-hotel",
];

function randomHexAddr(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Random spread: maker quotes between -0.5% and +0.3% of reference
function randomSpread(): number {
  return (Math.random() * 0.8 - 0.5) / 100; // -0.005 to +0.003
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
  const timersRef = useRef<any[]>([]);

  const addLog = useCallback((text: string, color?: string) => {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(prev => [...prev.slice(-40), { time, text, color }]);
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current = [];
  }, []);

  const addTimer = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timersRef.current.push(t);
    return t;
  }, []);

  const runCycle = useCallback(async () => {
    try {
      // === STEP 1: Random taker submits RFQ ===
      const takerAddr = randomHexAddr();
      const makerAddr = randomHexAddr();
      const makerName = pick(MAKER_NAMES);
      const pairConfig = pick(DEMO_PAIRS);
      const size = pick(pairConfig.sizes);

      addLog(`Taker ${takerAddr.slice(0, 10)}... submitting RFQ`);
      addLog(`${pairConfig.pair} x ${size}`);

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

      const rfqId = rfqData.rfq.id;
      const refPrice = rfqData.rfq.takerPrice || rfqData.rfq.referencePrice || 0;
      addLog(`RFQ ${rfqData.rfq.displayId} created`, "var(--accent-light)");
      onActivity?.();

      // === STEP 2: After 5s, demo maker places a quote ===
      addTimer(async () => {
        try {
          const spread = randomSpread();
          const makerRate = refPrice * (1 + spread);
          const spreadBps = (spread * 10000).toFixed(0);

          addLog(`Maker ${makerName} quoting at ${makerRate.toFixed(4)} (${Number(spreadBps) >= 0 ? "+" : ""}${spreadBps}bps)`);

          const quoteRes = await fetch("/api/skill/suprafx", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "place_quote",
              rfqId,
              makerAddress: makerAddr,
              rate: String(makerRate),
            }),
          });
          const quoteData = await quoteRes.json();

          if (quoteData.error) {
            addLog("Quote failed: " + quoteData.error, "var(--warn)");
            // Fall back to accepting the SupraFX bot quote
            addLog("Falling back to SupraFX Bot quote...", "var(--t3)");
          } else {
            addLog(`Quote placed by ${makerName}`, "var(--accent-light)");
          }
          onActivity?.();

          // === STEP 3: After another 5s, taker accepts best quote ===
          addTimer(async () => {
            try {
              addLog("Taker looking for best quote...");

              const { createClient } = await import("@supabase/supabase-js");
              const sb = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
              );

              const { data: quotes } = await sb
                .from("quotes")
                .select("id, maker_address, rate, status")
                .eq("rfq_id", rfqId)
                .eq("status", "pending")
                .order("rate", { ascending: false });

              if (!quotes || quotes.length === 0) {
                addLog("No pending quotes, skipping", "var(--warn)");
                return;
              }

              // Prefer the demo maker's quote, fall back to any
              const demoQuote = quotes.find((q: any) => q.maker_address === makerAddr);
              const bestQuote = demoQuote || quotes[0];
              const quoterName = bestQuote.maker_address === makerAddr ? makerName
                : bestQuote.maker_address === "auto-maker-bot" ? "SupraFX Bot"
                : bestQuote.maker_address.slice(0, 10) + "...";

              addLog(`Accepting ${quoterName} at ${Number(bestQuote.rate).toFixed(4)}`);

              const acceptRes = await fetch("/api/skill/suprafx", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "accept_quote",
                  quoteId: bestQuote.id,
                  agentAddress: takerAddr,
                }),
              });
              const acceptData = await acceptRes.json();

              if (acceptData.error) {
                addLog("Accept failed: " + acceptData.error, "var(--negative)");
                return;
              }

              addLog(`Trade ${acceptData.trade?.displayId} created`, "var(--positive)");
              setCycleCount(c => c + 1);
              onActivity?.();

              // === STEP 4: After 3s, taker sends (fake TX) ===
              const tradeId = acceptData.trade?.id;
              if (!tradeId) return;

              addTimer(async () => {
                try {
                  addLog("Taker sending...");
                  const fakeTxHash = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)))
                    .map(b => b.toString(16).padStart(2, "0")).join("");

                  const confirmRes = await fetch("/api/confirm-tx", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tradeId, txHash: fakeTxHash, side: "taker" }),
                  });
                  const confirmData = await confirmRes.json();

                  if (confirmData.status === "settled" || confirmData.autoSettled) {
                    addLog(`Settled in ${(confirmData.settleMs / 1000).toFixed(1)}s`, "var(--positive)");
                  } else if (confirmData.verified) {
                    addLog("Taker verified, waiting for maker...", "var(--accent-light)");

                    // === STEP 5: If maker is our demo maker (not the SupraFX bot), send maker TX too ===
                    if (bestQuote.maker_address === makerAddr) {
                      addTimer(async () => {
                        try {
                          addLog(`${makerName} sending...`);
                          const makerTxHash = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)))
                            .map(b => b.toString(16).padStart(2, "0")).join("");

                          const makerConfirm = await fetch("/api/confirm-tx", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ tradeId, txHash: makerTxHash, side: "maker" }),
                          });
                          const makerData = await makerConfirm.json();

                          if (makerData.status === "settled") {
                            addLog(`Settled in ${(makerData.settleMs / 1000).toFixed(1)}s`, "var(--positive)");
                          } else if (makerData.verified) {
                            addLog("Maker verified", "var(--positive)");
                          } else {
                            addLog("Maker TX: " + (makerData.status || "submitted"), "var(--t2)");
                          }
                          onActivity?.();
                        } catch (e: any) {
                          addLog("Maker send error: " + e.message, "var(--negative)");
                        }
                      }, 3000);
                    }
                    // If SupraFX bot is maker, it auto-settles via confirm-tx
                  } else {
                    addLog("TX submitted: " + (confirmData.status || "pending"), "var(--t2)");
                  }
                  onActivity?.();
                } catch (e: any) {
                  addLog("Taker send error: " + e.message, "var(--negative)");
                }
              }, 3000);

            } catch (e: any) {
              addLog("Accept error: " + e.message, "var(--negative)");
            }
          }, 5000);

        } catch (e: any) {
          addLog("Quote error: " + e.message, "var(--negative)");
        }
      }, 5000);

    } catch (e: any) {
      addLog("Cycle error: " + e.message, "var(--negative)");
    }
  }, [addLog, addTimer, onActivity]);

  useEffect(() => {
    if (active) {
      addLog("Demo started", "var(--positive)");
      runCycle();
      intervalRef.current = setInterval(runCycle, 30000);
    } else {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      clearTimers();
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearTimers();
    };
  }, [active, runCycle, clearTimers]);

  return (
    <div className="fixed bottom-5 right-5 z-50" style={{ maxWidth: expanded ? "380px" : "auto" }}>
      {expanded && (
        <div className="card mb-2 animate-slide-down" style={{ maxHeight: "300px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div className="card-header">
            <span className="text-[12px] font-semibold" style={{ color: "var(--t1)" }}>Demo Activity</span>
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
