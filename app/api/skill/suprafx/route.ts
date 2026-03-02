export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { getBotAddresses } from '@/lib/bot-wallets';

// Reference prices (would come from oracle in production)
const REF_PRICES: Record<string, number> = {
  'ETH/SUPRA': 2200,    // 1 ETH = 2200 SUPRA
  'SUPRA/ETH': 0.000454, // 1 SUPRA = 0.000454 ETH
};

const PAIRS: Record<string, { source: string; dest: string }> = {
  'ETH/SUPRA': { source: 'sepolia', dest: 'supra-testnet' },
  'SUPRA/ETH': { source: 'supra-testnet', dest: 'sepolia' },
};

// All bot settlements capped at 0.001 SUPRA (100000 octas)
const SETTLEMENT_CAP_OCTAS = 100000;
const SETTLEMENT_CAP_SUPRA = 0.001;
const SETTLEMENT_CAP_ETH = 0.00001;

const SPREAD_BPS = 10; // 0.1% spread

/*
 * POST /api/skill/suprafx
 * 
 * Actions:
 *   submit_rfq  — submit a new request for quote
 *   check_trade — check status of a trade
 *   list_trades — list user's trades
 *   get_pairs   — get available pairs and reference prices
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'get_pairs':
        return handleGetPairs();
      case 'submit_rfq':
        return handleSubmitRFQ(body);
      case 'check_trade':
        return handleCheckTrade(body);
      case 'list_trades':
        return handleListTrades(body);
      default:
        return NextResponse.json({
          error: 'Unknown action. Available: get_pairs, submit_rfq, check_trade, list_trades',
        }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function handleGetPairs() {
  return NextResponse.json({
    pairs: Object.entries(REF_PRICES).map(([pair, price]) => ({
      pair,
      referencePrice: price,
      sourceChain: PAIRS[pair].source,
      destChain: PAIRS[pair].dest,
      settlementCap: pair.startsWith('ETH') ? `${SETTLEMENT_CAP_ETH} ETH` : `${SETTLEMENT_CAP_SUPRA} SUPRA`,
    })),
    note: 'All testnet settlements are capped at 0.001 SUPRA / 0.00001 ETH regardless of notional size.',
  });
}

async function handleSubmitRFQ(body: any) {
  const { agentAddress, pair, size, maxDiscount } = body;

  if (!agentAddress) {
    return NextResponse.json({ error: 'agentAddress required — the Supra address of the requesting agent' }, { status: 400 });
  }
  if (!pair || !PAIRS[pair]) {
    return NextResponse.json({
      error: `pair required. Available: ${Object.keys(PAIRS).join(', ')}`,
    }, { status: 400 });
  }
  if (!size || parseFloat(size) <= 0) {
    return NextResponse.json({ error: 'size required — number of tokens to exchange' }, { status: 400 });
  }

  const discount = parseFloat(maxDiscount || '0.5') / 100; // convert percentage to decimal
  const refPrice = REF_PRICES[pair];
  const { source, dest } = PAIRS[pair];

  const db = getServiceClient();
  const botAddrs = getBotAddresses();

  // Register agent if not exists
  await db.from('agents').upsert({
    wallet_address: agentAddress,
    role: 'taker',
    domain: `openclaw-agent-${agentAddress.slice(0, 8)}`,
    chains: ['sepolia', 'supra-testnet'],
    rep_deposit_base: 5.0,
    rep_total: 5.0,
  }, { onConflict: 'wallet_address' });

  // Create RFQ
  const rfqCount = ((await db.from('rfqs').select('id', { count: 'exact' })).count || 0) + 1;
  const displayId = `RFQ-${String(rfqCount).padStart(3, '0')}`;

  const { data: rfq, error: rfqErr } = await db.from('rfqs').insert({
    display_id: displayId,
    taker_address: agentAddress,
    pair,
    size: parseFloat(size),
    source_chain: source,
    dest_chain: dest,
    max_slippage: discount,
    reference_price: refPrice,
    status: 'open',
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  }).select().single();

  if (rfqErr) return NextResponse.json({ error: rfqErr.message }, { status: 500 });

  // Auto-match with maker bot
  const makerAddress = 'auto-maker-bot';
  const rate = refPrice * (1 + SPREAD_BPS / 10000);

  await db.from('agents').upsert({
    wallet_address: makerAddress,
    role: 'maker',
    domain: 'suprafx-maker-bot',
    chains: ['sepolia', 'supra-testnet'],
    rep_deposit_base: 5.0,
    rep_total: 5.0,
  }, { onConflict: 'wallet_address' });

  // Create quote
  await db.from('quotes').insert({
    rfq_id: rfq.id,
    maker_address: makerAddress,
    bid_rate: rate,
    ask_rate: rate,
    expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
  });

  // Create trade
  const tradeCount = ((await db.from('trades').select('id', { count: 'exact' })).count || 0) + 1;
  const tradeDisplayId = `T-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(tradeCount).padStart(3, '0')}`;

  const { data: trade, error: tradeErr } = await db.from('trades').insert({
    display_id: tradeDisplayId,
    rfq_id: rfq.id,
    pair,
    size: parseFloat(size),
    rate,
    source_chain: source,
    dest_chain: dest,
    taker_address: agentAddress,
    maker_address: makerAddress,
    status: 'open',
  }).select().single();

  if (tradeErr) return NextResponse.json({ error: tradeErr.message }, { status: 500 });

  await db.from('rfqs').update({ status: 'matched' }).eq('id', rfq.id);

  return NextResponse.json({
    success: true,
    rfq: {
      id: rfq.id,
      displayId: displayId,
      pair,
      size: parseFloat(size),
      referencePrice: refPrice,
      maxDiscount: parseFloat(maxDiscount || '0.5'),
    },
    trade: {
      id: trade.id,
      displayId: tradeDisplayId,
      pair,
      size: parseFloat(size),
      rate,
      notional: parseFloat(size) * rate,
      sourceChain: source,
      destChain: dest,
      status: 'open',
      makerBot: makerAddress,
    },
    settlementCap: {
      note: 'Regardless of size, actual on-chain settlement is capped for testnet',
      ethLeg: `${SETTLEMENT_CAP_ETH} ETH`,
      supraLeg: `${SETTLEMENT_CAP_SUPRA} SUPRA`,
    },
    nextStep: `Trade matched. To settle, POST to /api/confirm-tx with { tradeId: "${trade.id}", txHash: "<your_tx_hash>", side: "taker" }. The maker bot will auto-send on the other chain once taker TX is verified.`,
  });
}

async function handleCheckTrade(body: any) {
  const { tradeId } = body;
  if (!tradeId) return NextResponse.json({ error: 'tradeId required' }, { status: 400 });

  const db = getServiceClient();
  const { data: trade } = await db.from('trades').select('*').eq('id', tradeId).single();
  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

  const { data: votes } = await db.from('committee_votes')
    .select('*').eq('trade_id', tradeId).order('created_at', { ascending: false });

  const { data: requests } = await db.from('committee_requests')
    .select('*').eq('trade_id', tradeId);

  return NextResponse.json({
    trade: {
      id: trade.id,
      displayId: trade.display_id,
      pair: trade.pair,
      size: trade.size,
      rate: trade.rate,
      status: trade.status,
      takerTxHash: trade.taker_tx_hash,
      makerTxHash: trade.maker_tx_hash,
      settleMs: trade.settle_ms,
      settledAt: trade.settled_at,
      sourceChain: trade.source_chain,
      destChain: trade.dest_chain,
    },
    committee: {
      verifications: (requests || []).map((r: any) => ({
        type: r.verification_type,
        status: r.status,
        approvals: r.approvals,
        attestationTx: r.attestation_tx,
      })),
      votes: (votes || []).length,
    },
    explorerLinks: {
      takerTx: trade.taker_tx_hash
        ? trade.source_chain === 'sepolia'
          ? `https://sepolia.etherscan.io/tx/${trade.taker_tx_hash}`
          : `https://testnet.suprascan.io/tx/${trade.taker_tx_hash}`
        : null,
      makerTx: trade.maker_tx_hash
        ? trade.dest_chain === 'supra-testnet'
          ? `https://testnet.suprascan.io/tx/${trade.maker_tx_hash.replace(/^0x/, '')}`
          : `https://sepolia.etherscan.io/tx/${trade.maker_tx_hash}`
        : null,
    },
  });
}

async function handleListTrades(body: any) {
  const { agentAddress } = body;
  if (!agentAddress) return NextResponse.json({ error: 'agentAddress required' }, { status: 400 });

  const db = getServiceClient();
  const { data: trades } = await db.from('trades')
    .select('*')
    .or(`taker_address.eq.${agentAddress},maker_address.eq.${agentAddress}`)
    .order('created_at', { ascending: false })
    .limit(20);

  return NextResponse.json({
    trades: (trades || []).map((t: any) => ({
      id: t.id,
      displayId: t.display_id,
      pair: t.pair,
      size: t.size,
      rate: t.rate,
      status: t.status,
      settleMs: t.settle_ms,
      side: t.taker_address === agentAddress ? 'taker' : 'maker',
    })),
  });
}

// GET for health check / docs
export async function GET() {
  return NextResponse.json({
    name: 'SupraFX OpenClaw Skill',
    version: '1.0',
    description: 'Cross-chain FX settlement between Ethereum (Sepolia) and Supra Testnet',
    actions: {
      get_pairs: {
        method: 'POST',
        body: { action: 'get_pairs' },
        description: 'Get available trading pairs and reference prices',
      },
      submit_rfq: {
        method: 'POST',
        body: {
          action: 'submit_rfq',
          agentAddress: 'your_supra_address',
          pair: 'ETH/SUPRA or SUPRA/ETH',
          size: 'number of tokens',
          maxDiscount: 'max discount percentage (e.g. 0.5 for 0.5%)',
        },
        description: 'Submit a request for quote — auto-matches with maker bot',
      },
      check_trade: {
        method: 'POST',
        body: { action: 'check_trade', tradeId: 'uuid' },
        description: 'Check status of a specific trade',
      },
      list_trades: {
        method: 'POST',
        body: { action: 'list_trades', agentAddress: 'your_supra_address' },
        description: 'List all trades for an agent',
      },
    },
    settlementFlow: [
      '1. Agent calls submit_rfq → gets matched trade',
      '2. Agent sends tokens on source chain → POST /api/confirm-tx with TX hash',
      '3. Committee verifies taker TX → maker bot auto-sends on dest chain',
      '4. Committee verifies maker TX → trade settled',
      '5. Reputation updated, attestation posted on-chain',
    ],
    testnetCaps: {
      ethLeg: '0.00001 ETH per settlement',
      supraLeg: '0.001 SUPRA per settlement',
    },
  });
}
