"use client";
import { useState, useEffect, useCallback } from "react";
import { useWallet, LinkedAddress } from "./WalletProvider";

export default function ProfilePanel({ open, onClose, initialTab = "profile" }: { open: boolean; onClose: () => void; initialTab?: "profile" | "vault" }) {
  const { supraAddress, profile, isVerified, isDemo, linkEvmAddress, disconnect, supraShort } = useWallet();
  const [linking, setLinking] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showWalletChoice, setShowWalletChoice] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"profile" | "vault">(initialTab);

  // Vault state
  const [vault, setVault] = useState<any>(null);
  const [vaultTransactions, setVaultTransactions] = useState<any[]>([]);
  const [vaultEarmarks, setVaultEarmarks] = useState<any[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositCurrency, setDepositCurrency] = useState<"USDC" | "USDT">("USDC");
  const [depositing, setDepositing] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [vaultMessage, setVaultMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // Agent stats
  const [agent, setAgent] = useState<any>(null);

  // Sync initialTab when panel opens
  useEffect(() => { if (open) setActiveTab(initialTab); }, [open, initialTab]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => { requestAnimationFrame(() => setVisible(true)); });
    } else {
      setVisible(false);
      setShowWalletChoice(false);
      setShowWithdraw(false);
      setVaultMessage(null);
      const t = setTimeout(() => setMounted(false), 280);
      return () => clearTimeout(t);
    }
  }, [open]);

  const loadData = useCallback(async () => {
    if (!supraAddress || isDemo) return;
    setVaultLoading(true);
    try {
      const [vRes, aRes] = await Promise.all([
        fetch(`/api/vault?address=${encodeURIComponent(supraAddress)}`).then(r => r.json()),
        fetch(`/api/skill/suprafx`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check_agent", agentAddress: supraAddress }),
        }).then(r => r.json()).catch(() => null),
      ]);
      setVault(vRes.balance);
      setVaultTransactions(vRes.transactions || []);
      setVaultEarmarks(vRes.earmarks || []);
      if (aRes?.agent) setAgent(aRes.agent);
    } catch {}
    setVaultLoading(false);
  }, [supraAddress, isDemo]);

  useEffect(() => { if (open && supraAddress) loadData(); }, [open, supraAddress, loadData]);
  // Refresh data every 5 seconds while panel is open (catches rep changes from timeouts)
  useEffect(() => {
    if (!open || !supraAddress) return;
    const iv = setInterval(loadData, 5000);
    return () => clearInterval(iv);
  }, [open, supraAddress, loadData]);

  const handleLink = async (provider: "metamask" | "starkey") => {
    setLinking(true); setLinkingProvider(provider); setShowWalletChoice(false);
    await linkEvmAddress(provider);
    setLinking(false); setLinkingProvider(null);
  };

  const handleRemove = async (addr: LinkedAddress) => {
    if (!supraAddress) return;
    setRemoving(addr.address);
    try {
      await fetch("/api/link-address", { method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supraAddress, linkedAddress: addr.address, chain: addr.chain }) });
      window.location.reload();
    } catch {}
    setRemoving(null);
  };

  const handleDeposit = async () => {
    if (!supraAddress || !depositAmount || parseFloat(depositAmount) <= 0) return;
    setDepositing(true); setVaultMessage(null);
    try {
      const res = await fetch("/api/vault", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deposit", makerAddress: supraAddress, amount: depositAmount, currency: depositCurrency }) });
      const data = await res.json();
      if (data.success) { setVaultMessage({ text: `Deposited ${depositAmount} ${depositCurrency}`, ok: true }); setDepositAmount(""); await loadData(); }
      else setVaultMessage({ text: data.error || "Deposit failed", ok: false });
    } catch (e: any) { setVaultMessage({ text: e.message, ok: false }); }
    setDepositing(false);
  };

  const handleWithdrawRequest = async () => {
    if (!supraAddress || !withdrawAmount || parseFloat(withdrawAmount) <= 0) return;
    setWithdrawing(true); setVaultMessage(null);
    try {
      const res = await fetch("/api/vault", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_withdrawal", makerAddress: supraAddress, amount: withdrawAmount, currency: depositCurrency }) });
      const data = await res.json();
      if (data.success) {
        setVaultMessage({ text: `Withdrawal requested. 12-hour cooling period.`, ok: true });
        setWithdrawAmount(""); setShowWithdraw(false); await loadData();
      } else setVaultMessage({ text: data.error || "Withdrawal failed", ok: false });
    } catch (e: any) { setVaultMessage({ text: e.message, ok: false }); }
    setWithdrawing(false);
  };

  if (!mounted) return null;

  const linkedAddresses = profile?.linkedAddresses || [];
  const hasAnyEvm = linkedAddresses.length > 0 || profile?.evmVerified;
  const shortAddr = (a: string) => a.slice(0, 6) + "\u2026" + a.slice(-4);
  const hasVault = vault && vault.totalDeposited > 0;
  const hasCredit = vault && vault.totalDeposited > 0 && vaultTransactions.some((t: any) => t.tx_hash?.startsWith("sim_repayment"));
  const repScore = agent ? Number(agent.rep_total).toFixed(2) : "5.00";
  const tradeCount = agent?.trade_count || 0;

  return (
    <>
      <div className="fixed inset-0 z-50 transition-opacity duration-250 ease-out"
        style={{ background: "rgba(0,0,0,0.5)", opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }}
        onClick={onClose} />

      <div className="fixed top-0 right-0 h-full w-[400px] z-50 border-l flex flex-col transition-transform duration-280 ease-out"
        style={{ background: "var(--bg)", borderColor: "var(--border)", transform: visible ? "translateX(0)" : "translateX(100%)" }}>

        {/* Header */}
        <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>Account</span>
            <button onClick={onClose} className="text-[13px] px-2 py-1 rounded transition-colors hover:bg-white/[0.04]"
              style={{ color: "var(--t3)", background: "var(--surface-2)" }}>✕</button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 rounded-md p-0.5" style={{ background: "var(--surface-2)" }}>
            <button onClick={() => setActiveTab("profile")}
              className="flex-1 py-1.5 rounded text-[12px] font-semibold transition-all"
              style={{ background: activeTab === "profile" ? "var(--bg)" : "transparent",
                color: activeTab === "profile" ? "var(--t0)" : "var(--t3)",
                boxShadow: activeTab === "profile" ? "0 1px 3px rgba(0,0,0,0.15)" : "none" }}>
              Profile
            </button>
            <button onClick={() => setActiveTab("vault")}
              className="flex-1 py-1.5 rounded text-[12px] font-semibold transition-all"
              style={{ background: activeTab === "vault" ? "var(--bg)" : "transparent",
                color: activeTab === "vault" ? "var(--t0)" : "var(--t3)",
                boxShadow: activeTab === "vault" ? "0 1px 3px rgba(0,0,0,0.15)" : "none" }}>
              Security Deposit
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

          {/* =============================== */}
          {/* PROFILE TAB */}
          {/* =============================== */}
          {activeTab === "profile" && (
            <>
              {/* Reputation — at the very top */}
              <div>
                <div className="mono text-[11px] uppercase tracking-wider mb-3 font-medium" style={{ color: "var(--t3)" }}>Reputation</div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-md p-3" style={{ background: "var(--surface-2)" }}>
                    <div className="mono text-[18px] font-bold" style={{ color: parseFloat(repScore) >= 4 ? "var(--positive)" : parseFloat(repScore) >= 2 ? "var(--warn)" : "var(--negative)" }}>{repScore}</div>
                    <div className="text-[11px]" style={{ color: "var(--t3)" }}>rep score</div>
                  </div>
                  <div className="rounded-md p-3" style={{ background: "var(--surface-2)" }}>
                    <div className="mono text-[18px] font-bold" style={{ color: "var(--t0)" }}>{tradeCount}</div>
                    <div className="text-[11px]" style={{ color: "var(--t3)" }}>trades</div>
                  </div>
                  <div className="rounded-md p-3" style={{ background: "var(--surface-2)" }}>
                    <div className="mono text-[18px] font-bold" style={{ color: "var(--t0)" }}>
                      {agent?.timeout_count || 0}/3
                    </div>
                    <div className="text-[11px]" style={{ color: "var(--t3)" }}>timeouts</div>
                  </div>
                </div>
                <div className="mt-2 text-[11px] px-2 py-1.5 rounded" style={{ background: "var(--surface-2)", color: "var(--t3)" }}>
                  Taker timeout: -33% rep. Maker default: -67% rep + deposit liquidated. 3 timeouts/month = suspended.
                </div>
              </div>

              {/* Identity */}
              <div>
                <div className="mono text-[11px] uppercase tracking-wider mb-3 font-medium" style={{ color: "var(--t3)" }}>Identity</div>
                <div className="text-[14px]" style={{ color: "var(--t2)" }}>{isDemo ? "Demo Mode" : "Authenticated via StarKey"}</div>
              </div>

              {/* Supra Address */}
              <div className="card p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="mono text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>Supra (MoveVM)</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] mono uppercase" style={{ background: "rgba(34,197,94,0.1)", color: "var(--positive)" }}>Primary</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--positive)" }} />
                    <span className="mono text-[12px]" style={{ color: "var(--positive)" }}>verified</span>
                  </div>
                </div>
                <div className="mono text-[13px] break-all" style={{ color: "var(--t0)" }}>{supraAddress}</div>
                <div className="text-[12px] mt-1.5" style={{ color: "var(--t3)" }}>Reputation accumulates on this address</div>
              </div>

              {/* Linked EVM Addresses */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="mono text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--t3)" }}>Linked EVM Addresses</span>
                  <span className="text-[11px] mono" style={{ color: "var(--t3)" }}>{linkedAddresses.length} linked</span>
                </div>
                <div className="space-y-2">
                  {linkedAddresses.map((la) => (
                    <div key={la.address} className="card p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="mono text-[10px] uppercase" style={{ color: "var(--t3)" }}>{la.chain}</span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] mono" style={{ background: "var(--surface-3)", color: "var(--t3)" }}>{la.walletProvider}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--positive)" }} />
                          <span className="mono text-[11px]" style={{ color: "var(--positive)" }}>verified</span>
                        </div>
                      </div>
                      <div className="mono text-[12px] break-all" style={{ color: "var(--t0)" }}>{la.address}</div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[11px]" style={{ color: "var(--t3)" }}>{new Date(la.verifiedAt).toLocaleDateString()}</span>
                        <button onClick={() => handleRemove(la)} disabled={removing === la.address}
                          className="text-[11px] px-2 py-0.5 rounded transition-all disabled:opacity-50"
                          style={{ color: "var(--negative)", background: "var(--surface-3)", border: "none", cursor: "pointer" }}>
                          {removing === la.address ? "Removing\u2026" : "Remove"}
                        </button>
                      </div>
                    </div>
                  ))}
                  {linkedAddresses.length === 0 && !profile?.evmVerified && (
                    <div className="text-[13px] py-2" style={{ color: "var(--t3)" }}>No EVM addresses linked yet.</div>
                  )}
                  <div className="card p-3" style={{ borderColor: "var(--border)", borderStyle: "dashed" }}>
                    {linking ? (
                      <div className="flex items-center gap-2 py-1">
                        <div className="w-3 h-3 rounded-full border-[1.5px] animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                        <span className="text-[13px]" style={{ color: "var(--t2)" }}>Waiting for {linkingProvider === "starkey" ? "StarKey" : "MetaMask"} signature...</span>
                      </div>
                    ) : showWalletChoice ? (
                      <div className="space-y-2">
                        <div className="text-[12px] mb-1" style={{ color: "var(--t3)" }}>Choose wallet to sign with:</div>
                        <button onClick={() => handleLink("starkey")} className="w-full py-2 rounded-md text-[13px] font-semibold transition-all hover:brightness-110" style={{ background: "var(--accent)", color: "#fff", border: "none" }}>StarKey (EVM)</button>
                        <button onClick={() => handleLink("metamask")} className="w-full py-2 rounded-md text-[13px] font-semibold transition-all hover:brightness-110" style={{ background: "var(--surface-3)", color: "var(--t1)", border: "1px solid var(--border)" }}>MetaMask</button>
                        <button onClick={() => setShowWalletChoice(false)} className="w-full py-1 text-[12px]" style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setShowWalletChoice(true)} className="w-full py-1.5 text-[13px] font-medium transition-all" style={{ color: "var(--accent-light)", background: "none", border: "none", cursor: "pointer" }}>+ Add EVM Address</button>
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
                  {isVerified ? `${linkedAddresses.length} EVM address${linkedAddresses.length !== 1 ? "es" : ""} linked.` : "Link at least one EVM address to enable settlement."}
                </div>
              </div>

              {/* Settlement Routing */}
              <div>
                <div className="mono text-[11px] uppercase tracking-wider mb-3 font-medium" style={{ color: "var(--t3)" }}>Settlement Routing</div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between py-2 px-3 rounded-md text-[14px]" style={{ background: "var(--surface-2)" }}>
                    <span style={{ color: "var(--t3)" }}>Sepolia ETH legs</span>
                    <span className="mono" style={{ color: hasAnyEvm ? "var(--t1)" : "var(--t3)" }}>
                      {linkedAddresses.length > 0 ? shortAddr(linkedAddresses[0].address) : profile?.evmAddress ? shortAddr(profile.evmAddress) : "\u2014"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 px-3 rounded-md text-[14px]" style={{ background: "var(--surface-2)" }}>
                    <span style={{ color: "var(--t3)" }}>Supra token legs</span>
                    <span className="mono" style={{ color: "var(--t1)" }}>{supraShort}</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* =============================== */}
          {/* SECURITY DEPOSIT TAB */}
          {/* =============================== */}
          {activeTab === "vault" && (
            <>
              {vaultLoading ? (
                <div className="flex items-center gap-2 py-6 justify-center">
                  <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                  <span className="text-[13px]" style={{ color: "var(--t3)" }}>Loading vault...</span>
                </div>
              ) : !hasVault ? (
                /* No deposit — onboarding */
                <div>
                  <div className="text-center mb-5">
                    <div className="text-[15px] font-semibold mb-2" style={{ color: "var(--t1)" }}>Become a Maker</div>
                    <div className="text-[13px]" style={{ color: "var(--t3)" }}>
                      Deposit stablecoins to start placing quotes on RFQs. Your deposit protects takers and backs your commitments.
                    </div>
                  </div>

                  <div className="card p-4 mb-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--t2)" }}>
                        <span style={{ color: "var(--positive)" }}>1.</span> Deposit USDC or USDT as collateral
                      </div>
                      <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--t2)" }}>
                        <span style={{ color: "var(--positive)" }}>2.</span> Your quoting capacity = 90% of deposit
                      </div>
                      <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--t2)" }}>
                        <span style={{ color: "var(--positive)" }}>3.</span> Withdraw anytime (12-hour cooling period)
                      </div>
                      <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--t2)" }}>
                        <span style={{ color: "var(--warn)" }}>!</span> If you default on a trade, deposit covers the taker
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <input type="number" placeholder="Amount" value={depositAmount} onChange={e => setDepositAmount(e.target.value)}
                      className="flex-1 px-3 py-2.5 rounded border text-[14px] mono outline-none"
                      style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--t0)" }} />
                    <select value={depositCurrency} onChange={e => setDepositCurrency(e.target.value as any)}
                      className="px-2 py-2.5 rounded border text-[13px] mono outline-none"
                      style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--t0)" }}>
                      <option value="USDC">USDC</option>
                      <option value="USDT">USDT</option>
                    </select>
                  </div>
                  <button onClick={handleDeposit} disabled={depositing || !depositAmount || parseFloat(depositAmount) <= 0}
                    className="w-full py-3 rounded-md text-[14px] font-semibold transition-all disabled:opacity-30 hover:brightness-110"
                    style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
                    {depositing ? "Depositing\u2026" : "Make Security Deposit"}
                  </button>
                </div>
              ) : (
                /* Has deposit — vault dashboard */
                <div className="space-y-4">
                  {/* Balance cards */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-md p-3" style={{ background: "var(--surface-2)" }}>
                      <div className="mono text-[18px] font-bold" style={{ color: "var(--t0)" }}>
                        {vault.totalDeposited.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-[11px]" style={{ color: "var(--t3)" }}>Total ({vault.currency})</div>
                    </div>
                    <div className="rounded-md p-3" style={{ background: "var(--surface-2)" }}>
                      <div className="mono text-[18px] font-bold" style={{ color: "var(--positive)" }}>
                        {vault.matchingLimit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-[11px]" style={{ color: "var(--t3)" }}>Matching Limit (90%)</div>
                    </div>
                  </div>

                  {/* Breakdown */}
                  <div className="card p-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[12px]">
                        <span style={{ color: "var(--t3)" }}>Available</span>
                        <span className="mono font-medium" style={{ color: "var(--t1)" }}>{vault.available.toLocaleString(undefined, { minimumFractionDigits: 2 })} {vault.currency}</span>
                      </div>
                      {vault.committed > 0 && (
                        <div className="flex items-center justify-between text-[12px]">
                          <span style={{ color: "var(--t3)" }}>Committed (earmarked)</span>
                          <span className="mono font-medium" style={{ color: "var(--warn)" }}>{vault.committed.toLocaleString(undefined, { minimumFractionDigits: 2 })} {vault.currency}</span>
                        </div>
                      )}
                      {vault.pendingWithdrawal > 0 && (
                        <div className="flex items-center justify-between text-[12px]">
                          <span style={{ color: "var(--t3)" }}>Pending Withdrawal</span>
                          <span className="mono font-medium" style={{ color: "var(--warn)" }}>{vault.pendingWithdrawal.toLocaleString(undefined, { minimumFractionDigits: 2 })} {vault.currency}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Add more deposit */}
                  <div>
                    <div className="mono text-[10px] uppercase tracking-wider mb-2 font-medium" style={{ color: "var(--t3)" }}>Add to Deposit</div>
                    <div className="flex items-center gap-2">
                      <input type="number" placeholder="Amount" value={depositAmount} onChange={e => setDepositAmount(e.target.value)}
                        className="flex-1 px-2.5 py-[7px] rounded border text-[13px] mono outline-none"
                        style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--t0)" }} />
                      <button onClick={handleDeposit} disabled={depositing || !depositAmount || parseFloat(depositAmount) <= 0}
                        className="px-4 py-[7px] rounded text-[12px] font-semibold transition-all disabled:opacity-30 hover:brightness-110"
                        style={{ background: "var(--accent)", color: "#fff", border: "none" }}>
                        {depositing ? "\u2026" : "Deposit"}
                      </button>
                    </div>
                  </div>

                  {/* Withdraw */}
                  <div>
                    <div className="mono text-[10px] uppercase tracking-wider mb-2 font-medium" style={{ color: "var(--t3)" }}>Withdraw</div>
                    {showWithdraw ? (
                      <div className="card p-3">
                        <div className="text-[12px] mb-2" style={{ color: "var(--t3)" }}>12-hour cooling period. Cannot withdraw while trades are active.</div>
                        <div className="flex items-center gap-2 mb-2">
                          <input type="number" placeholder="Amount" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)}
                            className="flex-1 px-2.5 py-[6px] rounded border text-[13px] mono outline-none"
                            style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--t0)" }} />
                          <button onClick={handleWithdrawRequest} disabled={withdrawing || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
                            className="px-3 py-[6px] rounded text-[12px] font-semibold transition-all disabled:opacity-30"
                            style={{ background: "var(--surface-3)", color: "var(--t1)", border: "1px solid var(--border)" }}>
                            {withdrawing ? "\u2026" : "Request"}
                          </button>
                        </div>
                        <button onClick={() => setShowWithdraw(false)} className="text-[11px]" style={{ color: "var(--t3)", background: "none", border: "none", cursor: "pointer" }}>cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setShowWithdraw(true)}
                        className="text-[12px] px-3 py-1.5 rounded transition-all hover:brightness-110"
                        style={{ color: "var(--t2)", background: "var(--surface-2)", border: "none", cursor: "pointer" }}>
                        Request Withdrawal
                      </button>
                    )}
                  </div>

                  {/* Active earmarks */}
                  {vaultEarmarks.length > 0 && (
                    <div>
                      <div className="mono text-[10px] uppercase tracking-wider mb-2 font-medium" style={{ color: "var(--t3)" }}>Active Earmarks</div>
                      <div className="space-y-1">
                        {vaultEarmarks.map((e: any) => (
                          <div key={e.id} className="flex items-center justify-between px-3 py-1.5 rounded text-[11px]" style={{ background: "var(--surface-2)" }}>
                            <span style={{ color: "var(--t3)" }}>Quote {e.quote_id?.slice(0, 8)}…</span>
                            <span className="mono font-medium" style={{ color: "var(--warn)" }}>{Number(e.amount).toFixed(2)} {e.currency}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Transaction history */}
                  {vaultTransactions.length > 0 && (
                    <div>
                      <div className="mono text-[10px] uppercase tracking-wider mb-2 font-medium" style={{ color: "var(--t3)" }}>Recent Transactions</div>
                      <div className="space-y-1">
                        {vaultTransactions.slice(0, 8).map((t: any) => {
                          const isRepayment = t.direction === 'deposit' && t.tx_hash?.startsWith('sim_repayment');
                          const isLiquidation = t.direction === 'withdrawal' && t.tx_hash?.startsWith('sim_liquidation');
                          const isDeposit = t.direction === 'deposit' && !isRepayment;
                          const label = isRepayment ? 'Repayment (maker default)' :
                            isLiquidation ? 'Liquidated (you defaulted)' :
                            isDeposit ? 'Deposit' : 'Withdrawal';
                          const color = isRepayment ? 'var(--positive)' :
                            isLiquidation ? 'var(--negative)' :
                            isDeposit ? 'var(--positive)' : 'var(--t2)';
                          return (
                            <div key={t.id} className="flex items-center justify-between px-3 py-1.5 rounded text-[11px]" style={{ background: "var(--surface-2)" }}>
                              <div className="flex items-center gap-2">
                                <span style={{ color }}>{t.direction === 'deposit' ? '+' : '-'}</span>
                                <span style={{ color: "var(--t2)" }}>{label}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="mono font-medium" style={{ color }}>{Number(t.amount).toFixed(2)} {t.currency}</span>
                                <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>{new Date(t.created_at).toLocaleDateString()}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Risk notice */}
                  <div className="text-[11px] px-3 py-2 rounded" style={{ background: "var(--surface-2)", color: "var(--t3)" }}>
                    If you default on a trade (fail to send within 30 min after taker sends), your deposit covers the taker’s loss plus a 10% surcharge.
                  </div>
                </div>
              )}

              {vaultMessage && (
                <div className="text-[12px] px-2 py-1.5 rounded mt-3" style={{ color: vaultMessage.ok ? "var(--positive)" : "var(--negative)", background: vaultMessage.ok ? "var(--positive-dim)" : "rgba(239,68,68,0.06)" }}>
                  {vaultMessage.text}
                </div>
              )}
            </>
          )}
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
