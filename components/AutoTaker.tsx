"use client";
import { useState, useEffect, useRef, useCallback } from "react";

const MAX_CYCLES = 10;

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
  { pair: "iUSDC/SUPRA", sizes: [100, 500, 1000, 5000] },
  { pair: "iUSDT/SUPRA", sizes: [100, 500, 1000, 5000] },
  { pair: "iETH/SUPRA", sizes: [0.5, 1, 2, 5] },
  { pair: "iBTC/SUPRA", sizes: [0.01, 0.05, 0.1, 0.5] },
  { pair: "iETH/iUSDC", sizes: [0.1, 0.5, 1, 2] },
  { pair: "iBTC/iUSDC", sizes: [0.01, 0.05, 0.1] },
  { pair: "iUSDC/iUSDT", sizes: [100, 500, 1000] },
];

const DEMO_MAKER_ADDR = "0x02af04c537a6aa319a6704229894fbdc54cdfcae0202c12afaa21efa0831343a";
const DEMO_MAKER_NAME = "SupraFX Bot";

const MAKER_NAMES = [
  "SupraFX Bot",
];

function randomHexAddr(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomSpread(): number {
  return (Math.random() * 0.8 - 0.5) / 100;
}

interface LogEntry { time: string; text: string; color?: string; }

export default function AutoTaker() {
  const [active, setActive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [cycleCount, setCycleCount] = useState(0);
  const cycleCountRef = useRef(0);
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

  const stopDemo = useCallback(() => {
    setActive(false);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    clearTimers();
  }, [clearTimers]);

  const runCycle = useCallback(async () => {
    // Check limit
    if (cycleCountRef.current >= MAX_CYCLES) {
      addLog(`Reached ${MAX_CYCLES} trades limit, stopping`, "var(--warn)");
      stopDemo();
      return;
    }

    try {
      const takerAddr = randomHexAddr();
      const makerAddr = DEMO_MAKER_ADDR;
      const makerName = DEMO_MAKER_NAME;
      const pairConfig = pick(DEMO_PAIRS);
      const size = pick(pairConfig.sizes);

      addLog(`Taker ${takerAddr.slice(0, 10)}... submitting RFQ`);
      addLog(`${pairConfig.pair} x ${size}`);

      const rfqRes = await fetch("/api/skill/suprafx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit_rfq", agentAddress: takerAddr, pair: pairConfig.pair, size: String(size) }),
      });
      const rfqData = await rfqRes.json();

      if (rfqData.error) { addLog("RFQ failed: " + rfqData.error, "var(--negative)"); return; }

      const rfqId = rfqData.rfq.id;
      const refPrice = rfqData.rfq.takerPrice || rfqData.rfq.referencePrice || 0;
      addLog(`RFQ ${rfqData.rfq.displayId} created`, "var(--accent-light)");

      // Step 2: Demo maker quotes after 5s
      addTimer(async () => {
        try {
          const spread = randomSpread();
          const makerRate = refPrice * (1 + spread);
          const spreadBps = (spread * 10000).toFixed(0);
          addLog(`Maker ${makerName} quoting (${Number(spreadBps) >= 0 ? "+" : ""}${spreadBps}bps)`);

          const quoteRes = await fetch("/api/skill/suprafx", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "place_quote", rfqId, makerAddress: makerAddr, rate: String(makerRate) }),
          });
          const quoteData = await quoteRes.json();
          if (quoteData.error) addLog("Quote: " + quoteData.error, "var(--warn)");
          else addLog(`Quote placed by ${makerName}`, "var(--accent-light)");

          // Step 3: Taker accepts after another 5s
          addTimer(async () => {
            try {
              const { createClient } = await import("@supabase/supabase-js");
              const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

              const { data: quotes } = await sb.from("quotes").select("id, maker_address, rate, status")
                .eq("rfq_id", rfqId).eq("status", "pending").order("rate", { ascending: false });

              if (!quotes || quotes.length === 0) { addLog("No quotes, skipping", "var(--warn)"); return; }

              const demoQuote = quotes.find((q: any) => q.maker_address === makerAddr);
              const bestQuote = demoQuote || quotes[0];
              const quoterName = bestQuote.maker_address === makerAddr ? makerName
                : bestQuote.maker_address === "auto-maker-bot" ? "SupraFX Bot"
                : bestQuote.maker_address.slice(0, 10) + "...";

              addLog(`Accepting ${quoterName}`);

              const acceptRes = await fetch("/api/skill/suprafx", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "accept_quote", quoteId: bestQuote.id, agentAddress: takerAddr }),
              });
              const acceptData = await acceptRes.json();

              if (acceptData.error) { addLog("Accept: " + acceptData.error, "var(--negative)"); return; }

              // Increment counter
              cycleCountRef.current += 1;
              setCycleCount(cycleCountRef.current);
              addLog(`Trade ${acceptData.trade?.displayId} (${cycleCountRef.current}/${MAX_CYCLES})`, "var(--positive)");

              const tradeId = acceptData.trade?.id;
              const tradeChain = acceptData.trade?.dest_chain || "sepolia";
              if (!tradeId) return;

              // Step 4: Taker sends after 3s (simulated)
              addTimer(async () => {
                try {
                  addLog("Taker sending...");
                  const fakeTx = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");

                  const confirmData = await fetch("/api/confirm-tx", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tradeId, txHash: fakeTx, side: "taker" }),
                  }).then(r => r.json());

                  if (confirmData.status === "settled" || confirmData.autoSettled) {
                    addLog(`Settled in ${(confirmData.settleMs / 1000).toFixed(1)}s`, "var(--positive)");
                  } else if (confirmData.verified) {
                    addLog("Taker verified", "var(--accent-light)");
                    // Step 5: Maker settles via bot-settle API (real TX on Sepolia)
                    addTimer(async () => {
                      try {
                        addLog(`${DEMO_MAKER_NAME} settling on ${tradeChain}...`);
                        const botRes = await fetch("/api/bot-settle", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            tradeId,
                            side: "maker",
                            chain: tradeChain,
                            recipientAddress: takerAddr,
                          }),
                        }).then(r => r.json());

                        if (botRes.error) {
                          addLog("Maker settle error: " + botRes.error, "var(--negative)");
                        } else if (botRes.confirm?.status === "settled") {
                          addLog(`Settled in ${(botRes.confirm.settleMs / 1000).toFixed(1)}s`, "var(--positive)");
                        } else if (botRes.confirm?.verified) {
                          addLog(`Maker TX verified: ${botRes.txHash.slice(0, 16)}...`, "var(--accent-light)");
                        } else {
                          addLog(`Maker TX: ${botRes.txHash?.slice(0, 16)}... (${botRes.confirm?.status || "submitted"})`, "var(--t2)");
                        }
                      } catch (e: any) { addLog("Maker settle error: " + e.message, "var(--negative)"); }
                    }, 3000);
                  } else {
                    addLog("TX: " + (confirmData.status || "pending"), "var(--t2)");
                  }
                } catch (e: any) { addLog("Send error: " + e.message, "var(--negative)"); }
              }, 3000);

            } catch (e: any) { addLog("Accept error: " + e.message, "var(--negative)"); }
          }, 5000);

        } catch (e: any) { addLog("Quote error: " + e.message, "var(--negative)"); }
      }, 5000);

    } catch (e: any) { addLog("Cycle error: " + e.message, "var(--negative)"); }
  }, [addLog, addTimer, stopDemo]);

  useEffect(() => {
    if (active) {
      cycleCountRef.current = 0;
      setCycleCount(0);
      addLog("Initializing bot...", "var(--t2)");
      // Ensure bot maker is registered with linked addresses + vault
      fetch("/api/bot-init", { method: "POST" }).then(r => r.json()).then(d => {
        addLog("Bot ready: " + (d.results || []).join(", "), "var(--accent-light)");
        addLog("Demo started (max " + MAX_CYCLES + " trades)", "var(--positive)");
        runCycle();
        intervalRef.current = setInterval(runCycle, 30000);
      }).catch(e => {
        addLog("Bot init failed: " + e.message, "var(--negative)");
      });
    } else {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      clearTimers();
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearTimers();
    };
  }, [active, runCycle, clearTimers, addLog]);

  return (
    <div className="fixed bottom-5 right-5 z-50" style={{ maxWidth: expanded ? "380px" : "auto" }}>
      {expanded && (
        <div className="card mb-2 animate-slide-down" style={{ maxHeight: "300px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div className="card-header">
            <span className="text-[12px] font-semibold" style={{ color: "var(--t1)" }}>Demo Activity</span>
            <div className="flex items-center gap-2">
              <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>{cycleCount}/{MAX_CYCLES}</span>
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
        {!expanded && active && (
          <button onClick={() => setExpanded(true)}
            className="px-2 py-1 text-[10px] mono transition-all hover:brightness-110"
            style={{ background: "var(--surface-2)", color: "var(--t3)", border: "1px solid var(--border)" }}>
            {cycleCount}/{MAX_CYCLES}
          </button>
        )}
        <button
          onClick={() => { if (active) stopDemo(); else setActive(true); }}
          className="px-4 py-2 text-[12px] font-semibold transition-all hover:brightness-110"
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
