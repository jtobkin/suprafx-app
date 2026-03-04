"use client";
import { useState, useEffect } from "react";
import { useWallet, LinkedAddress } from "./WalletProvider";

export default function ProfilePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { supraAddress, profile, isVerified, isDemo, linkEvmAddress, disconnect, supraShort } = useWallet();
  const [linking, setLinking] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showWalletChoice, setShowWalletChoice] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      setShowWalletChoice(false);
      const t = setTimeout(() => setMounted(false), 280);
      return () => clearTimeout(t);
    }
  }, [open]);

  const handleLink = async (provider: "metamask" | "starkey") => {
    setLinking(true);
    setLinkingProvider(provider);
    setShowWalletChoice(false);
    await linkEvmAddress(provider);
    setLinking(false);
    setLinkingProvider(null);
  };

  const handleRemove = async (addr: LinkedAddress) => {
    if (!supraAddress) return;
    setRemoving(addr.address);
    try {
      const res = await fetch("/api/link-address", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supraAddress, linkedAddress: addr.address, chain: addr.chain }),
      });
      const data = await res.json();
      if (data.deleted) {
        // Reload profile
        window.location.reload();
      }
    } catch {}
    setRemoving(null);
  };

  if (!mounted) return null;

  const linkedAddresses = profile?.linkedAddresses || [];
  const hasAnyEvm = linkedAddresses.length > 0 || profile?.evmVerified;

  const shortAddr = (a: string) => a.slice(0, 6) + "\u2026" + a.slice(-4);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 transition-opacity duration-250 ease-out"
        style={{
          background: "rgba(0,0,0,0.5)",
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? "auto" : "none",
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full w-[380px] z-50 border-l flex flex-col transition-transform duration-280 ease-out"
        style={{
          background: "var(--bg)",
          borderColor: "var(--border)",
          transform: visible ? "translateX(0)" : "translateX(100%)",
        }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>Profile</span>
          <button onClick={onClose} className="text-[13px] px-2 py-1 rounded transition-colors hover:bg-white/[0.04]"
            style={{ color: "var(--t3)", background: "var(--surface-2)" }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

          {/* Identity */}
          <div>
            <div className="mono text-[11px] uppercase tracking-wider mb-3 font-medium" style={{ color: "var(--t3)" }}>
              Identity
            </div>
            <div className="text-[14px]" style={{ color: "var(--t2)" }}>
              {isDemo ? "Demo Mode" : "Authenticated via StarKey"}
            </div>
          </div>

          {/* Supra Address */}
          <div className="card p-3.5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="mono text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>
                  Supra (MoveVM)
                </span>
                <span className="px-1.5 py-0.5 rounded text-[9px] mono uppercase" style={{ background: "rgba(34,197,94,0.1)", color: "var(--positive)" }}>
                  Primary
                </span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--positive)" }} />
                <span className="mono text-[12px]" style={{ color: "var(--positive)" }}>verified</span>
              </div>
            </div>
            <div className="mono text-[13px] break-all" style={{ color: "var(--t0)" }}>
              {supraAddress}
            </div>
            <div className="text-[12px] mt-1.5" style={{ color: "var(--t3)" }}>
              Reputation accumulates on this address
            </div>
          </div>

          {/* Linked EVM Addresses */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="mono text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>
                Linked EVM Addresses
              </span>
              <span className="text-[11px] mono" style={{ color: "var(--t3)" }}>
                {linkedAddresses.length} linked
              </span>
            </div>

            <div className="space-y-2">
              {/* Existing linked addresses */}
              {linkedAddresses.map((la) => (
                <div key={la.address} className="card p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="mono text-[10px] uppercase" style={{ color: "var(--t3)" }}>{la.chain}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] mono" style={{ background: "var(--surface-3)", color: "var(--t3)" }}>
                        {la.walletProvider}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--positive)" }} />
                      <span className="mono text-[11px]" style={{ color: "var(--positive)" }}>verified</span>
                    </div>
                  </div>
                  <div className="mono text-[13px] break-all" style={{ color: "var(--t0)" }}>
                    {la.address}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[11px]" style={{ color: "var(--t3)" }}>
                      {new Date(la.verifiedAt).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => handleRemove(la)}
                      disabled={removing === la.address}
                      className="text-[11px] px-2 py-0.5 rounded transition-all hover:brightness-110 disabled:opacity-50"
                      style={{ color: "var(--negative)", background: "var(--surface-3)", border: "none", cursor: "pointer" }}>
                      {removing === la.address ? "Removing\u2026" : "Remove"}
                    </button>
                  </div>
                </div>
              ))}

              {/* No addresses yet */}
              {linkedAddresses.length === 0 && !profile?.evmVerified && (
                <div className="text-[13px] py-2" style={{ color: "var(--t3)" }}>
                  No EVM addresses linked yet. Link at least one to enable cross-chain settlement.
                </div>
              )}

              {/* Add new address */}
              <div className="card p-3" style={{ borderColor: "var(--border)", borderStyle: "dashed" }}>
                {linking ? (
                  <div className="flex items-center gap-2 py-1">
                    <div className="w-3 h-3 rounded-full border-[1.5px] animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                    <span className="text-[13px]" style={{ color: "var(--t2)" }}>
                      Waiting for {linkingProvider === "starkey" ? "StarKey" : "MetaMask"} signature...
                    </span>
                  </div>
                ) : showWalletChoice ? (
                  <div className="space-y-2">
                    <div className="text-[12px] mb-1" style={{ color: "var(--t3)" }}>Choose wallet to sign with:</div>
                    <button onClick={() => handleLink("starkey")}
                      className="w-full py-2 rounded-md text-[13px] font-semibold transition-all hover:brightness-110"
                      style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
                      StarKey (EVM)
                    </button>
                    <button onClick={() => handleLink("metamask")}
                      className="w-full py-2 rounded-md text-[13px] font-semibold transition-all hover:brightness-110"
                      style={{ background: "var(--surface-3)", color: "var(--t1)", border: "1px solid var(--border)" }}>
                      MetaMask
                    </button>
                    <button onClick={() => setShowWalletChoice(false)}
                      className="w-full py-1 text-[12px]"
                      style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>
                      cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setShowWalletChoice(true)}
                    className="w-full py-1.5 text-[13px] font-medium transition-all"
                    style={{ color: "var(--accent-light)", background: "none", border: "none", cursor: "pointer" }}>
                    + Add EVM Address
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Verification Status */}
          <div className="rounded-md p-3.5" style={{ background: isVerified ? "var(--positive-dim)" : "var(--warn-dim)" }}>
            <div className="text-[14px] font-medium" style={{ color: isVerified ? "var(--positive)" : "var(--warn)" }}>
              {isVerified ? "Ready to Trade" : "Complete Setup to Trade"}
            </div>
            <div className="text-[13px] mt-1" style={{ color: "var(--t3)" }}>
              {isVerified
                ? `${linkedAddresses.length} EVM address${linkedAddresses.length !== 1 ? "es" : ""} linked. Reputation shared across all addresses.`
                : "Link at least one EVM address to enable settlement."}
            </div>
          </div>

          {/* Reputation */}
          <div>
            <div className="mono text-[11px] uppercase tracking-wider mb-3 font-medium" style={{ color: "var(--t3)" }}>
              Reputation
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md p-3" style={{ background: "var(--surface-2)" }}>
                <div className="mono text-[18px] font-bold" style={{ color: "var(--t0)" }}>5.00</div>
                <div className="text-[13px]" style={{ color: "var(--t3)" }}>rep score</div>
              </div>
              <div className="rounded-md p-3" style={{ background: "var(--surface-2)" }}>
                <div className="mono text-[18px] font-bold" style={{ color: "var(--t0)" }}>0</div>
                <div className="text-[13px]" style={{ color: "var(--t3)" }}>trades settled</div>
              </div>
            </div>
          </div>

          {/* Settlement Routing */}
          <div>
            <div className="mono text-[11px] uppercase tracking-wider mb-3 font-medium" style={{ color: "var(--t3)" }}>
              Settlement Routing
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between py-2 px-3 rounded-md text-[14px]"
                style={{ background: "var(--surface-2)" }}>
                <span style={{ color: "var(--t3)" }}>Sepolia ETH legs</span>
                <span className="mono" style={{ color: hasAnyEvm ? "var(--t1)" : "var(--t3)" }}>
                  {linkedAddresses.length > 0
                    ? shortAddr(linkedAddresses[0].address)
                    : profile?.evmAddress ? shortAddr(profile.evmAddress) : "\u2014"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-md text-[14px]"
                style={{ background: "var(--surface-2)" }}>
                <span style={{ color: "var(--t3)" }}>Supra token legs</span>
                <span className="mono" style={{ color: "var(--t1)" }}>{supraShort}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t" style={{ borderColor: "var(--border)" }}>
          <button onClick={disconnect}
            className="w-full py-2.5 rounded-md text-[14px] mono transition-all hover:brightness-110"
            style={{ color: "var(--negative)", background: "var(--surface-2)", border: "1px solid var(--border)" }}>
            Disconnect
          </button>
        </div>
      </div>
    </>
  );
}
