# SupraFX Protocol Specification v3.0

## Document Purpose

This is the single source of truth for the SupraFX protocol design, data model, and implementation plan. Reference this document at the start of every development session to maintain continuity.

**Last updated:** March 4, 2026

---

## 1. Protocol Overview

SupraFX is a cross-chain FX settlement marketplace. It enables AI agents and human traders to operate as both takers and makers in a trustless RFQ marketplace across any supported chain.

**Core principles:**
- This is a TWO-SIDED MARKETPLACE. Every feature, UI state, API response, and error message must be designed from both the taker's and maker's perspective.
- Every platform action is signed by the actor and stored as an audit trail
- The Settlement Council (3-of-5 multisig) co-signs critical actions as consensus on state
- Makers post stablecoin security deposits to protect takers who send funds first
- Timeouts and penalties enforce trade completion after matching
- A final on-chain attestation bundles the complete signed history of each trade

---

## 2. Critical Design Principles (Lessons Learned)

These principles emerged from building Phase 0 and must guide all future development.

### 2.1 Two-Sided Awareness

Every feature must be reasoned about from three perspectives:
- **Taker:** What do they see? What action is expected? What can go wrong?
- **Maker:** What do they see? What action is expected? What can go wrong?
- **Settlement Council:** What are they verifying? What state change do they sign?

When building any UI component, API endpoint, or notification, explicitly trace through both the taker's and maker's experience at every trade status.

### 2.2 Pair Direction Determines Chain Order

The pair name encodes who sends on which chain. `SUPRA/ETH` means the taker sells SUPRA (sends on Supra) and the maker sells ETH (sends on Sepolia). Both directions of every cross-chain pair must be explicitly defined in the PAIRS config with correct source/dest chains.

**NEVER** silently reverse a cross-chain pair. The normalization function must only fall back to reverse for same-chain pairs where source === dest.

### 2.3 Identity Addresses Are Not Settlement Addresses

Users log in with their Supra address (StarKey). This is their identity address where reputation accumulates. But when settling on a different chain, they need a different address. The system resolves settlement addresses at trade creation time:
- `maker_settlement_address` = maker's address on source_chain (where taker sends TO)
- `taker_settlement_address` = taker's address on dest_chain (where maker sends TO)

For Supra chains, the identity address IS the settlement address. For EVM chains, look up the linked EVM address from the `linked_addresses` table.

### 2.4 Chain-Agnostic Settlement

Settlement is a single action: "Settle on {ChainName}". The system determines:
- Am I the taker or maker?
- Which chain am I sending on? (source_chain for taker, dest_chain for maker)
- Which wallet do I need? (EVM wallet for EVM chains, StarKey for Supra chains)
- Who am I sending to? (resolved settlement address)
- How long to wait for block confirmation? (12s Ethereum, 3s Supra)

There is no "manual mode" or "auto mode" -- just one settle button that routes correctly.

### 2.5 Multi-Wallet Support

Users may have multiple wallet providers (StarKey, MetaMask). StarKey overrides `window.ethereum` and sets `isMetaMask: true`. Use EIP-6963 wallet discovery to reliably detect each wallet by its true identity (`io.metamask`, etc.).

Users can link multiple EVM addresses to their primary Supra identity. All linked addresses share one reputation score.

### 2.6 Adding New Chains

When adding a new chain, update these locations:
1. `PAIRS` config in route.ts -- add entries for both directions of every new pair
2. `REF_PRICES` -- add reference prices
3. `sendOnChain()` in OrderbookTable.tsx -- add chain case
4. `chainName()` in OrderbookTable.tsx -- add display name
5. `resolveSettlementAddress()` in resolve-address.ts -- add chain resolution logic
6. `verifyOnChain()` in confirm-tx route -- add on-chain verification
7. `CHAINS` in SubmitRFQ.tsx -- add to chain selector
8. `lib/chains.ts` -- add explorer URL and RPC config

Everything else (UI, notifications, progress bar, Council verification) adapts automatically.

---

## 3. Actors

**Taker:** Initiates an RFQ. Goes first in settlement (sends tokens on source chain). Protected by maker's security deposit if maker defaults.

**Maker:** Quotes on open RFQs. Goes second in settlement (sends tokens on destination chain). Must maintain a stablecoin security deposit in the vault.

**Settlement Council:** 5 validator nodes (N-1 through N-5). 3-of-5 threshold for consensus. Co-signs quotes, matches, TX verifications, penalties, and the final attestation. Controls the security deposit vault.

**Any agent can be both taker and maker.** Role is per-trade, not per-account.

---

## 4. Trade Lifecycle

### Phase A -- Registration and Address Linking

**A1. Agent Registration**
- Agent connects Supra wallet (StarKey), registers with public address and public key
- Supra address is the PRIMARY IDENTITY -- reputation accumulates here
- Signed registration stored on platform and with Council

**A2. Multi-Chain Address Linking**
- Agent links addresses on other chains (Sepolia, etc.) via signed message verification
- Can link via StarKey EVM or MetaMask (EIP-6963 discovery)
- Multiple EVM addresses supported per user
- Stored in `linked_addresses` table: supra_address, chain, linked_address, wallet_provider
- Used at trade creation to resolve settlement addresses

**A3. Maker Deposits Stablecoins**
- Maker deposits USDC or USDT into the Security Vault
- Signed deposit request includes: maker public address, amount, currency, timestamp
- Council verifies signature, co-signs the deposit, records the new vault balance
- Stablecoin-only policy eliminates oracle manipulation risk on collateral

**A4. DeFi Yield Deployment (simulated)**
- Council moves vault assets into whitelisted DeFi protocols
- For current implementation: simulated as a database entry

**A5. Matching Limit Computation**
- Available balance = total deposited - committed (active earmarks) - pending withdrawal amounts
- Matching limit = 90% of available balance

### Phase B -- RFQ and Quoting (Signed Audit Trail)

**B1. Taker Creates RFQ**
- Taker selects Sell token/chain and Buy token/chain in the UI
- Frontend builds pair as `sellToken/buyToken` (e.g. SUPRA/fxUSDC)
- API looks up pair in PAIRS config to get source_chain and dest_chain
- CRITICAL: pair must exist as-is in PAIRS. No silent reversing for cross-chain pairs.
- RFQ stored with source_chain and dest_chain

**B2. Maker Places Quote**
- Maker quotes a rate on an open RFQ
- Council checks: signature valid, payload formatted, balance covers trade
- Council earmarks balance from maker's available deposit
- A quote without Council co-signature cannot be accepted

**B3. Earmark Release Conditions**
- Released when: maker withdraws quote, taker cancels RFQ, trade settles, taker times out, or quote rejected

### Phase C -- Matching (Council-Verified)

**C1. Taker Accepts Quote**
- Taker signs acceptance of specific quote at specific rate

**C2. Council Match Verification (7 checks)**
- Valid taker RFQ signature, valid maker quote signature, valid taker acceptance
- Council co-signature on quote exists
- No cancellation/withdrawal between quote creation and acceptance
- Maker earmark intact
- Taker not banned

**C3. Trade Creation**
- Council signs match confirmation
- **Settlement addresses resolved at this point:**
  - `taker_settlement_address` = taker's address on dest_chain (where maker sends TO taker)
  - `maker_settlement_address` = maker's address on source_chain (where taker sends TO maker)
- These resolved addresses stored on the trade record
- Trade created with deadlines

### Phase D -- Settlement (Taker First)

**D1. Taker Settles**
- Taker clicks "Settle on {source_chain display name}"
- System determines: chain = source_chain, recipient = maker_settlement_address
- Wallet popup for the correct chain (StarKey for Supra, MetaMask/StarKey EVM for Sepolia)
- TX hash submitted to Council for on-chain verification
- Council endorses taker TX

**D2. Maker Settles**
- Maker sees notification: "Your turn -- settle on {dest_chain display name}"
- Maker clicks "Settle on {dest_chain display name}"
- System determines: chain = dest_chain, recipient = taker_settlement_address
- Wallet popup, TX hash submitted, Council endorses maker TX

**D3. Taker Timeout (30 minutes)**
- Taker loses 33% reputation
- Maker earmark released
- 3 timeouts in calendar month = ban

**D4. Maker Default (30 minutes)**
- Maker loses 67% reputation
- Deposit liquidated: trade value + 10% surcharge
- Taker repaid from maker's deposit

### Phase E -- Completion and Attestation

**E1. Reputation Scoring**
- Settlement under 5 min: significant boost
- Settlement under 15 min: moderate boost
- Settlement under 30 min: small boost

**E2. Final Attestation Bundle (9 items)**
1. Signed RFQ
2. Signed Quote
3. Council co-signature on quote
4. Signed Acceptance
5. Council match confirmation
6. Taker TX hash + Council endorsement
7. Maker TX hash + Council endorsement
8. Reputation deltas
9. Updated vault accounting state

**E3. On-Chain Attestation**
- Council 3-of-5 multisig over full bundle
- Submitted on Supra chain

### Phase F -- Withdrawal from Security Deposit

- Signed withdrawal request
- Immediate matching limit reduction
- Cannot withdraw with active matched trades
- 12-hour cooling period
- Council executes withdrawal

---

## 5. Trade Statuses

| Status | Meaning | Taker Sees | Maker Sees | Next States |
|--------|---------|------------|------------|-------------|
| `open` | Trade created, taker goes first | "Settle on {source_chain}" button | "Waiting for taker to settle..." | `taker_sent`, `taker_timed_out` |
| `taker_sent` | Taker submitted TX, Council verifying | "Council verifying..." | "Council verifying taker TX..." | `taker_verified` |
| `taker_verified` | Council endorsed taker TX | "Waiting for maker to settle..." | "Settle on {dest_chain}" button | `maker_sent`, `maker_defaulted` |
| `maker_sent` | Maker submitted TX, Council verifying | "Council verifying maker TX..." | "Council verifying..." | `settled` |
| `settled` | Both TXs verified, attestation submitted | Explorer links for both TXs | Explorer links for both TXs | (terminal) |
| `taker_timed_out` | Taker did not send within 30 min | "-33% reputation" | "Deposit released" | (terminal) |
| `maker_defaulted` | Maker did not send within 30 min | "Repaid from deposit" | "-67% reputation, deposit liquidated" | (terminal) |
| `cancelled` | RFQ cancelled pre-match | | | (terminal) |
| `failed` | TX verification failed | Can retry within window | Can retry within window | `taker_sent`, `maker_sent` |

---

## 6. Progress Bar Stages (UI)

Six visible stages:

1. **Matched** -- RFQ + quote + acceptance signed, Council confirmed
2. **Taker Sending** -- 30-min countdown, taker settling on source_chain
3. **Taker Verified** -- Council endorsed taker TX
4. **Maker Sending** -- 30-min countdown, maker settling on dest_chain
5. **Maker Verified** -- Council endorsed maker TX
6. **Settled** -- attestation submitted

Timeout states: `taker_timed_out` shows red at stage 2, `maker_defaulted` shows red at stage 4.

---

## 7. Data Model

### Current Tables (Implemented)

**`linked_addresses`** -- Multi-chain address linking
- supra_address, chain, linked_address, wallet_provider, signature, verified_at
- UNIQUE(supra_address, linked_address) -- same address can't be linked twice

**`address_links`** -- Legacy single EVM link (backwards compatible)
- supra_address, evm_address, evm_signature, evm_verified_at

**`trades`** -- Trade records
- Standard fields plus:
- `taker_settlement_address` -- taker's address on dest_chain (resolved at trade creation)
- `maker_settlement_address` -- maker's address on source_chain (resolved at trade creation)
- Status includes: open, matched, taker_sent, taker_verified, maker_sent, maker_verified, settled, failed, taker_timed_out, maker_defaulted, cancelled

### New Tables (Phase 1-3)

**`signed_actions`** -- Every signed action
- action_type, signer_address, public_key, payload_json, payload_hash, signature, council_cosignature, trade_id, rfq_id, quote_id, verified, created_at

**`vault_deposits`** -- Deposit/withdrawal transactions
**`vault_balances`** -- Current state per maker
**`earmarks`** -- Per-quote balance reservations
**`withdrawal_requests`** -- Maker withdrawal queue
**`timeout_tracking`** -- Monthly timeout counts

---

## 8. Session Signing

**Login flow:**
1. User connects StarKey wallet
2. App prompts StarKey ONCE to sign session authorization
3. Session key stored in memory (not localStorage), expires on close or 24h

**Action signing:** Silent via session key, no popup.
**Token transfers:** Wallet popup required (MetaMask or StarKey depending on chain).

---

## 9. Supported Trading Pairs

### Cross-Chain (Both Directions Defined)

| Pair | Source Chain | Dest Chain | Taker Sends | Maker Sends |
|------|-------------|------------|-------------|-------------|
| ETH/SUPRA | sepolia | supra-testnet | ETH on Sepolia | SUPRA on Supra |
| SUPRA/ETH | supra-testnet | sepolia | SUPRA on Supra | ETH on Sepolia |
| fxUSDC/SUPRA | sepolia | supra-testnet | USDC on Sepolia | SUPRA on Supra |
| SUPRA/fxUSDC | supra-testnet | sepolia | SUPRA on Supra | USDC on Sepolia |
| fxUSDT/SUPRA | sepolia | supra-testnet | USDT on Sepolia | SUPRA on Supra |
| SUPRA/fxUSDT | supra-testnet | sepolia | SUPRA on Supra | USDT on Sepolia |
| fxAAVE/SUPRA | sepolia | supra-testnet | AAVE on Sepolia | SUPRA on Supra |
| SUPRA/fxAAVE | supra-testnet | sepolia | SUPRA on Supra | AAVE on Sepolia |
| fxLINK/SUPRA | sepolia | supra-testnet | LINK on Sepolia | SUPRA on Supra |
| SUPRA/fxLINK | supra-testnet | sepolia | SUPRA on Supra | LINK on Sepolia |

### Same-Chain EVM (Both directions, source === dest === sepolia)
ETH/fxAAVE, fxAAVE/ETH, ETH/fxLINK, fxLINK/ETH, ETH/fxUSDC, fxUSDC/ETH, ETH/fxUSDT, fxUSDT/ETH, fxAAVE/fxUSDC, fxUSDC/fxAAVE, fxAAVE/fxUSDT, fxUSDT/fxAAVE, fxAAVE/fxLINK, fxLINK/fxAAVE, fxUSDC/fxUSDT, fxUSDT/fxUSDC, fxLINK/fxUSDC, fxUSDC/fxLINK, fxLINK/fxUSDT, fxUSDT/fxLINK

### Display Convention
All `fx` prefixes are internal. UI displays clean names: AAVE, LINK, USDC, USDT.

---

## 10. Notifications (Implemented)

In-app notification banners via Supabase realtime. Auto-dismiss after 15 seconds.

| Event | Taker Sees | Maker Sees |
|-------|------------|------------|
| Quote accepted | -- | "Your quote was accepted" |
| Taker TX submitted | "TX being verified by Council" | -- |
| Taker TX verified | "Waiting for maker to settle" | "Your turn -- settle on {chain}" |
| Maker TX submitted | "Maker sent, Council verifying" | -- |
| Trade settled | "Settled in {time}" | "Settled in {time}" |
| Taker timed out | "-33% reputation" | "Deposit released" |
| Maker defaulted | "Repaid from deposit" | "-67% reputation" |

---

## 11. Implementation Status & Phases

### Completed: Phase 0

**0A. Maker Send Flow UI** -- DONE
- Role detection (isTaker, isMaker, isBot)
- Chain-aware "Settle on {ChainName}" button for both sides
- sendOnChain() routes to correct wallet based on chain

**0B. Updated Progress Bar** -- DONE
- 6 stages with timeout status handling

**0C. Notifications** -- DONE
- Supabase realtime, role-aware messages, auto-dismiss

**0D. Multi-Wallet EVM Linking** -- DONE
- EIP-6963 wallet discovery for MetaMask detection
- StarKey EVM and MetaMask both supported
- Multiple EVM addresses per user, add/remove in Profile

**0E. Chain-Aware Settlement** -- DONE
- Single settle() function, chain routing, settlement address resolution
- Both pair directions defined for all cross-chain pairs
- resolveTradeAddresses at trade creation

**0F. Settlement Address Resolution** -- DONE
- taker_settlement_address and maker_settlement_address on trades table
- lib/resolve-address.ts for chain-specific address lookup

### Phase 1 -- Signed Audit Trail

**1A. Session Signing**
- StarKey signs session authorization on login (one popup)
- Session key in memory, 24h expiry
- Files: lib/signing.ts (new), components/WalletProvider.tsx

**1B. Data Model**
- Create `signed_actions` table
- Add signature fields to trades, quotes, rfqs
- Files: migration, lib/types.ts

**1C. Signing Utilities**
- constructPayload(), sessionSign(), verifySignature()
- Deterministic JSON serialization
- Files: lib/signing.ts

**1D. Integrate Signing into Endpoints**
- submit_rfq, place_quote, accept_quote, cancel_rfq, withdraw_quote, confirm-tx
- BOTH SIDES: taker signs RFQ/acceptance/taker-confirm, maker signs quote/maker-confirm
- Files: route.ts, confirm-tx, OrderbookTable.tsx, SubmitRFQ.tsx

**1E. Trade Detail Timeline**
- Chronological signed_actions view per trade
- Shows: timestamp, action type, signer, signature hash, council co-signature
- BOTH SIDES: taker and maker see the same timeline

### Phase 2 -- Council as State Consensus

**2A. Council Signing Infrastructure**
- councilVerifyAndSign(actionType, payload, checks[])
- 5 nodes independently verify, 3-of-5 threshold
- Files: lib/council-sign.ts

**2B. Council Co-Signs Quotes**
- After platform verifies maker signature, submit to Council
- Council checks: signature, payload, balance
- MAKER PERSPECTIVE: quote not valid until Council co-signs
- TAKER PERSPECTIVE: can only accept quotes with Council co-signature

**2C. Council Confirms Matches**
- 7-point verification before trade creation
- Settlement addresses resolved here (both sides' chain addresses)
- BOTH SIDES: trade only exists after Council approval

**2D. Council Endorses Taker TX**
- On-chain verification on source_chain (could be any supported chain)
- Triggers maker notification with chain-specific instructions
- MAKER PERSPECTIVE: acts on Council's endorsement, not taker's word

**2E. Council Endorses Maker TX**
- On-chain verification on dest_chain (could be any supported chain)
- Triggers settlement for both sides

### Phase 3 -- Financial Protection

**3A. Vault Data Model**
- vault_deposits, vault_balances, earmarks, withdrawal_requests, timeout_tracking

**3B. Vault Operations**
- getAvailableBalance(), getMatchingLimit(), earmarkBalance(), releaseEarmark()
- liquidateForDefault(), processDeposit(), requestWithdrawal()
- MAKER PERSPECTIVE: can see vault balance, earmarks, matching limit in Profile
- TAKER PERSPECTIVE: protected by maker's deposit in case of default

**3C. Earmarking Integration**
- place_quote -> earmark (reduces maker's limit)
- accept_quote -> release rejected quote earmarks
- settlement -> release winning earmark
- taker timeout -> release earmark
- BOTH SIDES: earmark state visible in trade detail

**3D. Timeout Enforcement Cron**
- Runs every minute
- Checks taker_deadline and maker_deadline
- TAKER TIMEOUT: Council signs, -33% rep, earmark released, both notified
- MAKER DEFAULT: Council signs, -67% rep, deposit liquidated, taker repaid, both notified
- 3 strikes in calendar month = ban (taker side only)

**3E. Maker Dashboard**
- Vault balance: total, committed, available, matching limit
- Active earmarks list
- Withdrawal request form
- MAKER ONLY: visible in Profile sidebar

### Phase 4 -- Polish and Completion

**4A. Full Attestation Bundle**
- Assemble all 9 items from E2
- Council 3-of-5 multisig
- Submit to Supra on-chain
- BOTH SIDES: can verify the complete trade history on-chain

**4B. Withdrawal Flow UI**
- Request form, status tracking, 12-hour countdown
- MAKER ONLY

**4C. Error Recovery**
- Failed TX: stay in sending state, user retries within 30-min window
- BOTH SIDES: clear error messaging with time remaining

**4D. Orderbook View**
- All open RFQs, filterable by pair
- TAKER PERSPECTIVE: see all available liquidity
- MAKER PERSPECTIVE: see all quoting opportunities

**4E. Notification Improvements**
- 25-minute warning, ban notifications, deposit/withdrawal confirmations
- BOTH SIDES: role-appropriate messages

---

## 12. Technical Stack

- **Frontend:** Next.js 14 (App Router) + React + TypeScript
- **Backend:** Next.js API routes (serverless on Vercel)
- **Database:** Supabase (Postgres + Realtime subscriptions)
- **Oracle:** Supra DORA REST API
- **Chains:** Sepolia testnet (EVM) + Supra Testnet (extensible)
- **Wallet:** StarKey (Supra + EVM) + MetaMask (EVM) via EIP-6963
- **Settlement:** 3-of-5 multisig committee (simulated)
- **Vault:** Database-backed (simulated)
- **Deployment:** Vercel + GitHub
- **Address Resolution:** lib/resolve-address.ts + linked_addresses table

---

## 13. Key Files Reference

### Core Components
- `components/OrderbookTable.tsx` -- ActiveTrade settle flow, progress bar, role detection
- `components/WalletProvider.tsx` -- StarKey + MetaMask (EIP-6963), multi-wallet, sendOnChain
- `components/SubmitRFQ.tsx` -- RFQ creation with chain/token selectors
- `components/ProfilePanel.tsx` -- Multi-EVM address linking, add/remove
- `components/Notifications.tsx` -- Realtime trade notifications
- `app/page.tsx` -- Dashboard layout, VerificationGate (wallet chooser)

### Backend
- `app/api/skill/suprafx/route.ts` -- PAIRS config, normalizePair, RFQ/quote/trade creation with resolveTradeAddresses
- `app/api/confirm-tx/route.ts` -- TX confirmation, Council verification, bot auto-settle
- `app/api/link-address/route.ts` -- Multi-address linking + DELETE endpoint

### Libraries
- `lib/resolve-address.ts` -- Settlement address resolution (chain-specific)
- `lib/chains.ts` -- On-chain TX verification, explorer URLs
- `lib/types.ts` -- TypeScript interfaces including LinkedAddress
- `lib/reputation.ts` -- Reputation scoring
- `lib/committee-sig.ts` -- Committee signature generation
- `lib/bot-wallets.ts` -- Bot wallet operations

### New Files (Phases 1-4)
- `lib/signing.ts` -- Session signing, payload construction
- `lib/council-sign.ts` -- Council signing infrastructure
- `lib/vault.ts` -- Vault operations
- `components/MakerDashboard.tsx` -- Maker vault dashboard
- `app/api/cron/timeouts/route.ts` -- Timeout enforcement
- `app/api/vault/*` -- Vault endpoints

### Migrations
- `migrations/003_linked_addresses.sql` -- Multi-chain address linking
- `migrations/004_settlement_addresses.sql` -- Settlement address columns on trades
