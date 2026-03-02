"use client";
import { useState } from "react";
import { useWallet } from "./WalletProvider";

export default function SubmitRFQ({ onSubmitted }: { onSubmitted?: () => void }) {
  const { address } = useWallet();
  const [pair, setPair] = useState("ETH/USDC");
  const [size, setSize] = useState("");
  const [slip, setSlip] = useState("0.5");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const submit = async () => {
    if (!address || !size || parseFloat(size) <= 0) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/rfq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          takerAddress: address,
          pair,
          size: parseFloat(size),
          sourceChain: "sepolia",
          destChain: "supra-testnet",
          maxSlippage: parseFloat(slip) / 100,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setResult("Error: " + data.error);
      } else {
        setResult("RFQ submitted: " + data.rfq.display_id);
        setSize("");
        onSubmitted?.();
      }
    } catch (e: any) {
      setResult("Error: " + e.message);
    }
    setLoading(false);
  };

  return (
    <div className="border rounded-md overflow-hidden mb-4 animate-in"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex justify-between items-center px-4 py-3 border-b"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <span className="text-xs font-medium" style={{ color: "var(--t1)" }}>Submit RFQ</span>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-4 gap-3 mb-3">
          {/* Pair */}
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider mb-1.5"
              style={{ color: "var(--t3)" }}>Pair</label>
            <select value={pair} onChange={e => setPair(e.target.value)}
              className="w-full px-3 py-2 rounded border text-xs font-mono outline-none transition-colors"
              style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--t0)" }}>
              <option value="ETH/USDC">ETH/USDC</option>
              <option value="BTC/USDC">BTC/USDC</option>
              <option value="SUPRA/USDC">SUPRA/USDC</option>
            </select>
          </div>

          {/* Size */}
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider mb-1.5"
              style={{ color: "var(--t3)" }}>Size</label>
            <input type="number" step="0.01" min="0" placeholder="0.00" value={size}
              onChange={e => setSize(e.target.value)}
              className="w-full px-3 py-2 rounded border text-xs font-mono outline-none transition-colors"
              style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--t0)" }} />
          </div>

          {/* Slippage */}
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider mb-1.5"
              style={{ color: "var(--t3)" }}>Max Slippage %</label>
            <input type="number" step="0.1" min="0" value={slip}
              onChange={e => setSlip(e.target.value)}
              className="w-full px-3 py-2 rounded border text-xs font-mono outline-none transition-colors"
              style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--t0)" }} />
          </div>

          {/* Submit */}
          <div className="flex items-end">
            <button onClick={submit} disabled={loading || !size}
              className="w-full px-4 py-2 rounded border text-xs font-medium transition-all disabled:opacity-40"
              style={{ background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }}>
              {loading ? "Submitting…" : "Submit RFQ"}
            </button>
          </div>
        </div>

        {result && (
          <div className="font-mono text-[11px] px-3 py-2 rounded"
            style={{
              background: result.startsWith("Error") ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
              color: result.startsWith("Error") ? "var(--negative)" : "var(--positive)",
            }}>
            {result}
          </div>
        )}

        <div className="mt-2 font-mono text-[10px]" style={{ color: "var(--t3)" }}>
          Route: Sepolia → Supra Testnet · Wallet: {address?.slice(0, 12)}…
        </div>
      </div>
    </div>
  );
}
