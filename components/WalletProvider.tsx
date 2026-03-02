"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface WalletCtx {
  address: string | null;
  evmAddress: string | null;
  supraAddress: string | null;
  connect: () => Promise<void>;
  demo: () => void;
  disconnect: () => void;
  short: string;
  evmShort: string;
  supraShort: string;
  isDemo: boolean;
  sendSepoliaEth: (to: string, valueWei: string) => Promise<string>;
  sendSupraTokens: (to: string, amount: number) => Promise<string>;
}

const Ctx = createContext<WalletCtx>({
  address: null, evmAddress: null, supraAddress: null,
  connect: async () => {}, demo: () => {}, disconnect: () => {},
  short: "", evmShort: "", supraShort: "", isDemo: false,
  sendSepoliaEth: async () => "", sendSupraTokens: async () => "",
});

export function useWallet() { return useContext(Ctx); }

const SEPOLIA_CHAIN_ID = "0xaa36a7";
const SUPRA_TESTNET_CHAIN_ID = "6";

function getEvmProvider(): any {
  if (typeof window === "undefined") return null;
  const ethereum = (window as any)?.ethereum;
  if (ethereum?.isMetaMask) return ethereum;
  return (window as any)?.starkey?.ethereum || ethereum || null;
}

function getSupraProvider(): any {
  if (typeof window === "undefined") return null;
  return (window as any)?.starkey?.supra || null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [supraAddress, setSupraAddress] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [evmProv, setEvmProv] = useState<any>(null);

  const connect = useCallback(async () => {
    let primaryAddr: string | null = null;
    let evmAddr: string | null = null;
    let supraAddr: string | null = null;

    // 1. Connect Supra via StarKey
    const supra = getSupraProvider();
    if (supra) {
      try {
        const resp = await supra.connect();
        const acc = Array.isArray(resp) ? resp : await supra.account();
        if (acc?.[0]) {
          supraAddr = acc[0];
          primaryAddr = supraAddr;
        }
        // Switch to testnet
        try { await supra.changeNetwork({ chainId: SUPRA_TESTNET_CHAIN_ID }); } catch {}
      } catch (e) { console.warn("Supra connect error:", e); }
    }

    // 2. Connect EVM via MetaMask
    const evm = getEvmProvider();
    if (evm) {
      try {
        const accounts = await evm.request({ method: "eth_requestAccounts" });
        if (accounts?.[0]) {
          evmAddr = accounts[0];
          if (!primaryAddr) primaryAddr = evmAddr;
          setEvmProv(evm);
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
        }
      } catch (e) { console.warn("EVM connect error:", e); }
    }

    if (primaryAddr) {
      setAddress(primaryAddr);
      setEvmAddress(evmAddr);
      setSupraAddress(supraAddr);
      setIsDemo(false);
      await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: primaryAddr,
          evmAddress: evmAddr,
          supraAddress: supraAddr,
          role: "taker",
          domain: `agent-${primaryAddr.slice(0, 8)}`,
        }),
      });
    } else {
      alert("No wallet detected. Install StarKey and/or MetaMask, or use demo mode.");
    }
  }, []);

  const demo = useCallback(() => {
    const addr = "demo_" + Math.random().toString(16).slice(2, 14);
    setAddress(addr);
    setEvmAddress(null);
    setSupraAddress(null);
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
    setSupraAddress(null);
    setEvmProv(null);
    setIsDemo(false);
  }, []);

  const sendSepoliaEth = useCallback(async (to: string, valueWei: string): Promise<string> => {
    const evm = evmProv || getEvmProvider();
    const from = evmAddress;
    if (!evm || !from) throw new Error("No EVM wallet connected");
    try { await evm.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID }] }); } catch {}
    return await evm.request({ method: "eth_sendTransaction", params: [{ from, to, value: valueWei, gas: "0x5208" }] });
  }, [evmAddress, evmProv]);

  const sendSupraTokens = useCallback(async (to: string, amount: number): Promise<string> => {
    const supra = getSupraProvider();
    if (!supra || !supraAddress) throw new Error("No Supra wallet connected");

    // Switch to testnet
    try { await supra.changeNetwork({ chainId: SUPRA_TESTNET_CHAIN_ID }); } catch {}

    // Convert recipient address — remove 0x prefix if present
    const recipientHex = to.startsWith("0x") ? to.slice(2) : to;
    
    // Amount in octas (1 SUPRA = 10^8 octas)
    const amountOctas = Math.floor(amount * 100000000);

    const txExpiryTime = Math.ceil(Date.now() / 1000) + 30;

    // Build raw transaction payload for supra_account::transfer
    const rawTxPayload = [
      supraAddress,                                                           // sender
      0,                                                                       // sequence number (auto)
      "0000000000000000000000000000000000000000000000000000000000000001",       // module address
      "supra_account",                                                         // module name
      "transfer",                                                              // function name
      [],                                                                      // type args
      [
        hexToBytes(recipientHex),                                              // recipient address bytes
        uint64ToBytes(amountOctas),                                            // amount in octas
      ],
      { txExpiryTime: BigInt(txExpiryTime) },                                 // optional args
    ];

    const data = await supra.createRawTransactionData(rawTxPayload);
    if (!data) throw new Error("Failed to create Supra transaction data");

    const txHash = await supra.sendTransaction({ data });
    if (!txHash) throw new Error("Supra transaction failed");

    return typeof txHash === "string" ? txHash : JSON.stringify(txHash);
  }, [supraAddress]);

  const short = address ? address.slice(0, 6) + "…" + address.slice(-4) : "";
  const evmShort = evmAddress ? evmAddress.slice(0, 6) + "…" + evmAddress.slice(-4) : "";
  const supraShort = supraAddress ? supraAddress.slice(0, 6) + "…" + supraAddress.slice(-4) : "";

  return (
    <Ctx.Provider value={{
      address, evmAddress, supraAddress, connect, demo, disconnect,
      short, evmShort, supraShort, isDemo,
      sendSepoliaEth, sendSupraTokens,
    }}>
      {children}
    </Ctx.Provider>
  );
}

// Helper: hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const padded = hex.padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(padded.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Helper: uint64 to little-endian 8-byte array (BCS format)
function uint64ToBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let val = BigInt(n);
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(val & BigInt(0xff));
    val >>= BigInt(8);
  }
  return bytes;
}
