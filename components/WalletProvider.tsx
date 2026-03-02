"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from "react";

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
}

const Ctx = createContext<WalletCtx>({
  address: null,
  evmAddress: null,
  connect: async () => {},
  demo: () => {},
  disconnect: () => {},
  short: "",
  evmShort: "",
  isDemo: false,
  sendSepoliaEth: async () => "",
});

export function useWallet() { return useContext(Ctx); }

const SEPOLIA_CHAIN_ID = "0xaa36a7"; // 11155111

async function switchToSepolia(provider: any) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID }] });
  } catch (switchError: any) {
    if (switchError.code === 4902) {
      await provider.request({
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

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  const connect = useCallback(async () => {
    // Try StarKey EVM first, then Supra, then MetaMask
    const starkeyEvm = typeof window !== "undefined" && (window as any)?.starkey?.ethereum;
    const starkeyMovevm = typeof window !== "undefined" && (window as any)?.starkey?.supra;
    const metamask = typeof window !== "undefined" && (window as any)?.ethereum;

    let evmAddr: string | null = null;
    let supraAddr: string | null = null;

    // Connect EVM (StarKey or MetaMask)
    const evmProvider = starkeyEvm || metamask;
    if (evmProvider) {
      try {
        const accounts = await evmProvider.request({ method: "eth_requestAccounts" });
        evmAddr = accounts?.[0] || null;
        if (evmAddr) {
          await switchToSepolia(evmProvider);
          setEvmAddress(evmAddr);
        }
      } catch (e) {
        console.warn("EVM connect failed:", e);
      }
    }

    // Also connect Supra if available
    if (starkeyMovevm) {
      try {
        await starkeyMovevm.connect();
        const acc = await starkeyMovevm.account();
        supraAddr = acc?.[0] || null;
      } catch (e) {
        console.warn("Supra connect failed:", e);
      }
    }

    const primaryAddr = evmAddr || supraAddr;
    if (primaryAddr) {
      setAddress(primaryAddr);
      setIsDemo(false);
      // Register agent
      await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: primaryAddr,
          role: "taker",
          domain: `agent-${primaryAddr.slice(0, 6)}`,
        }),
      });
    } else {
      alert("No wallet detected. Install StarKey (starkey.app) or MetaMask, or use demo mode.");
    }
  }, []);

  const demo = useCallback(() => {
    const addr = "demo_" + Math.random().toString(16).slice(2, 14);
    setAddress(addr);
    setEvmAddress(null);
    setIsDemo(true);
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
    setEvmAddress(null);
    setIsDemo(false);
  }, []);

  const sendSepoliaEth = useCallback(async (to: string, valueWei: string): Promise<string> => {
    const evmProvider = typeof window !== "undefined" && ((window as any)?.starkey?.ethereum || (window as any)?.ethereum);
    if (!evmProvider || !evmAddress) {
      throw new Error("No EVM wallet connected");
    }

    // Ensure on Sepolia
    await switchToSepolia(evmProvider);

    // Send transaction
    const txHash = await evmProvider.request({
      method: "eth_sendTransaction",
      params: [{
        from: evmAddress,
        to,
        value: valueWei,
        gas: "0x5208", // 21000
      }],
    });

    return txHash;
  }, [evmAddress]);

  const short = address ? address.slice(0, 6) + "…" + address.slice(-4) : "";
  const evmShort = evmAddress ? evmAddress.slice(0, 6) + "…" + evmAddress.slice(-4) : "";

  return (
    <Ctx.Provider value={{ address, evmAddress, connect, demo, disconnect, short, evmShort, isDemo, sendSepoliaEth }}>
      {children}
    </Ctx.Provider>
  );
}
