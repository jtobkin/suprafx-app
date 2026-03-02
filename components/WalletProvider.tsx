"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface WalletCtx {
  address: string | null;
  connect: () => Promise<void>;
  demo: () => void;
  disconnect: () => void;
  short: string;
}

const Ctx = createContext<WalletCtx>({
  address: null,
  connect: async () => {},
  demo: () => {},
  disconnect: () => {},
  short: "",
});

export function useWallet() { return useContext(Ctx); }

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);

  const connect = useCallback(async () => {
    const p = typeof window !== "undefined" && (window as any)?.starkey?.supra;
    if (p) {
      try {
        await p.connect();
        const acc = await p.account();
        const addr = acc?.[0] || "connected";
        setAddress(addr);
        // Register agent
        await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress: addr, role: "taker" }),
        });
      } catch {
        alert("StarKey connection failed. Make sure the extension is installed.");
      }
    } else {
      alert("StarKey not detected. Install from starkey.app or use demo mode.");
    }
  }, []);

  const demo = useCallback(() => {
    const addr = "demo_" + Math.random().toString(16).slice(2, 14);
    setAddress(addr);
    fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: addr, role: "taker", domain: "demo-user" }),
    });
  }, []);

  const disconnect = useCallback(() => {
    const p = typeof window !== "undefined" && (window as any)?.starkey?.supra;
    if (p) p.disconnect?.();
    setAddress(null);
  }, []);

  const short = address ? address.slice(0, 6) + "…" + address.slice(-4) : "";

  return (
    <Ctx.Provider value={{ address, connect, demo, disconnect, short }}>
      {children}
    </Ctx.Provider>
  );
}
