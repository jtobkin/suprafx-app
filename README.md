# SupraFX — Cross-Chain FX Settlement Marketplace

SupraFX is a cross-chain FX settlement protocol connecting Ethereum (Sepolia testnet) and Supra Testnet. It enables AI agents and human traders to operate as both takers and makers in a trustless RFQ marketplace with committee-verified settlement.

## Architecture

- **Frontend**: Next.js 14 (App Router) + React + TypeScript
- **Backend**: Next.js API routes (serverless)
- **Database**: Supabase (Postgres + Realtime)
- **Oracle**: Supra DORA — real-time price feeds via REST API
- **Chains**: Sepolia (EVM) ↔ Supra Testnet
- **Settlement**: 3-of-5 multisig committee verification
- **Wallet**: StarKey (Supra) + MetaMask (EVM) dual-wallet

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Connect StarKey wallet or use Demo Mode.

## API — OpenClaw Skill

All actions use `POST /api/skill/suprafx` with a JSON body. API docs also available at `GET /api/skill/suprafx`.

### Actions

#### `get_pairs` — List available trading pairs

```json
{ "action": "get_pairs" }
```

Returns supported pairs, reference prices, and chain info.

#### `submit_rfq` — Create a new RFQ (taker)

```json
{
  "action": "submit_rfq",
  "agentAddress": "0x...",
  "pair": "ETH/SUPRA",
  "size": "0.001",
  "price": "2500"
}
```

Creates an open RFQ. The SupraFX bot auto-places a quote. Other makers can also quote.

#### `place_quote` — Quote on an open RFQ (maker)

```json
{
  "action": "place_quote",
  "rfqId": "uuid",
  "makerAddress": "0x...",
  "rate": "2450.50"
}
```

Places a competing quote. Cannot quote on your own RFQ. One pending quote per maker per RFQ.

#### `accept_quote` — Accept a quote (taker)

```json
{
  "action": "accept_quote",
  "quoteId": "uuid",
  "agentAddress": "0x..."
}
```

Accepts the quote and creates a trade. All other pending quotes are rejected.

#### `cancel_rfq` — Cancel your RFQ (taker)

```json
{
  "action": "cancel_rfq",
  "rfqId": "uuid",
  "agentAddress": "0x..."
}
```

#### `withdraw_quote` — Withdraw your quote (maker)

```json
{
  "action": "withdraw_quote",
  "quoteId": "uuid",
  "agentAddress": "0x..."
}
```

#### `check_trade` — Check trade status

```json
{
  "action": "check_trade",
  "tradeId": "uuid"
}
```

Returns full trade details including committee votes, TX hashes, settlement time, and explorer links.

#### `list_trades` — List your trades

```json
{
  "action": "list_trades",
  "agentAddress": "0x..."
}
```

### Oracle Endpoint

```
GET /api/oracle?pair=ETH/SUPRA
```

Real-time price data from Supra DORA oracle. Returns base/quote S-Values, 24h high/low/change, and conversion rate.

## Settlement Flow

1. **Taker** submits an RFQ → RFQ created, bot auto-quotes
2. **Makers** place competing quotes on the RFQ
3. **Taker** accepts the best quote → trade created (status: `open`)
4. **Taker** sends tokens on source chain → confirms TX hash
5. **Settlement Council** (3-of-5 multisig) verifies taker TX
6. **Maker** sends tokens on destination chain
7. **Council** verifies maker TX → trade settled
8. Reputation scores updated, attestation posted on-chain

## AI Agent Integration

Agents can operate as takers, makers, or both via the REST API.

**Taker flow**: `submit_rfq` → wait for quotes → `accept_quote` → send tokens → settled

**Maker flow**: poll for open RFQs → `place_quote` → if accepted, send tokens → settled

No API key required on testnet. Agent identity is the Supra wallet address.

## Supported Pairs

Cross-chain: ETH/SUPRA, SUPRA/ETH, fxAAVE/SUPRA, fxLINK/SUPRA, fxUSDC/SUPRA, fxUSDT/SUPRA

Same-chain (EVM): ETH/fxAAVE, ETH/fxLINK, ETH/fxUSDC, ETH/fxUSDT, fxAAVE/fxLINK

All `fx` prefixes are internal — the UI displays clean names (AAVE, LINK, USDC, USDT).

## Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (server-side)
- `SUPRA_ORACLE_API_KEY` — Supra DORA API key

## Deployment

Deployed on Vercel with GitHub integration. Cron job at `/api/cron/verify` runs every minute for committee verification.

## Testnet Limits

- ETH leg: 0.00001 ETH per settlement
- SUPRA leg: 0.001 SUPRA per settlement
