# SupraFX Protocol Specification v3.1

## Document Purpose

This is the single source of truth for the SupraFX protocol. Upload this document at the start of every new Claude conversation to restore full project context. It contains the product vision, architecture, design principles, data model, current implementation state, and the forward implementation plan.

**Repo:** suprafx-app (Next.js 14, deployed on Vercel)
**Last updated:** March 4, 2026

---

## 1. What Is SupraFX

SupraFX is a cross-chain FX settlement marketplace. Users trade tokens across chains (Ethereum Sepolia and Supra Testnet today, more chains later) through a Request-for-Quote (RFQ) model. AI agents and human traders can both participate as takers or makers.

**How a trade works:**
1. A taker submits an RFQ: "I want to sell 1 SUPRA for USDC"
2. Makers see the RFQ and place competing quotes with their offered rate
3. The taker accepts the best quote -- a trade is created
4. The taker goes first: sends their tokens on the source chain
5. The Settlement Council verifies the taker's TX on-chain
6. The maker goes second: sends their tokens on the destination chain
7. The Settlement Council verifies the maker's TX, and the trade settles
8. An attestation bundle of the full trade history is submitted on-chain

**The taker always goes first.** This is the core settlement rule. The maker is protected by a security deposit in a stablecoin vault. If the maker defaults after the taker sends, the taker is repaid from the maker's deposit.

---

## 2. Critical Design Principles

These principles emerged from building Phase 0 and must guide ALL future development. Violating them introduces bugs.

### 2.1 Two-Sided Marketplace Awareness

SupraFX is a TWO-SIDED MARKETPLACE. Every feature, UI state, API response, notification, and error message must be designed and reasoned about from BOTH the taker's and maker's perspective. Before writing any code, explicitly ask: "What does the taker see here? What does the maker see? What is the Council verifying?"

### 2.2 Pair Direction = Chain Order

The pair name `sellToken/buyToken` encodes which chain each side settles on:
- `SUPRA/fxUSDC` means: taker sells SUPRA (source_chain = supra-testnet), maker sells USDC (dest_chain = sepolia)
- `fxUSDC/SUPRA` means: taker sells USDC (source_chain = sepolia), maker sells SUPRA (dest_chain = supra-testnet)

Both directions of every cross-chain pair MUST be explicitly defined in the PAIRS config with correct source/dest chains. The `normalizePair` function must NEVER silently reverse a cross-chain pair, as this swaps which side sends first on which chain.

### 2.3 Identity Addresses != Settlement Addresses

Users log in with their Supra address (via StarKey). This is their identity address -- reputation accumulates here, and it's used as the primary key across the system. But when settling on a different chain (e.g., Sepolia), they need their EVM address.

The system resolves settlement addresses at trade creation time:
- `maker_settlement_address` = maker's address on source_chain (where taker sends TO maker)
- `taker_settlement_address` = taker's address on dest_chain (where maker sends TO taker)

If stored addresses are null (old trades, resolution failure), the frontend does a live lookup via `/api/link-address?supra={counterparty}` to resolve dynamically.

### 2.4 One Button: "Settle on {ChainName}"

The user's only action is clicking "Settle on Ethereum Sepolia" or "Settle on Supra Testnet". There is no "manual mode", "auto mode", or "demo mode". The system determines everything from context:
- Am I taker or maker? (determines `side`)
- What chain? (source_chain for taker, dest_chain for maker)
- Which wallet? (StarKey for Supra, MetaMask/StarKey EVM for Sepolia)
- Who am I sending to? (resolved settlement address)
- How long to wait for block confirmation? (12s Ethereum, 3s Supra)

### 2.5 Wallet Detection via EIP-6963

StarKey overrides `window.ethereum` and sets `isMetaMask: true`. Standard provider detection fails. The system uses EIP-6963 event-based wallet discovery where each wallet announces itself by its real identity (`io.metamask`, `io.starkey`). This is the only reliable way to detect MetaMask when StarKey is installed.

### 2.6 Adding New Chains

When adding a new chain, update:
1. `PAIRS` config + `REF_PRICES` in `app/api/skill/suprafx/route.ts` -- both directions
2. `sendOnChain()` in `components/OrderbookTable.tsx` -- add chain case
3. `chainName()` in `components/OrderbookTable.tsx` -- add display name
4. `resolveSettlementAddress()` in `lib/resolve-address.ts` -- add resolution logic
5. `verifyOnChain()` in `app/api/confirm-tx/route.ts` -- add verification
6. `CHAINS` in `components/SubmitRFQ.tsx` -- add to chain/token selector
7. `lib/chains.ts` -- add explorer URL and RPC

Everything else (UI, notifications, progress bar, Council) adapts automatically.

---

## 3. Actors

**Taker:** Initiates an RFQ. Goes first in settlement (sends tokens on source_chain). Protected by maker's security deposit if maker defaults.

**Maker:** Quotes on open RFQs. Goes second in settlement (sends tokens on dest_chain). Must maintain a stablecoin security deposit in the vault.

**Settlement Council:** 5 validator nodes (N-1 through N-5). 3-of-5 threshold for consensus. Co-signs quotes, matches, TX verifications, penalties, and the final attestation. Controls the security deposit vault.

**Auto-Maker Bot:** An automated market maker (`auto-maker-bot`) that quotes on RFQs and settles instantly via a server-side Supra wallet (`BOT_SUPRA_PRIVATE_KEY`). When the taker confirms their TX and the bot is the maker, the backend automatically sends the maker's tokens and settles in one API call.

**Any agent can be both taker and maker.** Role is per-trade, not per-account.

---

## 4. Trade Lifecycle

### Phase A -- Registration and Address Linking

**A1. Supra Wallet Connection**
- User connects StarKey wallet, Supra address becomes primary identity
- Supra address is the anchor for reputation, trade history, and vault balance

**A2. Multi-Chain Address Linking**
- User links EVM addresses via signed message verification (personal_sign)
- Can link via StarKey EVM or MetaMask (EIP-6963 discovery)
- Multiple EVM addresses supported per user, managed in Profile sidebar (add/remove)
- Stored in `linked_addresses` table: (supra_address, chain, linked_address, wallet_provider, signature, verified_at)
- UNIQUE constraint on (supra_address, linked_address)

**A3. Verification Gate**
- Users must link at least one EVM address before accessing the trading dashboard
- `VerificationGate` component in `app/page.tsx` enforces this with wallet chooser (StarKey EVM / MetaMask)

**A4. Maker Deposits (Phase 3 -- not yet implemented)**
- Maker deposits USDC or USDT into the Security Vault
- Stablecoins only -- eliminates oracle manipulation risk on collateral

### Phase B -- RFQ and Quoting

**B1. Taker Creates RFQ**
- Taker selects Sell token/chain and Buy token/chain in `SubmitRFQ` component
- Frontend builds pair: `buildPair(sellToken, buyToken)` with fx-prefix mapping
- API normalizes pair, looks up PAIRS config for source_chain and dest_chain
- RFQ stored with pair, size, reference_price, source_chain, dest_chain
- Bot auto-quotes with 0.3% spread below reference price

**B2. Maker Places Quote**
- Maker quotes a rate on an open RFQ
- (Phase 2+): Council checks signature, payload, balance, earmarks funds

**B3. Taker Accepts Quote**
- Taker accepts a specific quote
- Other pending quotes rejected, RFQ status set to matched
- Trade created with:
  - Settlement addresses resolved via `resolveTradeAddresses()` from `lib/resolve-address.ts`
  - `taker_settlement_address` = taker's address on dest_chain (maker sends here)
  - `maker_settlement_address` = maker's address on source_chain (taker sends here)

### Phase C -- Settlement (Taker First)

**C1. Taker Settles**
- Taker sees: "Settle on {chainName(source_chain)}" button
- `settle()` function: determines chain, wallet, recipient (maker_settlement_address)
- Wallet popup, TX signed, hash submitted to `/api/confirm-tx` with `side: "taker"`
- Council verifies TX on-chain, endorses
- If maker is auto-maker-bot: backend auto-sends maker tokens and settles in one call

**C2. Maker Settles**
- Maker sees notification: "Your turn -- settle on {chainName(dest_chain)}"
- Same `settle()` function: chain = dest_chain, recipient = taker_settlement_address
- TX hash submitted to `/api/confirm-tx` with `side: "maker"`
- Council verifies, trade settles

**C3. Taker Timeout (30 min):** -33% reputation, earmark released, 3 strikes = monthly ban
**C4. Maker Default (30 min):** -67% reputation, deposit liquidated, taker repaid

### Phase D -- Completion

**D1. Reputation Update** -- Both parties scored based on settlement speed
**D2. Attestation Bundle** -- 9-item signed history submitted on-chain to Supra
**D3. Cleanup** -- Earmarks released, vault state updated

---

## 5. Trade Statuses (Both Sides)

| Status | Taker Sees | Maker Sees |
|--------|------------|------------|
| `open` | "Settle on {source_chain}" button + paste hash | "Waiting for taker to settle on {source_chain}..." |
| `taker_sent` | "Council verifying..." | "Council verifying taker TX..." |
| `taker_verified` | "Waiting for maker to settle on {dest_chain}..." | "Settle on {dest_chain}" button + paste hash |
| `maker_sent` | "Council verifying maker TX..." | "Council verifying..." |
| `settled` | Explorer links for both TXs, settlement time | Explorer links for both TXs, settlement time |
| `taker_timed_out` | "-33% reputation" | "Deposit released" |
| `maker_defaulted` | "Repaid from maker deposit" | "-67% reputation, deposit liquidated" |
| `failed` | Can retry within 30-min window | Can retry within 30-min window |

---

## 6. Progress Bar (6 Stages)

1. **Matched** -- Trade created, Council confirmed
2. **Taker Sending** -- 30-min countdown, taker settling on source_chain
3. **Taker Verified** -- Council endorsed taker TX
4. **Maker Sending** -- 30-min countdown, maker settling on dest_chain
5. **Maker Verified** -- Council endorsed maker TX
6. **Settled** -- Attestation submitted

Timeout states: `taker_timed_out` shows red at stage 2, `maker_defaulted` shows red at stage 4.

---

## 7. Supported Trading Pairs

### Cross-Chain (Both Directions Explicit)

| Pair | source_chain | dest_chain | Taker Sends | Maker Sends |
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

### Same-Chain EVM (source === dest === sepolia)
All ERC-20 and ETH combinations in both directions.

### Display Convention
`fx` prefix is internal only. UI shows: AAVE, LINK, USDC, USDT (via `displayPair()` which strips `fx`).

---

## 8. Data Model

### Current Tables

**`agents`** -- Registered traders
- wallet_address (PK), role, domain, chains, rep_deposit_base, rep_total, trade_count

**`rfqs`** -- Requests for quote
- id, display_id, taker_address, pair, size, source_chain, dest_chain, max_slippage, reference_price, status (open|matched|expired|cancelled), expires_at

**`quotes`** -- Maker quotes on RFQs
- id, rfq_id, maker_address, rate, status (pending|accepted|rejected|expired|withdrawn)

**`trades`** -- Active and completed trades
- id, display_id, rfq_id, pair, size, rate, notional, source_chain, dest_chain
- taker_address, maker_address (Supra identity addresses)
- taker_settlement_address (taker's addr on dest_chain -- where maker sends TO)
- maker_settlement_address (maker's addr on source_chain -- where taker sends TO)
- status, taker_tx_hash, taker_tx_confirmed_at, maker_tx_hash, maker_tx_confirmed_at
- settle_ms, settled_at

**`linked_addresses`** -- Multi-chain address linking
- supra_address, chain, linked_address, wallet_provider, signature, verified_at
- UNIQUE(supra_address, linked_address)

**`address_links`** -- Legacy single EVM link (backwards compat)
- supra_address, evm_address, evm_signature, evm_verified_at

**`committee_requests`** -- Council verification records
- trade_id, verification_type, status, approvals, rejections, attestation_tx

**`committee_votes`** -- Individual node votes
- trade_id, node_id, verification_type, decision, chain, tx_hash, signature

### Tables To Create (Phase 1-3)

**`signed_actions`** -- Every signed platform action
- action_type (submit_rfq, place_quote, accept_quote, cancel_rfq, withdraw_quote, confirm_taker_tx, confirm_maker_tx, council_cosign, council_endorse, etc.)
- signer_address, public_key, payload_json, payload_hash, signature, council_cosignature
- trade_id, rfq_id, quote_id, verified

**`vault_deposits`** -- Deposit/withdrawal ledger
**`vault_balances`** -- Current maker balances and limits
**`earmarks`** -- Per-quote balance reservations
**`withdrawal_requests`** -- Withdrawal queue with 12-hour cooling
**`timeout_tracking`** -- Monthly timeout counts per agent

---

## 9. Notifications (Implemented)

In-app banners via Supabase realtime (`components/Notifications.tsx`). Auto-dismiss after 15 seconds. Triggered by trade state changes, deduplicated, max 10 in queue. Only fire on state changes after initial page load.

| Event | Taker Sees | Maker Sees | Type |
|-------|------------|------------|------|
| Quote accepted | -- | "Your quote was accepted" | action |
| Taker TX submitted | "TX being verified" | -- | info |
| Taker TX verified | "Waiting for maker" | "Your turn -- settle on {chain}" | action |
| Maker TX submitted | "Maker sent, verifying" | -- | info |
| Settled | "Settled in {time}" | "Settled in {time}" | success |
| Taker timed out | "-33% reputation" | "Deposit released" | warning |
| Maker defaulted | "Repaid from deposit" | "-67% reputation" | error |

---

## 10. Technical Stack

- **Frontend:** Next.js 14 (App Router) + React + TypeScript + Tailwind
- **Backend:** Next.js API routes (serverless on Vercel)
- **Database:** Supabase (Postgres + Realtime subscriptions for live updates)
- **Oracle:** Supra DORA REST API (prod-kline-rest.supra.com)
- **Chains:** Sepolia testnet (EVM) + Supra Testnet (extensible to more)
- **Wallets:** StarKey (Supra + EVM) + MetaMask (EVM) via EIP-6963 discovery
- **Bot:** Auto-maker bot with server-side Supra wallet (BOT_SUPRA_PRIVATE_KEY)
- **Settlement Council:** 5-node simulated committee (production: on-chain multisig)
- **Deployment:** Vercel + GitHub integration

---

## 11. File Structure

### Frontend Components
- `app/page.tsx` -- Dashboard layout, VerificationGate (wallet chooser), Supabase realtime subscriptions
- `components/OrderbookTable.tsx` -- ActiveTrade (settle flow, progress bar, role detection, live address resolution), RFQ list, quote acceptance
- `components/SubmitRFQ.tsx` -- RFQ creation form with chain/token selectors, oracle price
- `components/WalletProvider.tsx` -- StarKey + MetaMask (EIP-6963), ProfileData with LinkedAddress[], sendSepoliaEth, sendSupraTokens
- `components/ProfilePanel.tsx` -- Multi-EVM address linking (add/remove), reputation display, settlement routing
- `components/Notifications.tsx` -- Realtime trade state change notifications
- `components/MyTrades.tsx` -- Personal trade history
- `components/CommitteePanel.tsx` -- Settlement Council status display
- `components/AgentsPanel.tsx` -- Counterparty list
- `components/OraclePrice.tsx` -- Live oracle price from Supra DORA
- `components/Header.tsx` -- App header with profile button
- `components/KPIs.tsx` -- Dashboard metrics

### API Routes
- `app/api/skill/suprafx/route.ts` -- Main marketplace: PAIRS config, normalizePair, submit_rfq, place_quote, accept_quote (with resolveTradeAddresses), cancel_rfq, withdraw_quote, check_trade, list_trades, get_pairs
- `app/api/confirm-tx/route.ts` -- TX confirmation, Council verification, bot auto-settlement, reputation update, on-chain attestation
- `app/api/link-address/route.ts` -- Multi-address linking (POST), removal (DELETE), lookup (GET) with linked_addresses + legacy fallback
- `app/api/oracle/route.ts` -- Supra DORA oracle proxy
- `app/api/cron/verify/route.ts` -- Periodic committee verification
- `app/api/cron/maker/route.ts` -- Bot maker auto-quoting

### Libraries
- `lib/resolve-address.ts` -- resolveSettlementAddress(), resolveTradeAddresses() -- chain-specific address lookup via linked_addresses + address_links
- `lib/chains.ts` -- verifySepoliaTx(), verifySupraTx(), explorerUrl() -- on-chain verification
- `lib/types.ts` -- Trade, RFQ, Quote, Agent, CommitteeRequest, CommitteeVote interfaces
- `lib/reputation.ts` -- updateReputation() based on settlement speed
- `lib/committee-sig.ts` -- generateMultisig() for committee signatures
- `lib/bot-wallets.ts` -- botSendSupraTokens(), submitCommitteeAttestation()
- `lib/supabase.ts` -- Supabase client (browser + service)
- `lib/address-links.ts` -- Legacy address link helpers

### Migrations
- `migrations/003_linked_addresses.sql` -- linked_addresses table
- `migrations/004_settlement_addresses.sql` -- taker/maker_settlement_address columns on trades

---

## 12. Implementation Status

### Phase 0 -- COMPLETE

**0A. Maker Send Flow UI** -- Role detection (isTaker, isMaker, isBot), chain-aware buttons
**0B. Progress Bar** -- 6 stages with timeout status handling
**0C. Notifications** -- Supabase realtime, role-aware, auto-dismiss
**0D. Multi-Wallet EVM Linking** -- EIP-6963, StarKey EVM + MetaMask, multiple addresses
**0E. Chain-Aware Settlement** -- Single settle(), sendOnChain(), both pair directions defined
**0F. Settlement Address Resolution** -- resolveTradeAddresses at creation, live frontend fallback

---

## 13. Implementation Plan: Phase 1-4

### Phase 1 -- Signed Audit Trail

**1A. Session Signing**
- On StarKey login, sign session authorization message (one popup)
- Derive session key, store in memory (not localStorage), 24h expiry
- All platform actions signed silently via session key
- Token transfers still require wallet popup
- New file: `lib/signing.ts`
- Modified: `components/WalletProvider.tsx`

**1B. Data Model**
- Create `signed_actions` table in Supabase
- Add signature fields to trades, quotes, rfqs tables
- Migration file + update `lib/types.ts`

**1C. Signing Utilities**
- `constructPayload(action, signer, data, nonce)` -- deterministic JSON serialization
- `sessionSign(payload, sessionKey)` -- sign with session key
- `verifySignature(payload, signature, publicKey)` -- verify on backend
- New file: `lib/signing.ts`

**1D. Integrate Signing into Endpoints**
- submit_rfq: taker signs RFQ payload
- place_quote: maker signs quote payload
- accept_quote: taker signs acceptance
- cancel_rfq, withdraw_quote: respective party signs
- confirm-tx: both sides sign their TX confirmation
- Backend verifies all signatures, stores in signed_actions
- BOTH SIDES sign their respective actions

**1E. Trade Detail Timeline**
- Chronological view of all signed_actions for a trade
- Each entry: timestamp, action_type, signer (short addr), signature hash, council co-signature
- Both taker and maker see the same audit trail

### Phase 2 -- Council as State Consensus

**2A. Council Signing Infrastructure**
- `councilVerifyAndSign(actionType, payload, checks[])`
- 5 nodes verify independently, 3-of-5 threshold
- New file: `lib/council-sign.ts`

**2B. Council Co-Signs Quotes**
- Maker quote not valid until Council co-signs
- Council checks: signature valid, payload format, balance coverage
- Earmark created on approval
- TAKER can only accept quotes with Council co-signature

**2C. Council Confirms Matches**
- 7-point verification before trade creation
- Settlement addresses resolved at this point
- Trade only exists after Council approval

**2D-2E. Council Endorses TXs**
- On-chain verification on correct chain (source for taker, dest for maker)
- Triggers notifications and state transitions

### Phase 3 -- Financial Protection

**3A. Vault Data Model** -- vault_deposits, vault_balances, earmarks, withdrawal_requests, timeout_tracking
**3B. Vault Operations** -- deposit, withdraw, earmark, release, liquidate (all Council co-signed)
**3C. Earmarking** -- place_quote earmarks, accept_quote releases rejected, settlement releases
**3D. Timeout Cron** -- `/api/cron/timeouts` every minute, taker + maker deadlines, penalties
**3E. Maker Dashboard** -- Vault balance, earmarks, withdrawal form in Profile

### Phase 4 -- Polish

**4A. Full Attestation** -- 9-item bundle, Council 3-of-5 multisig, on-chain submission
**4B. Withdrawal Flow** -- Request, queue, 12-hour cooling, execution
**4C. Error Recovery** -- Retry with new TX hash within window
**4D. Orderbook View** -- All open RFQs, filterable by pair
**4E. Notification Improvements** -- 25-min warnings, ban alerts, deposit/withdrawal confirmations

---

## 14. Session Signing Design (Phase 1)

**Problem:** StarKey popup for every platform action = terrible UX.

**Solution:**
1. Login: StarKey signs session authorization message (one popup): "Authorize SupraFX session for {address} at {timestamp}. Valid 24h. Nonce: {random}"
2. App derives session signing key from authorization
3. Session key in memory only (no persistence)
4. Platform actions (RFQ, quote, accept, cancel): signed silently via session key
5. Token transfers (actual sends): wallet popup required

**Distinction:** Session signing = audit trail. Wallet signing = real money movement.

---

## 15. Reputation System

**Base score:** 5.0 on registration
**Post-settlement:** +5.0 (<5min), +3.0 (<15min), +1.0 (<30min)
**Penalties:** Taker timeout: -33%. Maker default: -67%.
**Ban:** 3 taker timeouts in calendar month = matching suspended until next month.

---

## 16. Security Deposit Vault (Phase 3)

- Stablecoins only (USDC, USDT)
- Matching limit = 90% of (deposited - committed - pending_withdrawal)
- Earmarks: per-quote balance reservations, released on settlement/timeout/rejection
- Default liquidation: trade value + 10% surcharge, taker repaid, surcharge to Council
- Withdrawal: signed request, immediate limit reduction, 12-hour cooling period

---

## 17. Open Questions

- Exact reputation formula tuning
- RFQ size limits relative to reputation
- DeFi yield strategy for vault assets
- Smart contract vault for production
- Council node selection and rotation
- Fee structure beyond 10% default surcharge
- Cross-chain bridge verification (relay proofs vs RPC)
