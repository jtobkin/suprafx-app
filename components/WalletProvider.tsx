"use client";
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";

export interface ProfileData {
  supraAddress: string;
  evmAddress: string | null;
  evmVerified: boolean;
  evmSignature: string | null;
}

interface WalletCtx {
  supraAddress: string | null;
  profile: ProfileData | null;
  isVerified: boolean;
  isDemo: boolean;
  connect: () => Promise<void>;
  demo: () => void;
  disconnect: () => void;
  linkEvmAddress: () => Promise<boolean>;
  sendSepoliaEth: (to: string, valueWei: string) => Promise<string>;
  sendSupraTokens: (to: string, amount: number) => Promise<string>;
  supraShort: string;
  evmShort: string;
}

const Ctx = createContext<WalletCtx>({
  supraAddress: null, profile: null, isVerified: false, isDemo: false,
  connect: async () => {}, demo: () => {}, disconnect: () => {},
  linkEvmAddress: async () => false,
  sendSepoliaEth: async () => "", sendSupraTokens: async () => "",
  supraShort: "", evmShort: "",
});

export function useWallet() { return useContext(Ctx); }

const SEPOLIA_CHAIN_ID = "0xaa36a7";
const SUPRA_TESTNET_CHAIN_ID = "6";

function getSupraProvider(): any {
  if (typeof window === "undefined") return null;
  return (window as any)?.starkey?.supra || null;
}

function getEvmProvider(): any {
  if (typeof window === "undefined") return null;
  const eth = (window as any)?.ethereum;
  if (eth?.isMetaMask) return eth;
  return (window as any)?.starkey?.ethereum || eth || null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [supraAddress, setSupraAddress] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  const isVerified = !!(profile?.supraAddress && profile?.evmVerified);

  // Load profile from API when supra address is set
  const loadProfile = useCallback(async (addr: string) => {
    try {
      const res = await fetch(`/api/link-address?supra=${encodeURIComponent(addr)}`);
      const { link } = await res.json();
      if (link) {
        setProfile({
          supraAddress: addr,
          evmAddress: link.evm_address,
          evmVerified: !!link.evm_verified_at,
          evmSignature: link.evm_signature,
        });
      } else {
        setProfile({ supraAddress: addr, evmAddress: null, evmVerified: false, evmSignature: null });
      }
    } catch {
      setProfile({ supraAddress: addr, evmAddress: null, evmVerified: false, evmSignature: null });
    }
  }, []);

  // Connect StarKey (Supra only)
  const connect = useCallback(async () => {
    const supra = getSupraProvider();
    if (!supra) {
      alert("StarKey wallet not detected. Please install StarKey to use SupraFX.");
      return;
    }

    try {
      const resp = await supra.connect();
      const acc = Array.isArray(resp) ? resp : await supra.account();
      if (acc?.[0]) {
        const addr = acc[0];
        setSupraAddress(addr);
        setIsDemo(false);
        try { await supra.changeNetwork({ chainId: SUPRA_TESTNET_CHAIN_ID }); } catch {}
        await loadProfile(addr);

        // Register agent
        await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress: addr, role: "taker", domain: `agent-${addr.slice(0, 8)}` }),
        });
      }
    } catch (e: any) {
      console.error("StarKey connect error:", e);
      alert("Failed to connect StarKey. Please try again.");
    }
  }, [loadProfile]);

  const demo = useCallback(() => {
    const addr = "demo_" + Math.random().toString(16).slice(2, 14);
    setSupraAddress(addr);
    setIsDemo(true);
    setProfile({
      supraAddress: addr,
      evmAddress: "0xdemo" + addr.slice(5),
      evmVerified: true,
      evmSignature: null,
    });
    fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: addr, role: "taker", domain: "demo-user" }),
    });
  }, []);

  const disconnect = useCallback(() => {
    const supra = getSupraProvider();
    if (supra) supra.disconnect?.();
    setSupraAddress(null);
    setProfile(null);
    setIsDemo(false);
  }, []);

  // Link & verify EVM address via MetaMask signature
  const linkEvmAddress = useCallback(async (): Promise<boolean> => {
    if (!supraAddress) return false;

    const evm = getEvmProvider();
    if (!evm) {
      alert("MetaMask not detected. Please install MetaMask to link your EVM address.");
      return false;
    }

    try {
      // Request accounts
      const accounts = await evm.request({ method: "eth_requestAccounts" });
      const evmAddr = accounts[0];
      if (!evmAddr) return false;

      // Switch to Sepolia
      try {
        await evm.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID }] });
      } catch (switchErr: any) {
        if (switchErr.code === 4902) {
          await evm.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId: SEPOLIA_CHAIN_ID, chainName: "Sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://rpc.sepolia.org"], blockExplorerUrls: ["https://sepolia.etherscan.io"] }],
          });
        }
      }

      // Sign verification message
      const message = `SupraFX: Link EVM address ${evmAddr.toLowerCase()} to Supra account ${supraAddress}`;
      const signature = await evm.request({ method: "personal_sign", params: [message, evmAddr] });

      // Submit to API for server-side verification
      const res = await fetch("/api/link-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supraAddress, evmAddress: evmAddr, signature }),
      });

      const data = await res.json();
      if (data.verified) {
        setProfile({
          supraAddress,
          evmAddress: evmAddr.toLowerCase(),
          evmVerified: true,
          evmSignature: signature,
        });
        return true;
      } else {
        alert("Verification failed: " + (data.error || "unknown error"));
        return false;
      }
    } catch (e: any) {
      if (e.code === 4001) return false; // User rejected
      console.error("EVM link error:", e);
      alert("Failed to link EVM address: " + (e.message || e));
      return false;
    }
  }, [supraAddress]);

  // Send ETH on Sepolia
  const sendSepoliaEth = useCallback(async (to: string, valueWei: string): Promise<string> => {
    const evm = getEvmProvider();
    const from = profile?.evmAddress;
    if (!evm || !from) throw new Error("No verified EVM address");
    try { await evm.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID }] }); } catch {}
    return await evm.request({ method: "eth_sendTransaction", params: [{ from, to, value: valueWei, gas: "0x5208" }] });
  }, [profile]);

  // Send SUPRA tokens via StarKey
  const sendSupraTokens = useCallback(async (to: string, amount: number): Promise<string> => {
    const supra = getSupraProvider();
    if (!supra || !supraAddress) throw new Error("No Supra wallet connected");

    try { await supra.changeNetwork({ chainId: SUPRA_TESTNET_CHAIN_ID }); } catch {}

    const recipientHex = to.startsWith("0x") ? to.slice(2) : to;
    const amountOctas = Math.floor(amount * 100000000);
    const txExpiryTime = Math.ceil(Date.now() / 1000) + 30;

    const rawTxPayload = [
      supraAddress, 0,
      "0000000000000000000000000000000000000000000000000000000000000001",
      "supra_account", "transfer", [],
      [hexToBytes(recipientHex), uint64ToBytes(amountOctas)],
      { txExpiryTime: BigInt(txExpiryTime) },
    ];

    const data = await supra.createRawTransactionData(rawTxPayload);
    if (!data) throw new Error("Failed to create Supra transaction data");
    const txHash = await supra.sendTransaction({ data });
    if (!txHash) throw new Error("Supra transaction failed");
    return typeof txHash === "string" ? txHash : JSON.stringify(txHash);
  }, [supraAddress]);

  const supraShort = supraAddress ? supraAddress.slice(0, 6) + "…" + supraAddress.slice(-4) : "";
  const evmShort = profile?.evmAddress ? profile.evmAddress.slice(0, 6) + "…" + profile.evmAddress.slice(-4) : "";

  return (
    <Ctx.Provider value={{
      supraAddress, profile, isVerified, isDemo,
      connect, demo, disconnect, linkEvmAddress,
      sendSepoliaEth, sendSupraTokens,
      supraShort, evmShort,
    }}>
      {children}
    </Ctx.Provider>
  );
}

function hexToBytes(hex: string): Uint8Array {
  const padded = hex.padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(padded.substr(i * 2, 2), 16);
  return bytes;
}

function uint64ToBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let val = BigInt(n);
  for (let i = 0; i < 8; i++) { bytes[i] = Number(val & BigInt(0xff)); val >>= BigInt(8); }
  return bytes;
}
