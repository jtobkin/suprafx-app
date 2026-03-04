"use client";
import { useState, useEffect } from "react";
import { useWallet } from "./WalletProvider";

export default function ProfilePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { supraAddress, profile, isVerified, isDemo, linkEvmAddress, disconnect, supraShort, evmShort } = useWallet();
  const [linking, setLinking] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<"metamask" | "starkey" | null>(null);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showWalletChoice, setShowWalletChoice] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
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

  if (!mounted) return null;

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
                <span className="px-1.5 py-0.5 rounded text-[10px] mono" style={{ background: "var(--surface-3)", color: "var(--t3)" }}>
                  StarKey
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
            <div className="text-[13px] mt-1.5" style={{ color: "var(--t3)" }}>
              Primary identity for reputation and trading
            </div>
          </div>

          {/* Linked Addresses */}
          <div>
            <div className="mono text-[11px] uppercase tracking-wider mb-3 font-medium" style={{ color: "var(--t3)" }}>
              Linked Addresses
            </div>

            {/* EVM Address */}
            <div className="card p-3.5" style={{
              borderColor: profile?.evmVerified ? undefined : "var(--warn)",
            }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="mono text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>
                    Ethereum (Sepolia)
                  </span>
                  {profile?.evmVerified && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] mono" style={{ background: "var(--surface-3)", color: "var(--t3)" }}>
                      {/* Show which wallet was used */}
                      verified
                    </span>
                  )}
                </div>
                {profile?.evmVerified ? (
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--positive)" }} />
                    <span className="mono text-[12px]" style={{ color: "var(--positive)" }}>linked</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--warn)" }} />
                    <span className="mono text-[12px]" style={{ color: "var(--warn)" }}>not linked</span>
                  </div>
                )}
              </div>

              {profile?.evmVerified ? (
                <>
                  <div className="mono text-[13px] break-all" style={{ color: "var(--t0)" }}>
                    {profile.evmAddress}
                  </div>
                  <div className="text-[13px] mt-1.5" style={{ color: "var(--t3)" }}>
                    Ownership verified via signed message
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[13px] mb-3" style={{ color: "var(--t2)" }}>
                    Link your Ethereum address to enable cross-chain settlement. This proves you own the address by signing a message.
                  </div>

                  {linking ? (
                    <div className="flex items-center gap-2 py-2">
                      <div className="w-3 h-3 rounded-full border-[1.5px] animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                      <span className="text-[13px]" style={{ color: "var(--t2)" }}>
                        Waiting for {linkingProvider === "starkey" ? "StarKey" : "MetaMask"} signature...
                      </span>
                    </div>
                  ) : showWalletChoice ? (
                    <div className="space-y-2">
                      <div className="text-[12px] mb-2" style={{ color: "var(--t3)" }}>Choose wallet to sign with:</div>
                      <button onClick={() => handleLink("starkey")}
                        className="w-full py-2.5 rounded-md text-[13px] font-semibold transition-all hover:brightness-110 flex items-center justify-center gap-2"
                        style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
                        StarKey (EVM)
                      </button>
                      <button onClick={() => handleLink("metamask")}
                        className="w-full py-2.5 rounded-md text-[13px] font-semibold transition-all hover:brightness-110 flex items-center justify-center gap-2"
                        style={{ background: "var(--surface-3)", color: "var(--t1)", border: "1px solid var(--border)" }}>
                        MetaMask
                      </button>
                      <button onClick={() => setShowWalletChoice(false)}
                        className="w-full py-1.5 text-[12px] transition-all"
                        style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>
                        cancel
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setShowWalletChoice(true)}
                      className="w-full py-2.5 rounded-md text-[14px] font-semibold transition-all hover:brightness-110"
                      style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
                      Link EVM Address
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Verification Status */}
          <div className="rounded-md p-3.5" style={{ background: isVerified ? "var(--positive-dim)" : "var(--warn-dim)" }}>
            <div className="text-[14px] font-medium" style={{ color: isVerified ? "var(--positive)" : "var(--warn)" }}>
              {isVerified ? "Ready to Trade" : "Complete Setup to Trade"}
            </div>
            <div className="text-[13px] mt-1" style={{ color: "var(--t3)" }}>
              {isVerified
                ? "Both addresses verified. Cross-chain settlement enabled. Reputation is shared across linked addresses."
                : "Link your EVM address to enable settlement on Sepolia."}
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
                <span className="mono" style={{ color: profile?.evmVerified ? "var(--t1)" : "var(--t3)" }}>
                  {profile?.evmVerified ? evmShort : "—"}
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
