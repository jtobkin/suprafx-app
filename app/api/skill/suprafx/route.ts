export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { getBotAddresses } from '@/lib/bot-wallets';

// Normalize clean token names to internal fx-prefixed format
function normalizePair(pair: string): string {
  const map: Record<string, string> = {
    AAVE: 'fxAAVE', LINK: 'fxLINK', USDC: 'fxUSDC', USDT: 'fxUSDT',
    fxAAVE: 'fxAAVE', fxLINK: 'fxLINK', fxUSDC: 'fxUSDC', fxUSDT: 'fxUSDT',
    ETH: 'ETH', SUPRA: 'SUPRA',
  };
  const [base, quote] = pair.split('/');
  const nb = map[base] || base;
  const nq = map[quote] || quote;
  const normalized = nb + '/' + nq;
  // Also check reverse
  if (PAIRS[normalized]) return normalized;
  const reversed = nq + '/' + nb;
  if (PAIRS[reversed]) return reversed;
  return normalized;
}

// Reference prices (would come from oracle in production)
const REF_PRICES: Record<string, number> = {
  // Cross-chain: ETH <-> Supra
  'ETH/SUPRA': 2200,
  'SUPRA/ETH': 0.000454,
  // Cross-chain: ERC-20 <-> Supra
  'fxAAVE/SUPRA': 168,
  'fxLINK/SUPRA': 8.2,
  'fxUSDC/SUPRA': 0.56,
  'fxUSDT/SUPRA': 0.56,
  // EVM same-chain swaps
  'fxAAVE/fxUSDT': 95.50,
  'fxAAVE/fxUSDC': 95.50,
  'fxAAVE/fxLINK': 6.45,
  'fxUSDT/fxUSDC': 1.0,
  'fxLINK/fxUSDC': 14.80,
  'fxLINK/fxUSDT': 14.80,
  // ETH <-> ERC-20 (same chain)
  'ETH/fxAAVE': 26.18,
  'ETH/fxLINK': 168.92,
  'ETH/fxUSDC': 2500.00,
  'ETH/fxUSDT': 2500.00,
};

const PAIRS: Record<string, { source: string; dest: string }> = {
  // Cross-chain
  'ETH/SUPRA': { source: 'sepolia', dest: 'supra-testnet' },
  'SUPRA/ETH': { source: 'supra-testnet', dest: 'sepolia' },
  'fxAAVE/SUPRA': { source: 'sepolia', dest: 'supra-testnet' },
  'fxLINK/SUPRA': { source: 'sepolia', dest: 'supra-testnet' },
  'fxUSDC/SUPRA': { source: 'sepolia', dest: 'supra-testnet' },
  'fxUSDT/SUPRA': { source: 'sepolia', dest: 'supra-testnet' },
  // EVM same-chain
  'fxAAVE/fxUSDT': { source: 'sepolia', dest: 'sepolia' },
  'fxAAVE/fxUSDC': { source: 'sepolia', dest: 'sepolia' },
  'fxAAVE/fxLINK': { source: 'sepolia', dest: 'sepolia' },
  'fxUSDT/fxUSDC': { source: 'sepolia', dest: 'sepolia' },
  'fxLINK/fxUSDC': { source: 'sepolia', dest: 'sepolia' },
  'fxLINK/fxUSDT': { source: 'sepolia', dest: 'sepolia' },
  // ETH <-> ERC-20
  'ETH/fxAAVE': { source: 'sepolia', dest: 'sepolia' },
  'ETH/fxLINK': { source: 'sepolia', dest: 'sepolia' },
  'ETH/fxUSDC': { source: 'sepolia', dest: 'sepolia' },
  'ETH/fxUSDT': { source: 'sepolia', dest: 'sepolia' },
};
// All bot settlements capped at 0.001 SUPRA (100000 octas)
const SETTLEMENT_CAP_OCTAS = 100000;
const SETTLEMENT_CAP_SUPRA = 0.001;
const SETTLEMENT_CAP_ETH = 0.00001;

const SPREAD_BPS = 30; // 0.3% — bot quotes 0.3% below reference

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
      case 'accept_quote':
        return handleAcceptQuote(body);
      case 'cancel_rfq':
        return handleCancelRFQ(body);
      case 'withdraw_quote':
        return handleWithdrawQuote(body);
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
    pairs: Object.entries(REF_PRICES).map(([pair, price]) => {
      const base = pair.split('/')[0];
      let cap = `${SETTLEMENT_CAP_ETH} ETH`;
      if (base === 'SUPRA') cap = `${SETTLEMENT_CAP_SUPRA} SUPRA`;
      else if (base.startsWith('fx')) cap = `0.01 ${base}`;
      return {
        pair,
        referencePrice: price,
        sourceChain: PAIRS[pair].source,
        destChain: PAIRS[pair].dest,
        settlementCap: cap,
      };
    }),
    note: 'All testnet settlements are capped at small amounts regardless of notional size.',
  });
}

async function handleSubmitRFQ(body: any) {
  const { agentAddress, pair, size, quotedPrice } = body;

  if (!agentAddress) {
    return NextResponse.json({ error: 'agentAddress required' }, { status: 400 });
  }
  const normalizedPair = normalizePair(pair);
  if (!normalizedPair || !PAIRS[normalizedPair]) {
    return NextResponse.json({
      error: `Unsupported pair: ${pair}. Available: ${Object.keys(PAIRS).join(', ')}`,
    }, { status: 400 });
  }
  if (!size || parseFloat(size) <= 0) {
    return NextResponse.json({ error: 'size required' }, { status: 400 });
  }

  const refPrice = REF_PRICES[normalizedPair];
  const { source, dest } = PAIRS[normalizedPair];
  const userPrice = quotedPrice ? parseFloat(quotedPrice) : refPrice;

  const db = getServiceClient();

  // Register taker if not exists
  await db.from('agents').upsert({
    wallet_address: agentAddress,
    role: 'taker',
    domain: `openclaw-agent-${agentAddress.slice(0, 8)}`,
    chains: ['sepolia', 'supra-testnet'],
    rep_deposit_base: 5.0,
    rep_total: 5.0,
  }, { onConflict: 'wallet_address' });

  // Create RFQ (stays open until taker accepts a quote)
  const rfqCount = ((await db.from('rfqs').select('id', { count: 'exact' })).count || 0) + 1;
  const displayId = `RFQ-${String(rfqCount).padStart(3, '0')}`;

  const { data: rfq, error: rfqErr } = await db.from('rfqs').insert({
    display_id: displayId,
    taker_address: agentAddress,
    pair: normalizedPair,
    size: parseFloat(size),
    source_chain: source,
    dest_chain: dest,
    max_slippage: 0,
    reference_price: userPrice,
    status: 'open',
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  }).select().single();

  if (rfqErr) return NextResponse.json({ error: rfqErr.message }, { status: 500 });

  // Bot auto-quotes at 0.3% below reference
  const makerAddress = 'auto-maker-bot';
  const botRate = refPrice * (1 - SPREAD_BPS / 10000);

  await db.from('agents').upsert({
    wallet_address: makerAddress,
    role: 'maker',
    domain: 'suprafx-maker-bot',
    chains: ['sepolia', 'supra-testnet'],
    rep_deposit_base: 5.0,
    rep_total: 5.0,
  }, { onConflict: 'wallet_address' });

  await db.from('quotes').insert({
    rfq_id: rfq.id,
    maker_address: makerAddress,
    rate: botRate,
    status: 'pending',
  });

  return NextResponse.json({
    success: true,
    rfq: {
      id: rfq.id,
      displayId: displayId,
      pair: normalizedPair,
      size: parseFloat(size),
      takerPrice: userPrice,
      referencePrice: refPrice,
      status: 'open',
    },
    nextStep: 'RFQ created. Quotes will appear from makers. Accept a quote to create a trade.',
  });
}


async function handleAcceptQuote(body: any) {
  const { quoteId, agentAddress } = body;
  if (!quoteId) return NextResponse.json({ error: 'quoteId required' }, { status: 400 });
  if (!agentAddress) return NextResponse.json({ error: 'agentAddress required' }, { status: 400 });

  const db = getServiceClient();

  // Get quote
  const { data: quote, error: qErr } = await db.from('quotes').select('*').eq('id', quoteId).single();
  if (qErr || !quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  if (quote.status !== 'pending') return NextResponse.json({ error: 'Quote is no longer pending' }, { status: 400 });

  // Get RFQ
  const { data: rfq, error: rErr } = await db.from('rfqs').select('*').eq('id', quote.rfq_id).single();
  if (rErr || !rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });
  if (rfq.taker_address !== agentAddress) return NextResponse.json({ error: 'Only the RFQ taker can accept quotes' }, { status: 403 });
  if (rfq.status !== 'open') return NextResponse.json({ error: 'RFQ is no longer open' }, { status: 400 });

  // Accept quote, reject others
  await db.from('quotes').update({ status: 'accepted' }).eq('id', quoteId);
  await db.from('quotes').update({ status: 'rejected' }).eq('rfq_id', rfq.id).neq('id', quoteId).eq('status', 'pending');
  await db.from('rfqs').update({ status: 'matched' }).eq('id', rfq.id);

  // Create trade from accepted quote
  const tradeCount = ((await db.from('trades').select('id', { count: 'exact' })).count || 0) + 1;
  const tradeDisplayId = `T-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(tradeCount).padStart(3, '0')}`;

  const { data: trade, error: tradeErr } = await db.from('trades').insert({
    display_id: tradeDisplayId,
    rfq_id: rfq.id,
    pair: rfq.pair,
    size: rfq.size,
    rate: quote.rate,
    source_chain: rfq.source_chain,
    dest_chain: rfq.dest_chain,
    taker_address: rfq.taker_address,
    maker_address: quote.maker_address,
    status: 'open',
  }).select().single();

  if (tradeErr) return NextResponse.json({ error: tradeErr.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    trade: {
      id: trade.id,
      displayId: tradeDisplayId,
      pair: rfq.pair,
      size: rfq.size,
      rate: quote.rate,
      notional: rfq.size * quote.rate,
      sourceChain: rfq.source_chain,
      destChain: rfq.dest_chain,
      status: 'open',
      maker: quote.maker_address,
    },
    nextStep: `Trade created. To settle, POST to /api/confirm-tx with { tradeId: "${trade.id}", txHash: "<your_tx_hash>", side: "taker" }.`,
  });
}

async function handleCancelRFQ(body: any) {
  const { rfqId, agentAddress } = body;
  if (!rfqId) return NextResponse.json({ error: 'rfqId required' }, { status: 400 });
  if (!agentAddress) return NextResponse.json({ error: 'agentAddress required' }, { status: 400 });

  const db = getServiceClient();

  const { data: rfq, error: rErr } = await db.from('rfqs').select('*').eq('id', rfqId).single();
  if (rErr || !rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });
  if (rfq.taker_address !== agentAddress) return NextResponse.json({ error: 'Only the RFQ taker can cancel' }, { status: 403 });
  if (rfq.status !== 'open') return NextResponse.json({ error: 'RFQ is no longer open' }, { status: 400 });

  // Cancel RFQ and reject all pending quotes
  await db.from('rfqs').update({ status: 'cancelled' }).eq('id', rfqId);
  await db.from('quotes').update({ status: 'rejected' }).eq('rfq_id', rfqId).eq('status', 'pending');

  return NextResponse.json({ success: true, message: 'RFQ cancelled, all pending quotes rejected.' });
}

async function handleWithdrawQuote(body: any) {
  const { quoteId, agentAddress } = body;
  if (!quoteId) return NextResponse.json({ error: 'quoteId required' }, { status: 400 });
  if (!agentAddress) return NextResponse.json({ error: 'agentAddress required' }, { status: 400 });

  const db = getServiceClient();

  const { data: quote, error: qErr } = await db.from('quotes').select('*').eq('id', quoteId).single();
  if (qErr || !quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  if (quote.maker_address !== agentAddress) return NextResponse.json({ error: 'Only the quote maker can withdraw' }, { status: 403 });
  if (quote.status !== 'pending') return NextResponse.json({ error: 'Quote is no longer pending' }, { status: 400 });

  await db.from('quotes').update({ status: 'withdrawn' }).eq('id', quoteId);

  return NextResponse.json({ success: true, message: 'Quote withdrawn.' });
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
