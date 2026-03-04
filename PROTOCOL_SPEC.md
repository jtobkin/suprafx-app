# SupraFX Protocol Specification v2.0

## Document Purpose

This is the single source of truth for the SupraFX protocol design, data model, and implementation plan. Reference this document at the start of every development session to maintain continuity.

---

## 1. Protocol Overview

SupraFX is a cross-chain FX settlement marketplace connecting Ethereum (Sepolia) and Supra Testnet. It enables AI agents and human traders to operate as both takers and makers in a trustless RFQ marketplace.

**Core principles:**
- Every platform action is signed by the actor and stored as an audit trail
- The Settlement Council (3-of-5 multisig) co-signs critical actions as consensus on state
- Makers post stablecoin security deposits to protect takers who send funds first
- Timeouts and penalties enforce trade completion after matching
- A final on-chain attestation bundles the complete signed history of each trade

---

## 2. Actors

**Taker:** Initiates an RFQ. Goes first in settlement (sends tokens on source chain). Protected by maker's security deposit if maker defaults.

**Maker:** Quotes on open RFQs. Goes second in settlement (sends tokens on destination chain). Must maintain a stablecoin security deposit in the vault.

**Settlement Council:** 5 validator nodes (N-1 through N-5). 3-of-5 threshold for consensus. Co-signs quotes, matches, TX verifications, penalties, and the final attestation. Controls the security deposit vault.

**Any agent can be both taker and maker.** Role is per-trade, not per-account.

---

## 3. Trade Lifecycle

### Phase A -- Registration and Deposits

**A1. Agent Registration**
- Agent connects Supra wallet (StarKey), registers with public address and public key
- Signed registration stored on platform and with Council
- Public key is the identity anchor for all future signature verification

**A2. Maker Deposits Stablecoins**
- Maker deposits USDC or USDT into the Security Vault
- Signed deposit request includes: maker public address, amount, currency, timestamp
- Council verifies signature, co-signs the deposit, records the new vault balance
- Stablecoin-only policy eliminates oracle manipulation risk on collateral

**A3. DeFi Yield Deployment (simulated)**
- Council moves vault assets into whitelisted DeFi protocols
- Council signs the allocation as a group (which protocol, how much, when)
- For current implementation: simulated as a database entry, no real DeFi integration

**A4. Matching Limit Computation**
- Available balance = total deposited - committed (active earmarks) - pending withdrawal amounts
- Matching limit = 90% of available balance
- The 10% buffer covers Council fees in default scenarios
- Platform and Council both compute and sign this state

### Phase B -- RFQ and Quoting (Signed Audit Trail)

**B1. Taker Creates RFQ**
- Payload: { action: "submit_rfq", signer: taker_public_address, data: { pair, size, price, timestamp }, nonce }
- Signed by taker via session key (see Section 7)
- Platform stores signed RFQ in `signed_actions` table
- Council receives and stores copy
- Council verifies signature against taker's registered public key

**B2. Maker Places Quote**
- Payload: { action: "place_quote", signer: maker_public_address, data: { rfq_id, rate, timestamp }, nonce }
- Signed by maker via session key
- Platform stores signed quote
- Council receives copy and performs three checks:
  - (a) Maker's signature is valid against their registered public key
  - (b) Payload is correctly formatted
  - (c) Maker's available balance covers the trade value (factoring in all active commitments and pending withdrawals)
- If all three pass: Council co-signs the quote
- Council earmarks the equivalent value from maker's available balance
- Earmark reduces maker's available matching limit immediately
- A quote without Council co-signature cannot be accepted

**B3. Earmark Release Conditions**
- Earmarked balance is released when:
  - (a) Maker withdraws the quote (pre-match)
  - (b) Taker cancels the RFQ (pre-match)
  - (c) The trade settles successfully
  - (d) 30 minutes pass after a match without the taker sending funds -- trade marked as `taker_timed_out`, both parties notified
  - (e) Quote is rejected because taker accepted a different quote

**B4. Taker Cancels RFQ (Pre-Match)**
- Payload: { action: "cancel_rfq", signer: taker_public_address, data: { rfq_id, timestamp }, nonce }
- Signed cancellation stored on platform and with Council
- No penalty pre-match
- All earmarked maker balances on quotes for this RFQ are released

**B5. Maker Withdraws Quote (Pre-Match)**
- Payload: { action: "withdraw_quote", signer: maker_public_address, data: { quote_id, timestamp }, nonce }
- Signed withdrawal stored on platform and with Council
- No penalty pre-match
- Earmarked balance released

### Phase C -- Matching (Council-Verified and Council-Signed)

**C1. Taker Signs Acceptance**
- Payload: { action: "accept_quote", signer: taker_public_address, data: { quote_id, rate, timestamp }, nonce }
- Signed by taker
- Non-repudiable proof taker agreed to this specific price from this specific maker

**C2. Council Match Verification**
- Platform submits match request to Council
- Council verifies 7 conditions before signing:
  - (a) Valid taker RFQ signature, verified against taker's public key
  - (b) Valid maker quote signature, verified against maker's public key
  - (c) Valid taker acceptance signature, verified against taker's public key
  - (d) Council's own co-signature on the quote exists (confirming they already approved the maker's balance)
  - (e) No valid cancellation or withdrawal exists between quote creation and acceptance
  - (f) Maker's earmarked balance for this quote is still intact
  - (g) Taker has not been banned (3 or more post-match timeouts in current calendar month)

**C3. Council Signs Match Confirmation**
- If all 7 checks pass: Council signs the match confirmation
- Match is now FINAL
- Trade created with:
  - `match_confirmed_at` = now
  - `taker_deadline` = now + 30 minutes
  - status = `matched`
- All other earmarked balances for competing quotes on this RFQ are released (those quotes rejected)
- Only the winning quote's earmark persists

### Phase D -- Settlement (Taker First)

**D1. Taker Sends Tokens**
- Taker sends tokens on source chain (Sepolia or Supra) within 30 minutes of match
- Taker confirms TX hash with signed confirmation:
  - Payload: { action: "confirm_taker_tx", signer: taker_public_address, data: { trade_id, tx_hash, timestamp }, nonce }
- Council verifies TX on-chain (Alchemy for Sepolia, Supra RPC for Supra)
- If valid: Council signs an endorsement -- "Taker TX complete"
- Endorsement stored in `signed_actions`
- Trade moves to `taker_verified`
- `maker_deadline` set to now + 30 minutes

**D2. Council Notifies Maker**
- Council notification triggers: maker sees "Taker sent. Council verified. You have 30 minutes to send X on Y chain."
- Maker acts on Council's endorsement, not the taker's word alone
- This protects the maker from fake TX claims

**D3. Taker Timeout (30 minutes, no TX sent)**
- Council signs `taker_timed_out` status
- Taker loses 33% of their reputation score
- Council increments taker's monthly post-match timeout count
- If this is their 3rd post-match timeout in the calendar month: Council signs a ban (taker cannot be matched until next month)
- Maker's earmarked balance is released
- Both parties notified: "Trade timed out -- taker did not send within 30 minutes"

**D4. Maker Sends Tokens**
- Maker sends tokens on destination chain within 30 minutes of Council's taker-verified notification
- Maker confirms TX hash with signed confirmation:
  - Payload: { action: "confirm_maker_tx", signer: maker_public_address, data: { trade_id, tx_hash, timestamp }, nonce }
- Council verifies TX on-chain
- If valid: Council signs endorsement

**D5. Maker Default (30 minutes, no TX sent)**
- Council signs `maker_defaulted` status
- Maker loses 67% of their reputation score
- Council signs a liquidation order:
  - Equivalent trade value + 10% surcharge deducted from maker's stablecoin deposit
  - Taker is repaid the equivalent value
  - 10% surcharge goes to Council
- Both parties notified

### Phase E -- Completion and Attestation

**E1. Reputation Scoring**
- Both TXs verified by Council
- Council computes settlement time (from match confirmation to maker TX verified)
- Reputation deltas:
  - Under 5 minutes: significant boost
  - Under 15 minutes: moderate boost
  - Under 30 minutes: small boost
  - Exact formula to be tuned later

**E2. Final Attestation Bundle**
- Council assembles the complete signed history in chronological order:
  1. Signed RFQ (taker, with public address)
  2. Signed Quote (maker, with public address)
  3. Council co-signature on quote (balance verification)
  4. Signed Acceptance (taker)
  5. Council match confirmation signature
  6. Taker TX hash + Council's verification/endorsement signature
  7. Maker TX hash + Council's verification/endorsement signature
  8. Reputation deltas for both parties
  9. Updated vault accounting state

**E3. On-Chain Attestation**
- Council signs the full bundle with 3-of-5 multisig
- Submitted on-chain to Supra
- Permanent, verifiable, immutable record of the complete trade lifecycle

**E4. Post-Settlement Cleanup**
- Maker's earmarked balance for this trade is released
- Council signs the updated vault state

### Phase F -- Withdrawal from Security Deposit

**F1. Withdrawal Request**
- Maker submits signed withdrawal request:
  - Payload: { action: "request_withdrawal", signer: maker_public_address, data: { amount, timestamp }, nonce }
- Council receives request

**F2. Immediate Limit Reduction**
- Council immediately reduces maker's matching limit to 90% of (current deposit minus withdrawal amount)
- Council signs the new limit
- Takes effect before the withdrawal processes

**F3. Active Match Check**
- Maker cannot have any active matched trades (post-C3, pre-E4)
- If active matches exist: withdrawal request is queued until all active trades resolve

**F4. 12-Hour Withdrawal Timer**
- Once no active matches exist, 12-hour timer begins
- Council signs the timer start

**F5. Withdrawal Execution**
- After 12 hours: Council executes the withdrawal and signs the updated vault state
- Maker receives their funds

---

## 4. Trade Statuses

| Status | Meaning | Next States |
|--------|---------|-------------|
| `open` | RFQ created, accepting quotes | `matched`, `cancelled` |
| `matched` | Council confirmed match, taker has 30 min | `taker_sent`, `taker_timed_out` |
| `taker_sent` | Taker submitted TX, Council verifying | `taker_verified` |
| `taker_verified` | Council endorsed taker TX, maker has 30 min | `maker_sent`, `maker_defaulted` |
| `maker_sent` | Maker submitted TX, Council verifying | `settled` |
| `settled` | Both TXs verified, attestation submitted | (terminal) |
| `taker_timed_out` | Taker did not send within 30 min | (terminal) |
| `maker_defaulted` | Maker did not send within 30 min, deposit liquidated | (terminal) |
| `cancelled` | RFQ cancelled pre-match | (terminal) |
| `failed` | TX verification failed (can retry within window) | `taker_sent`, `maker_sent` |

---

## 5. Progress Bar Stages (UI)

Six visible stages for in-flight trades:

1. **Matched** -- RFQ + quote + acceptance all signed, Council confirmed
2. **Taker Sending** -- 30-min countdown, waiting for taker TX
3. **Taker Verified** -- Council endorsed taker's TX
4. **Maker Sending** -- 30-min countdown, waiting for maker TX
5. **Maker Verified** -- Council endorsed maker's TX
6. **Settled** -- attestation submitted on-chain

Each stage shows tooltip/expandable detail with sub-steps, signatures, timestamps. Countdown timers visible at stages 2 and 4.

---

## 6. Data Model

### New Tables

**`signed_actions`** -- Every signed action in the system
- id: uuid
- action_type: string (submit_rfq, place_quote, accept_quote, cancel_rfq, withdraw_quote, confirm_taker_tx, confirm_maker_tx, request_withdrawal, council_cosign_quote, council_confirm_match, council_endorse_taker_tx, council_endorse_maker_tx, council_timeout, council_default, council_liquidation, council_attestation)
- signer_address: string
- public_key: string
- payload_json: jsonb
- payload_hash: string (deterministic hash of payload)
- signature: string
- council_cosignature: string (nullable, present when Council co-signs)
- trade_id: uuid (nullable)
- rfq_id: uuid (nullable)
- quote_id: uuid (nullable)
- verified: boolean
- created_at: timestamp

**`vault_deposits`** -- Individual deposit/withdrawal transactions
- id: uuid
- maker_address: string
- amount: decimal
- currency: string (USDC or USDT)
- direction: string (deposit or withdrawal)
- tx_hash: string (nullable)
- council_signature: string
- status: string (confirmed, processing, completed)
- created_at: timestamp

**`vault_balances`** -- Current state per maker
- maker_address: string (primary key)
- total_deposited: decimal
- committed: decimal (sum of active earmarks)
- pending_withdrawal: decimal
- available: decimal (computed: total - committed - pending_withdrawal)
- matching_limit: decimal (computed: 0.9 * available)
- council_signature: string
- last_updated: timestamp

**`earmarks`** -- Per-quote balance reservations
- id: uuid
- quote_id: uuid
- trade_id: uuid (nullable, set when quote accepted)
- maker_address: string
- amount: decimal
- currency: string
- status: string (active, released, liquidated)
- release_reason: string (nullable: quote_withdrawn, rfq_cancelled, quote_rejected, trade_settled, taker_timed_out)
- created_at: timestamp
- released_at: timestamp (nullable)

**`withdrawal_requests`** -- Maker withdrawal queue
- id: uuid
- maker_address: string
- amount: decimal
- currency: string
- status: string (pending, queued, processing, completed, rejected)
- council_signature: string
- requested_at: timestamp
- eligible_at: timestamp (requested_at + 12 hours)
- completed_at: timestamp (nullable)

**`timeout_tracking`** -- Monthly timeout counts
- agent_address: string
- month: string (YYYY-MM format)
- timeout_count: integer
- banned_at: timestamp (nullable)
- last_timeout_at: timestamp (nullable)

### Modified Tables

**`trades`** -- Additional fields
- match_confirmed_at: timestamp (nullable)
- taker_deadline: timestamp (nullable, match_confirmed_at + 30 min)
- maker_deadline: timestamp (nullable, taker_verified_at + 30 min)
- council_match_signature: string (nullable)
- taker_signed_payload: string (nullable)
- maker_signed_payload: string (nullable)
- New statuses: `matched`, `taker_timed_out`, `maker_defaulted`

**`quotes`** -- Additional fields
- council_cosignature: string (nullable)
- earmark_id: uuid (nullable)
- maker_signed_payload: string (nullable)

**`rfqs`** -- Additional fields
- taker_signed_payload: string (nullable)
- taker_signature: string (nullable)

---

## 7. Session Signing

**Problem:** Requiring StarKey popup for every platform action (RFQ, quote, accept, cancel) creates terrible UX.

**Solution:** Session-based signing.

**Login flow:**
1. User connects StarKey wallet
2. App prompts StarKey ONCE to sign a session authorization message: "Authorize SupraFX session for {address} at {timestamp}. Valid for 24 hours. Nonce: {random}"
3. StarKey signs this message (one popup)
4. App derives a session signing key from the authorization
5. Session key stored in memory (NOT localStorage, NOT cookies)
6. Session expires on page close or after 24 hours

**Action signing flow (no popup):**
1. User clicks "Submit RFQ" (or any platform action)
2. App constructs the payload: { action, signer, data, timestamp, nonce }
3. App signs the payload using the session key
4. Payload + signature sent to backend
5. Backend verifies signature against the session authorization

**On-chain transaction flow (wallet popup required):**
1. User clicks "Send" for actual token transfer
2. MetaMask (Sepolia) or StarKey (Supra) popup appears
3. User approves the transaction
4. TX hash returned to the app
5. App constructs a signed confirmation payload (using session key, no popup)
6. Confirmation sent to backend

**Distinction:** Session signing = audit trail signatures (silent). Wallet signing = real token transfers (popup required).

---

## 8. Reputation System

### Scoring

**Base score:** 5.0 on registration

**Post-settlement rewards (per trade):**
- Settlement under 5 minutes: +5.0
- Settlement under 15 minutes: +3.0
- Settlement under 30 minutes: +1.0
- Exact formula to be tuned

**Penalties:**
- Taker timeout (post-match, no TX within 30 min): lose 33% of current score
- Maker default (post-taker-verified, no TX within 30 min): lose 67% of current score

### Timeout Tracking

- Tracked per calendar month
- 3 post-match timeouts in one month = banned from matching until next month
- Council signs all timeout events and bans
- Counter resets on the 1st of each month

### Future Enhancements (post-protocol implementation)

- Reputation display: overall score, monthly timeout count (X/3), trade count, completion rate, average settlement speed, account age
- Minimum reputation threshold to submit RFQs above certain size
- Rate locking display (oracle vs locked rate comparison)

---

## 9. Security Deposit Vault

### Structure

- Stablecoins only (USDC, USDT) -- eliminates oracle manipulation risk
- Controlled by Settlement Council (3-of-5 multisig)
- For current implementation: database-backed (no smart contract)
- Production: would be an on-chain multisig vault

### Matching Limit

- matching_limit = 0.9 * (total_deposited - committed - pending_withdrawal)
- The 10% buffer covers: Council fees in default scenarios, operational overhead
- Example: $1000 deposited, $0 committed, $0 pending = $900 matching limit

### Earmarking

- When Council co-signs a quote: equivalent trade value earmarked from maker's balance
- Earmark reduces available balance and matching limit immediately
- Multiple quotes can be active simultaneously, each with its own earmark
- Total earmarks cannot exceed available balance
- Earmarks released on: quote withdrawal, RFQ cancellation, quote rejection, trade settlement, taker timeout

### Default and Liquidation

- Maker defaults (no TX within 30 min after taker verified)
- Council signs liquidation order
- Amount deducted: trade value + 10% surcharge
- Trade value repaid to taker
- 10% surcharge retained by Council
- Maker's vault balance and matching limit updated accordingly

### Withdrawal Process

1. Maker signs withdrawal request
2. Council immediately reduces matching limit (accounts for withdrawal amount)
3. If active matches exist: queued until resolved
4. Once clear: 12-hour cooling period begins
5. After 12 hours: Council executes withdrawal, signs updated state

---

## 10. Notifications

In-app notification banners powered by Supabase realtime.

| Event | Recipient | Message |
|-------|-----------|---------|
| Quote accepted | Maker | "Your quote on {TX_ID} was accepted. Match confirmed." |
| Taker TX verified | Maker | "Taker sent. Council verified. Send {amount} {token} on {chain}. {time} remaining." |
| Maker TX verified | Taker | "Maker sent. Council verifying. Settlement in progress." |
| Trade settled | Both | "Trade {TX_ID} settled in {time}. Attestation: {tx_hash}" |
| Taker timeout | Both | "Trade {TX_ID} timed out. Taker did not send within 30 minutes." |
| Maker default | Both | "Trade {TX_ID}: Maker defaulted. Deposit liquidated. Taker repaid." |
| Timeout warning | Active party | "5 minutes remaining to send on {TX_ID}." |
| Ban notification | Taker | "3 timeouts this month. Matching suspended until {next_month}." |
| Withdrawal confirmed | Maker | "Withdrawal of {amount} processed." |

---

## 11. Implementation Phases

### Phase 0 -- Unblock Full Trade Lifecycle

**0A. Maker Send Flow UI**
- ActiveTrade component: detect when user is the maker and trade is `taker_verified`
- Show: "Your turn -- send {amount} {token} on {chain}"
- Send button triggers wallet (MetaMask for Sepolia, StarKey for Supra)
- TX hash confirmation calls `/api/confirm-tx` with `side: 'maker'`
- Files: components/OrderbookTable.tsx (ActiveTrade section)

**0B. Updated Progress Bar**
- 6 stages: Matched > Taker Sending > Taker Verified > Maker Sending > Maker Verified > Settled
- Countdown timers at stages 2 and 4
- Current stage highlighted, completed green, future dimmed
- Files: components/OrderbookTable.tsx (Progress component)

**0C. Notifications**
- Notification banner component at top of page
- Supabase realtime triggers for: quote accepted, taker TX verified, trade settled, timeout
- Files: components/Notifications.tsx (new), app/page.tsx

### Phase 1 -- Signed Audit Trail

**1A. Session Signing**
- StarKey signs session authorization on login (one popup)
- Session key stored in memory, expires on close or 24h
- All platform actions signed silently via session key
- Files: lib/signing.ts (new), components/WalletProvider.tsx

**1B. Data Model**
- Create `signed_actions` table in Supabase
- Add fields to `trades`, `quotes`, `rfqs` tables
- Files: Supabase migration, lib/types.ts

**1C. Signing Utilities**
- constructPayload(), sessionSign(), verifySignature()
- Deterministic JSON serialization for payload hashing
- Files: lib/signing.ts (new)

**1D. Integrate Signing into Endpoints**
- submit_rfq, place_quote, accept_quote, cancel_rfq, withdraw_quote, confirm-tx
- Each: construct payload > sign > send with signature > backend verifies > store in signed_actions
- Files: app/api/skill/suprafx/route.ts, app/api/confirm-tx/route.ts, components/OrderbookTable.tsx, components/SubmitRFQ.tsx

**1E. Trade Detail Timeline**
- Chronological view of all signed_actions for a trade
- Replaces current 3-column detail grid
- Each entry: timestamp, action type, signer, signature hash, council co-signature
- Files: components/OrderbookTable.tsx (expanded trade view), components/MyTrades.tsx

### Phase 2 -- Council as State Consensus

**2A. Council Signing Infrastructure**
- councilVerifyAndSign(actionType, payload, checks[])
- 5 nodes independently verify, 3-of-5 threshold
- Produces aggregated co-signature from individual node signatures
- Writes to committee_votes and committee_requests
- Files: lib/council-sign.ts (new or rewrite)

**2B. Council Co-Signs Quotes**
- place_quote endpoint: after platform verifies maker signature, submit to Council
- Council checks: signature valid, payload formatted, balance covers trade
- If approved: Council co-signs, earmark created
- Without Council co-signature, quote cannot be accepted
- Files: app/api/skill/suprafx/route.ts (handlePlaceQuote)

**2C. Council Confirms Matches**
- accept_quote endpoint: instead of directly creating trade, submit match request to Council
- Council runs 7-point verification (see C2 in protocol)
- Only if approved: trade created with deadlines
- Files: app/api/skill/suprafx/route.ts (handleAcceptQuote), lib/council-match.ts (new)

**2D. Council Endorses Taker TX**
- confirm-tx with side=taker: after on-chain verification, Council signs endorsement
- Endorsement triggers maker notification
- Trade moves to taker_verified with maker_deadline
- Files: app/api/confirm-tx/route.ts

**2E. Council Endorses Maker TX**
- confirm-tx with side=maker: after on-chain verification, Council signs endorsement
- Triggers settlement flow
- Files: app/api/confirm-tx/route.ts

### Phase 3 -- Financial Protection

**3A. Vault Data Model**
- Create tables: vault_deposits, vault_balances, earmarks, withdrawal_requests, timeout_tracking
- Files: Supabase migration, lib/types.ts

**3B. Vault Operations**
- getAvailableBalance(), getMatchingLimit(), earmarkBalance(), releaseEarmark()
- liquidateForDefault(), processDeposit(), requestWithdrawal(), processWithdrawal()
- All operations require Council co-signature
- Files: lib/vault.ts (new)

**3C. Earmarking Integration**
- place_quote calls earmarkBalance after Council approves
- accept_quote releases earmarks on rejected quotes
- Settlement releases winning earmark
- Taker timeout releases earmark
- Files: app/api/skill/suprafx/route.ts

**3D. Timeout Enforcement Cron**
- /api/cron/timeouts runs every minute
- Check 1: matched trades past taker_deadline > taker_timed_out + 33% penalty + timeout count
- Check 2: taker_verified trades past maker_deadline > maker_defaulted + 67% penalty + liquidation
- Council signs all state changes
- Files: app/api/cron/timeouts/route.ts (new)

**3E. Maker Dashboard**
- Vault balance display: total, committed, available, matching limit, pending withdrawal
- Active earmarks list
- Withdrawal request form and status
- Files: components/MakerDashboard.tsx (new), or section in ProfilePanel

### Phase 4 -- Polish and Completion

**4A. Full Attestation Bundle**
- Assemble all 9 items from E2
- Pull signed_actions in chronological order
- Council 3-of-5 multisig over full bundle
- Submit to Supra on-chain
- Files: app/api/confirm-tx/route.ts, lib/council-sign.ts

**4B. Withdrawal Flow UI**
- Request form in maker dashboard
- Status tracking (pending > queued > processing > completed)
- 12-hour countdown display
- Files: components/MakerDashboard.tsx

**4C. Error Recovery**
- Failed TX verification: trade stays in sending state, user can retry with new TX hash within 30-min window
- Clear error messaging with time remaining
- Files: app/api/confirm-tx/route.ts, components/OrderbookTable.tsx

**4D. Orderbook View**
- Master orderbook: all open RFQs across all pairs
- Filterable by pair
- Per-pair sub-views when volume is high
- All quotes visible on each RFQ, sorted by best rate
- Files: components/OrderbookTable.tsx (rewrite Active Trades section)

**4E. Notification Improvements**
- 25-minute warning ("5 minutes remaining")
- Ban notifications
- Deposit/withdrawal confirmations
- Earmark status changes
- Files: components/Notifications.tsx

---

## 12. Supported Trading Pairs

### Cross-Chain (Sepolia <> Supra Testnet)
ETH/SUPRA, SUPRA/ETH, fxAAVE/SUPRA, fxLINK/SUPRA, fxUSDC/SUPRA, fxUSDT/SUPRA

### Same-Chain EVM (Sepolia <> Sepolia)
ETH/fxAAVE, ETH/fxLINK, ETH/fxUSDC, ETH/fxUSDT, fxAAVE/fxLINK, fxAAVE/fxUSDC, fxAAVE/fxUSDT, fxLINK/fxUSDC, fxLINK/fxUSDT

### Display Convention
All `fx` prefixes are internal. UI displays clean names: AAVE, LINK, USDC, USDT.

### Security Deposit Currencies
USDC, USDT only (stablecoins).

---

## 13. Technical Stack

- **Frontend:** Next.js 14 (App Router) + React + TypeScript
- **Backend:** Next.js API routes (serverless on Vercel)
- **Database:** Supabase (Postgres + Realtime subscriptions)
- **Oracle:** Supra DORA REST API (prod-kline-rest.supra.com)
- **Chains:** Sepolia testnet (EVM) + Supra Testnet
- **Wallet:** StarKey (Supra) + MetaMask (EVM)
- **Settlement:** 3-of-5 multisig committee (simulated, production would be on-chain)
- **Vault:** Database-backed (simulated, production would be multisig smart contract)
- **Deployment:** Vercel + GitHub integration
- **Cron:** Vercel cron for /api/cron/verify (every minute), /api/cron/timeouts (every minute)

---

## 14. API Endpoints

### Core Marketplace
- `POST /api/skill/suprafx` -- All marketplace actions (get_pairs, submit_rfq, place_quote, accept_quote, cancel_rfq, withdraw_quote, check_trade, list_trades)
- `GET /api/skill/suprafx` -- API documentation (OpenClaw skill spec)

### Settlement
- `POST /api/confirm-tx` -- Confirm TX hash for taker or maker side
- `GET /api/cron/verify` -- Committee verification cron
- `GET /api/cron/timeouts` -- Timeout enforcement cron (new)

### Oracle
- `GET /api/oracle?pair=ETH/SUPRA` -- Real-time price data from Supra DORA

### Vault (new)
- `POST /api/vault/deposit` -- Submit deposit (with signed payload)
- `POST /api/vault/withdraw` -- Request withdrawal (with signed payload)
- `GET /api/vault/balance?address=0x...` -- Get vault balance and limits

---

## 15. Key Files Reference

### Core Components
- `app/page.tsx` -- Main dashboard layout
- `components/OrderbookTable.tsx` -- Active trades, in-flight trades, completed trades, ActiveTrade settlement UI
- `components/SubmitRFQ.tsx` -- RFQ creation form
- `components/MyTrades.tsx` -- Personal trade history
- `components/CommitteePanel.tsx` -- Settlement Council view
- `components/AgentsPanel.tsx` -- Counterparties list
- `components/OraclePrice.tsx` -- Oracle price display
- `components/Header.tsx` -- App header
- `components/WalletProvider.tsx` -- StarKey wallet connection

### Backend
- `app/api/skill/suprafx/route.ts` -- Main marketplace API
- `app/api/confirm-tx/route.ts` -- TX confirmation and committee verification
- `app/api/cron/verify/route.ts` -- Committee verification cron
- `app/api/oracle/route.ts` -- Oracle proxy

### Libraries
- `lib/types.ts` -- TypeScript interfaces
- `lib/supabase.ts` -- Supabase client
- `lib/tx-id.ts` -- Deterministic TX ID generation
- `lib/reputation.ts` -- Reputation scoring
- `lib/committee-sig.ts` -- Committee signature generation
- `lib/chains.ts` -- On-chain TX verification
- `lib/bot-wallets.ts` -- Bot wallet operations

### New Files (to be created)
- `lib/signing.ts` -- Session signing, payload construction, verification
- `lib/council-sign.ts` -- Council signing infrastructure (rewrite of committee-sig)
- `lib/council-match.ts` -- Match verification logic
- `lib/vault.ts` -- Vault operations
- `components/Notifications.tsx` -- Notification banners
- `components/MakerDashboard.tsx` -- Maker vault dashboard
- `app/api/cron/timeouts/route.ts` -- Timeout enforcement
- `app/api/vault/deposit/route.ts` -- Vault deposit endpoint
- `app/api/vault/withdraw/route.ts` -- Vault withdrawal endpoint
- `app/api/vault/balance/route.ts` -- Vault balance endpoint

---

## 16. Open Questions for Future

- Exact reputation scoring formula (boost amounts per time bracket)
- RFQ size limits relative to reputation
- DeFi yield strategy selection (which protocols, risk parameters)
- Smart contract vault implementation for production
- Rate locking display (oracle vs locked rate comparison)
- Cross-chain bridge verification (relay proofs vs RPC verification)
- Council node selection and rotation
- Fee structure beyond the 10% default surcharge
