"use client";
import { useState } from "react";
import { useWallet } from "./WalletProvider";

export default function SubmitRFQ({ onSubmitted }: { onSubmitted?: () => void }) {
  const { address } = useWallet();
  const [pair, setPair] = useState("ETH/USDC");
  const [size, setSize] = useState("");
  const [slip, setSlip] = useState("0.5");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

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
        setResult({ ok: false, msg: data.error });
      } else {
        setResult({ ok: true, msg: data.rfq.display_id + " submitted" });
        setSize("");
        onSubmitted?.();
        setTimeout(() => setResult(null), 4000);
      }
    } catch (e: any) {
      setResult({ ok: false, msg: e.message });
    }
    setLoading(false);
  };

  const inputStyle = {
    background: "var(--bg)",
    borderColor: "var(--border)",
    color: "var(--t0)",
  };

  return (
    <div className="rounded border overflow-hidden mb-4 animate-in"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <span className="text-[11px] font-medium" style={{ color: "var(--t1)" }}>New Order</span>
        <span className="font-mono text-[9px]" style={{ color: "var(--t3)" }}>
          Sepolia → Supra Testnet
        </span>
      </div>
      <div className="px-4 py-3">
        <div className="flex items-end gap-2.5">
          <div className="w-32">
            <label className="block font-mono text-[9px] uppercase tracking-wider mb-1" style={{ color: "var(--t3)" }}>Pair</label>
            <select value={pair} onChange={e => setPair(e.target.value)}
              className="w-full px-2.5 py-[7px] rounded border text-[12px] font-mono outline-none"
              style={inputStyle}>
              <option value="ETH/USDC">ETH/USDC</option>
              <option value="BTC/USDC">BTC/USDC</option>
              <option value="SUPRA/USDC">SUPRA/USDC</option>
            </select>
          </div>
          <div className="w-36">
            <label className="block font-mono text-[9px] uppercase tracking-wider mb-1" style={{ color: "var(--t3)" }}>Size</label>
            <input type="number" step="0.01" min="0" placeholder="0.00" value={size}
              onChange={e => setSize(e.target.value)}
              className="w-full px-2.5 py-[7px] rounded border text-[12px] font-mono outline-none"
              style={inputStyle} />
          </div>
          <div className="w-24">
            <label className="block font-mono text-[9px] uppercase tracking-wider mb-1" style={{ color: "var(--t3)" }}>Slip %</label>
            <input type="number" step="0.1" min="0" value={slip}
              onChange={e => setSlip(e.target.value)}
              className="w-full px-2.5 py-[7px] rounded border text-[12px] font-mono outline-none"
              style={inputStyle} />
          </div>
          <button onClick={submit} disabled={loading || !size}
            className="px-5 py-[7px] rounded text-[11px] font-semibold transition-all disabled:opacity-30"
            style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
            {loading ? "…" : "Submit"}
          </button>
          {result && (
            <div className="flex items-center gap-1.5 ml-2">
              <div className="w-1 h-1 rounded-full" style={{ background: result.ok ? "var(--positive)" : "var(--negative)" }} />
              <span className="font-mono text-[10px]" style={{ color: result.ok ? "var(--positive)" : "var(--negative)" }}>
                {result.msg}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
