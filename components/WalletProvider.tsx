"use client";
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";

export interface LinkedAddress {
  chain: string;
  address: string;
  walletProvider: string;
  verifiedAt: string;
}

export interface ProfileData {
  supraAddress: string;
  evmAddress: string | null;       // primary EVM (first linked)
  evmVerified: boolean;            // has at least one EVM linked
  evmSignature: string | null;
  linkedAddresses: LinkedAddress[];
}

interface WalletCtx {
  supraAddress: string | null;
  profile: ProfileData | null;
  isVerified: boolean;
  isDemo: boolean;
  connect: () => Promise<void>;
  demo: () => void;
  disconnect: () => void;
  linkEvmAddress: (provider?: "metamask" | "starkey") => Promise<boolean>;
  sendSepoliaEth: (to: string, valueWei: string) => Promise<string>;
  sendSupraTokens: (to: string, amount: number) => Promise<string>;
  supraShort: string;
  evmShort: string;
}

const Ctx = createContext<WalletCtx>({
  supraAddress: null, profile: null, isVerified: false, isDemo: false,
  connect: async () => {}, demo: () => {}, disconnect: () => {},
  linkEvmAddress: async (_provider?: "metamask" | "starkey") => false,
  sendSepoliaEth: async () => "", sendSupraTokens: async () => "",
  supraShort: "", evmShort: "",
});

export function useWallet() { return useContext(Ctx); }

const SEPOLIA_CHAIN_ID = "0xaa36a7";
const SUPRA_TESTNET_CHAIN_ID = "6";

// EIP-6963: Multi-wallet discovery
// Wallets announce themselves via events, bypassing window.ethereum conflicts
const discoveredProviders: Map<string, any> = new Map();

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (event: any) => {
    const info = event.detail?.info;
    const provider = event.detail?.provider;
    if (info && provider) {
      discoveredProviders.set(info.rdns || info.name, { info, provider });
      console.log("[SupraFX] Discovered wallet:", info.name, info.rdns);
    }
  });
  // Request announcements from all installed wallets
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

function getMetaMaskProvider(): any {
  // Method 1: EIP-6963 discovery (most reliable)
  const mmEntry = discoveredProviders.get("io.metamask") 
    || Array.from(discoveredProviders.values()).find(e => 
      e.info?.rdns?.includes("metamask") || e.info?.name?.toLowerCase().includes("metamask")
    );
  if (mmEntry?.provider) return mmEntry.provider;

  // Method 2: providers array
  const win = window as any;
  if (win.ethereum?.providers?.length) {
    const found = win.ethereum.providers.find((p: any) =>
      p.isMetaMask && p !== win.starkey?.ethereum && !p.isStarKey
    );
    if (found) return found;
  }

  // Method 3: window.ethereum if it's genuinely MetaMask
  if (win.ethereum?.isMetaMask && win.ethereum !== win.starkey?.ethereum && win.ethereum?._metamask) {
    return win.ethereum;
  }

  return null;
}

function getSupraProvider(): any {
  if (typeof window === "undefined") return null;
  return (window as any)?.starkey?.supra || null;
}

function getEvmProvider(): any {
  if (typeof window === "undefined") return null;
  // Prefer MetaMask via EIP-6963 for actual transactions
  const mm = getMetaMaskProvider();
  if (mm) return mm;
  // Fall back to StarKey EVM or whatever is available
  return (window as any)?.starkey?.ethereum || (window as any)?.ethereum || null;
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
      const { link, links } = await res.json();
      const linkedAddresses: LinkedAddress[] = (links || []).map((l: any) => ({
        chain: l.chain,
        address: l.linked_address,
        walletProvider: l.wallet_provider,
        verifiedAt: l.verified_at,
      }));
      if (link) {
        setProfile({
          supraAddress: addr,
          evmAddress: link.evm_address,
          evmVerified: !!link.evm_verified_at,
          evmSignature: link.evm_signature,
          linkedAddresses,
        });
      } else {
        setProfile({ supraAddress: addr, evmAddress: null, evmVerified: false, evmSignature: null, linkedAddresses });
      }
    } catch {
      setProfile({ supraAddress: addr, evmAddress: null, evmVerified: false, evmSignature: null, linkedAddresses: [] });
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
      linkedAddresses: [{ chain: "sepolia", address: "0xdemo" + addr.slice(5), walletProvider: "demo", verifiedAt: new Date().toISOString() }],
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

  // Link & verify EVM address via wallet signature
  const linkEvmAddress = useCallback(async (provider: "metamask" | "starkey" = "metamask"): Promise<boolean> => {
    if (!supraAddress) return false;

    let evm: any;
    if (provider === "starkey") {
      evm = (window as any)?.starkey?.ethereum;
      if (!evm) {
        alert("StarKey EVM provider not found. Make sure StarKey is installed and unlocked.");
        return false;
      }
    } else {
      // Find the real MetaMask using EIP-6963 discovery + fallbacks
      evm = getMetaMaskProvider();
      if (!evm) {
        alert("MetaMask not detected. Please make sure MetaMask is installed, unlocked, and try refreshing the page.");
        return false;
      }
      console.log("[SupraFX] Using MetaMask provider:", evm);
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
      const hexMsg = "0x" + Array.from(new TextEncoder().encode(message), b => b.toString(16).padStart(2, "0")).join("");
      let signature: string | null = null;

      // Try multiple approaches — wallets differ on param order and message encoding
      const attempts = [
        { method: "personal_sign", params: [hexMsg, evmAddr], label: "personal_sign (hex, msg-first)" },
        { method: "personal_sign", params: [evmAddr, hexMsg], label: "personal_sign (hex, addr-first)" },
        { method: "personal_sign", params: [message, evmAddr], label: "personal_sign (string, msg-first)" },
        { method: "personal_sign", params: [evmAddr, message], label: "personal_sign (string, addr-first)" },
      ];

      for (const attempt of attempts) {
        try {
          console.log("[SupraFX] Trying:", attempt.label);
          signature = await evm.request({ method: attempt.method, params: attempt.params });
          if (signature) {
            console.log("[SupraFX] Success with:", attempt.label);
            break;
          }
        } catch (e: any) {
          if (e.code === 4001 || e.message?.includes("rejected")) {
            return false; // User rejected — stop trying
          }
          console.warn("[SupraFX]", attempt.label, "failed:", e.message);
          continue;
        }
      }

      if (!signature) {
        alert("Wallet did not return a signature. Please try a different wallet option.");
        return false;
      }

      // Submit to API for server-side verification
      const res = await fetch("/api/link-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supraAddress, evmAddress: evmAddr, signature, walletProvider: provider, chain: "sepolia" }),
      });

      const data = await res.json();
      if (data.verified) {
        // Reload full profile to get updated linked addresses
        await loadProfile(supraAddress);
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
    if (!supra) throw new Error("StarKey wallet not found. Is the extension installed?");
    if (!supraAddress) throw new Error("Supra wallet not connected");

    console.log("[SupraFX] sendSupraTokens: to=" + to + " amount=" + amount);

    // Ensure testnet
    try {
      await supra.changeNetwork({ chainId: SUPRA_TESTNET_CHAIN_ID });
      console.log("[SupraFX] Network switched to testnet");
    } catch (e) {
      console.warn("[SupraFX] changeNetwork failed (may already be on testnet):", e);
    }

    const recipientHex = to.startsWith("0x") ? to.slice(2) : to;
    const amountOctas = Math.floor(amount * 100000000);
    const txExpiryTime = Math.ceil(Date.now() / 1000) + 300; // 5 min expiry

    console.log("[SupraFX] Recipient hex:", recipientHex.slice(0, 12) + "...");
    console.log("[SupraFX] Amount octas:", amountOctas);

    // Try the direct sendTransaction approach first (simpler, works on newer StarKey)
    try {
      console.log("[SupraFX] Attempting sendTransaction with transfer params...");
      const txParams = {
        from: supraAddress,
        to: to,
        value: amountOctas.toString(),
      };
      const txHash = await supra.sendTransaction(txParams);
      if (txHash) {
        console.log("[SupraFX] Direct send succeeded:", txHash);
        return typeof txHash === "string" ? txHash : JSON.stringify(txHash);
      }
    } catch (e: any) {
      console.log("[SupraFX] Direct send not supported, trying raw TX:", e?.message || e);
    }

    // Fallback: raw transaction payload approach
    console.log("[SupraFX] Building raw transaction payload...");
    const rawTxPayload = [
      supraAddress, 0,
      "0000000000000000000000000000000000000000000000000000000000000001",
      "supra_account", "transfer", [],
      [hexToBytes(recipientHex), uint64ToBytes(amountOctas)],
      { txExpiryTime: BigInt(txExpiryTime) },
    ];

    console.log("[SupraFX] Calling createRawTransactionData...");
    const data = await supra.createRawTransactionData(rawTxPayload);
    if (!data) throw new Error("Failed to create Supra transaction data — wallet returned null");
    
    console.log("[SupraFX] Raw TX data created, calling sendTransaction...");
    const txHash = await supra.sendTransaction({ data });
    if (!txHash) throw new Error("Supra transaction rejected or failed");
    
    console.log("[SupraFX] TX hash:", txHash);
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
