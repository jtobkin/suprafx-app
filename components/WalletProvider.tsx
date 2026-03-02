"use client";
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";

interface WalletCtx {
  address: string | null;
  evmAddress: string | null;
  connect: () => Promise<void>;
  demo: () => void;
  disconnect: () => void;
  short: string;
  evmShort: string;
  isDemo: boolean;
  sendSepoliaEth: (to: string, valueWei: string) => Promise<string>;
  evmProvider: any;
}

const Ctx = createContext<WalletCtx>({
  address: null, evmAddress: null, connect: async () => {}, demo: () => {},
  disconnect: () => {}, short: "", evmShort: "", isDemo: false,
  sendSepoliaEth: async () => "", evmProvider: null,
});

export function useWallet() { return useContext(Ctx); }

const SEPOLIA_CHAIN_ID = "0xaa36a7";

function getEvmProvider(): any {
  if (typeof window === "undefined") return null;
  // StarKey may inject as window.starkey.ethereum or window.ethereum
  return (window as any)?.starkey?.ethereum
    || (window as any)?.ethereum
    || null;
}

function getSupraProvider(): any {
  if (typeof window === "undefined") return null;
  return (window as any)?.starkey?.supra || null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [evmProv, setEvmProv] = useState<any>(null);

  const connect = useCallback(async () => {
    let primaryAddr: string | null = null;
    let evmAddr: string | null = null;

    // 1. Try Supra provider (StarKey MoveVM)
    const supra = getSupraProvider();
    if (supra) {
      try {
        const resp = await supra.connect();
        const acc = Array.isArray(resp) ? resp : await supra.account();
        if (acc?.[0]) {
          primaryAddr = acc[0];
          // If address starts with 0x, it might be EVM-compatible
          if (primaryAddr?.startsWith("0x")) {
            evmAddr = primaryAddr;
          }
        }
      } catch (e) { console.warn("Supra connect error:", e); }
    }

    // 2. Try EVM provider (StarKey EVM or MetaMask)
    const evm = getEvmProvider();
    if (evm) {
      try {
        const accounts = await evm.request({ method: "eth_requestAccounts" });
        if (accounts?.[0]) {
          evmAddr = accounts[0];
          if (!primaryAddr) primaryAddr = evmAddr;
          setEvmProv(evm);

          // Try switching to Sepolia
          try {
            await evm.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID }] });
          } catch (switchErr: any) {
            if (switchErr.code === 4902) {
              await evm.request({
                method: "wallet_addEthereumChain",
                params: [{
                  chainId: SEPOLIA_CHAIN_ID,
                  chainName: "Sepolia Testnet",
                  nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
                  rpcUrls: ["https://rpc.sepolia.org"],
                  blockExplorerUrls: ["https://sepolia.etherscan.io"],
                }],
              });
            }
          }
        }
      } catch (e) { console.warn("EVM connect error:", e); }
    }

    if (primaryAddr) {
      setAddress(primaryAddr);
      setEvmAddress(evmAddr);
      setIsDemo(false);
      await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: primaryAddr, role: "taker", domain: `agent-${primaryAddr.slice(0, 8)}` }),
      });
    } else {
      alert("No wallet detected. Install StarKey (starkey.app) or MetaMask, or use demo mode.");
    }
  }, []);

  const demo = useCallback(() => {
    const addr = "demo_" + Math.random().toString(16).slice(2, 14);
    setAddress(addr);
    setEvmAddress(null);
    setEvmProv(null);
    setIsDemo(true);
    fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: addr, role: "taker", domain: "demo-user" }),
    });
  }, []);

  const disconnect = useCallback(() => {
    const supra = getSupraProvider();
    if (supra) supra.disconnect?.();
    setAddress(null);
    setEvmAddress(null);
    setEvmProv(null);
    setIsDemo(false);
  }, []);

  const sendSepoliaEth = useCallback(async (to: string, valueWei: string): Promise<string> => {
    const evm = evmProv || getEvmProvider();
    const from = evmAddress;
    if (!evm || !from) throw new Error("No EVM wallet connected");

    // Ensure Sepolia
    try {
      await evm.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID }] });
    } catch {}

    const txHash = await evm.request({
      method: "eth_sendTransaction",
      params: [{ from, to, value: valueWei }],
    });
    return txHash;
  }, [evmAddress, evmProv]);

  const short = address ? address.slice(0, 6) + "…" + address.slice(-4) : "";
  const evmShort = evmAddress ? evmAddress.slice(0, 6) + "…" + evmAddress.slice(-4) : "";

  return (
    <Ctx.Provider value={{ address, evmAddress, connect, demo, disconnect, short, evmShort, isDemo, sendSepoliaEth, evmProvider: evmProv }}>
      {children}
    </Ctx.Provider>
  );
}
