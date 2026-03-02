# SupraFX Skill for OpenClaw

## What This Skill Does
Enables cross-chain crypto settlement between Ethereum (Sepolia testnet) and Supra Testnet via the SupraFX protocol. Users describe trades in plain English and this skill handles the RFQ submission, matching, and settlement tracking.

## API Endpoint
`https://suprafx-app-main.vercel.app/api/skill/suprafx`

All requests are POST with JSON body. The `action` field determines the operation.

## Available Pairs
- **ETH/SUPRA** — Send ETH on Sepolia, receive SUPRA on Supra Testnet
- **SUPRA/ETH** — Send SUPRA on Supra Testnet, receive ETH on Sepolia

## Conversation Flow

When a user wants to make a trade, collect these parameters through natural conversation:

1. **Which pair?** — Are they swapping ETH for SUPRA or SUPRA for ETH?
2. **How much?** — How many tokens of the source asset? (e.g. "2 ETH" or "500 SUPRA")
3. **Max discount?** — What's the maximum price discount they'll accept vs the reference rate? Default 0.5%. Explain: "The reference rate is currently [X]. A 0.5% max discount means you'd accept a rate up to 0.5% worse than reference."
4. **Their Supra address** — The user's Supra wallet address (starts with 0x, 66 characters). This is their identity in the system.

## API Actions

### Get current pairs and prices
```json
POST /api/skill/suprafx
{ "action": "get_pairs" }
```

### Submit a trade request
```json
POST /api/skill/suprafx
{
  "action": "submit_rfq",
  "agentAddress": "0x...",
  "pair": "ETH/SUPRA",
  "size": "2",
  "maxDiscount": "0.5"
}
```

Returns a matched trade with ID. The maker bot auto-matches instantly.

### Check trade status
```json
POST /api/skill/suprafx
{ "action": "check_trade", "tradeId": "uuid-from-submit" }
```

### List all trades for a user
```json
POST /api/skill/suprafx
{ "action": "list_trades", "agentAddress": "0x..." }
```

## Settlement Flow

After submitting an RFQ:
1. Trade is auto-matched with a maker bot
2. Taker sends tokens on source chain, then confirms: POST /api/confirm-tx { tradeId, txHash, side: "taker" }
3. Committee verifies taker TX (3-of-5)
4. Maker bot auto-sends on destination chain
5. Committee verifies maker TX -> settled
6. Reputation updated, attestation on-chain

## Testnet Caps
- ETH legs: 0.00001 ETH per settlement
- SUPRA legs: 0.001 SUPRA per settlement

## Example Conversations

User: "I want to swap some ETH for SUPRA tokens"
OpenClaw: "Sure! How much ETH would you like to swap? The current reference rate is about 1 ETH = 2,200 SUPRA."
User: "Lets do 0.5 ETH"
OpenClaw: "Got it. Max discount on the rate? Default is 0.5%."
User: "0.5% is fine"
OpenClaw: "Whats your Supra wallet address?"
User: "0x02af04c..."
OpenClaw: [calls submit_rfq] "Done! Trade T-260302-004 matched. Send 0.00001 ETH on Sepolia to start settlement."
