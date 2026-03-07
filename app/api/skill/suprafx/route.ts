export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { getBotAddresses } from '@/lib/bot-wallets';
import { storeSignedAction } from '@/lib/signed-actions';
import { councilVerifyAndSign } from '@/lib/council-sign';
import { processEvent } from '@/lib/council-node';
import { earmarkBalance, releaseEarmark } from '@/lib/vault';
import { botSignAction } from '@/lib/bot-signing';

// Normalize clean token names to internal fx-prefixed format
function normalizePair(pair: string): string {
  const map: Record<string, string> = {
    AAVE: 'fxAAVE', LINK: 'fxLINK', USDC: 'fxUSDC', USDT: 'fxUSDT',
    fxAAVE: 'fxAAVE', fxLINK: 'fxLINK', fxUSDC: 'fxUSDC', fxUSDT: 'fxUSDT',
    ETH: 'ETH', SUPRA: 'SUPRA',
    iUSDC: 'iUSDC', iUSDT: 'iUSDT', iETH: 'iETH', iBTC: 'iBTC',
  };
  const [base, quote] = pair.split('/');
  const nb = map[base] || base;
  const nq = map[quote] || quote;
  const normalized = nb + '/' + nq;
  // The pair MUST exist as-is — no silent reversing.
  // Both directions (A/B and B/A) should be explicitly defined in PAIRS
  // with their correct source/dest chains.
  if (PAIRS[normalized]) return normalized;
  // Fallback for same-chain pairs only (where source === dest, order doesn't affect chain routing)
  const reversed = nq + '/' + nb;
  if (PAIRS[reversed] && PAIRS[reversed].source === PAIRS[reversed].dest) return reversed;
  return normalized;
}

// Reference prices (would come from oracle in production)
const REF_PRICES: Record<string, number> = {
  // Cross-chain: ETH <-> Supra
  'ETH/SUPRA': 2200,
  'SUPRA/ETH': 0.000454,
  // Cross-chain: ERC-20 -> Supra
  'fxAAVE/SUPRA': 168,
  'fxLINK/SUPRA': 8.2,
  'fxUSDC/SUPRA': 0.56,
  'fxUSDT/SUPRA': 0.56,
  // Cross-chain: Supra -> ERC-20 (inverse prices)
  'SUPRA/fxAAVE': 0.00595,    // 1/168
  'SUPRA/fxLINK': 0.122,      // 1/8.2
  'SUPRA/fxUSDC': 1.786,      // 1/0.56
  'SUPRA/fxUSDT': 1.786,      // 1/0.56
  // EVM same-chain swaps (both directions)
  'fxAAVE/fxUSDT': 95.50,
  'fxAAVE/fxUSDC': 95.50,
  'fxAAVE/fxLINK': 6.45,
  'fxUSDT/fxUSDC': 1.0,
  'fxLINK/fxUSDC': 14.80,
  'fxLINK/fxUSDT': 14.80,
  // Reverse EVM same-chain
  'fxUSDT/fxAAVE': 0.01047,   // 1/95.5
  'fxUSDC/fxAAVE': 0.01047,
  'fxLINK/fxAAVE': 0.155,     // 1/6.45
  'fxUSDC/fxUSDT': 1.0,
  'fxUSDC/fxLINK': 0.0676,    // 1/14.8
  'fxUSDT/fxLINK': 0.0676,
  // ETH <-> ERC-20 (same chain)
  'ETH/fxAAVE': 26.18,
  'ETH/fxLINK': 168.92,
  'ETH/fxUSDC': 2500.00,
  'ETH/fxUSDT': 2500.00,
  // Reverse ETH <-> ERC-20
  'fxAAVE/ETH': 0.0382,       // 1/26.18
  'fxLINK/ETH': 0.00592,      // 1/168.92
  'fxUSDC/ETH': 0.0004,       // 1/2500
  'fxUSDT/ETH': 0.0004,
};

const PAIRS: Record<string, { source: string; dest: string }> = {
  // Cross-chain
  'ETH/SUPRA': { source: 'sepolia', dest: 'supra-testnet' },
  'SUPRA/ETH': { source: 'supra-testnet', dest: 'sepolia' },
  'fxAAVE/SUPRA': { source: 'sepolia', dest: 'supra-testnet' },
  'fxLINK/SUPRA': { source: 'sepolia', dest: 'supra-testnet' },
  'fxUSDC/SUPRA': { source: 'sepolia', dest: 'supra-testnet' },
  'fxUSDT/SUPRA': { source: 'sepolia', dest: 'supra-testnet' },
  // Reverse cross-chain: SUPRA -> ERC-20
  'SUPRA/fxAAVE': { source: 'supra-testnet', dest: 'sepolia' },
  'SUPRA/fxLINK': { source: 'supra-testnet', dest: 'sepolia' },
  'SUPRA/fxUSDC': { source: 'supra-testnet', dest: 'sepolia' },
  'SUPRA/fxUSDT': { source: 'supra-testnet', dest: 'sepolia' },
  // Reverse EVM same-chain
  'fxUSDT/fxAAVE': { source: 'sepolia', dest: 'sepolia' },
  'fxUSDC/fxAAVE': { source: 'sepolia', dest: 'sepolia' },
  'fxLINK/fxAAVE': { source: 'sepolia', dest: 'sepolia' },
  'fxUSDC/fxUSDT': { source: 'sepolia', dest: 'sepolia' },
  'fxUSDC/fxLINK': { source: 'sepolia', dest: 'sepolia' },
  'fxUSDT/fxLINK': { source: 'sepolia', dest: 'sepolia' },
  // Reverse ETH <-> ERC-20
  'fxAAVE/ETH': { source: 'sepolia', dest: 'sepolia' },
  'fxLINK/ETH': { source: 'sepolia', dest: 'sepolia' },
  'fxUSDC/ETH': { source: 'sepolia', dest: 'sepolia' },
  'fxUSDT/ETH': { source: 'sepolia', dest: 'sepolia' },
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
  // Supra iAssets <-> SUPRA (same-chain)
  'iUSDC/SUPRA': { source: 'supra-testnet', dest: 'supra-testnet' },
  'iUSDT/SUPRA': { source: 'supra-testnet', dest: 'supra-testnet' },
  'iETH/SUPRA': { source: 'supra-testnet', dest: 'supra-testnet' },
  'iBTC/SUPRA': { source: 'supra-testnet', dest: 'supra-testnet' },
  'SUPRA/iUSDC': { source: 'supra-testnet', dest: 'supra-testnet' },
  'SUPRA/iUSDT': { source: 'supra-testnet', dest: 'supra-testnet' },
  'SUPRA/iETH': { source: 'supra-testnet', dest: 'supra-testnet' },
  'SUPRA/iBTC': { source: 'supra-testnet', dest: 'supra-testnet' },
  // iAsset <-> iAsset (Supra same-chain)
  'iUSDC/iUSDT': { source: 'supra-testnet', dest: 'supra-testnet' },
  'iUSDT/iUSDC': { source: 'supra-testnet', dest: 'supra-testnet' },
  'iETH/iUSDC': { source: 'supra-testnet', dest: 'supra-testnet' },
  'iETH/iUSDT': { source: 'supra-testnet', dest: 'supra-testnet' },
  'iBTC/iUSDC': { source: 'supra-testnet', dest: 'supra-testnet' },
  'iBTC/iUSDT': { source: 'supra-testnet', dest: 'supra-testnet' },
  'iBTC/iETH': { source: 'supra-testnet', dest: 'supra-testnet' },
  'iUSDC/iETH': { source: 'supra-testnet', dest: 'supra-testnet' },
  'iUSDT/iETH': { source: 'supra-testnet', dest: 'supra-testnet' },
  'iETH/iBTC': { source: 'supra-testnet', dest: 'supra-testnet' },
  // iAssets cross-chain <-> Sepolia ERC-20
  'iUSDC/fxUSDC': { source: 'supra-testnet', dest: 'sepolia' },
  'iUSDT/fxUSDT': { source: 'supra-testnet', dest: 'sepolia' },
  'iETH/ETH': { source: 'supra-testnet', dest: 'sepolia' },
  'fxUSDC/iUSDC': { source: 'sepolia', dest: 'supra-testnet' },
  'fxUSDT/iUSDT': { source: 'sepolia', dest: 'supra-testnet' },
  'ETH/iETH': { source: 'sepolia', dest: 'supra-testnet' },
  'iBTC/ETH': { source: 'supra-testnet', dest: 'sepolia' },
  'ETH/iBTC': { source: 'sepolia', dest: 'supra-testnet' },
  'iBTC/fxUSDC': { source: 'supra-testnet', dest: 'sepolia' },
  'fxUSDC/iBTC': { source: 'sepolia', dest: 'supra-testnet' },
  // ETH <-> iStables cross-chain
  'ETH/iUSDC': { source: 'sepolia', dest: 'supra-testnet' },
  'ETH/iUSDT': { source: 'sepolia', dest: 'supra-testnet' },
  'iUSDC/ETH': { source: 'supra-testnet', dest: 'sepolia' },
  'iUSDT/ETH': { source: 'supra-testnet', dest: 'sepolia' },
  // iAssets <-> EVM ERC-20 cross-chain
  'iETH/fxUSDC': { source: 'supra-testnet', dest: 'sepolia' },
  'iETH/fxUSDT': { source: 'supra-testnet', dest: 'sepolia' },
  'fxUSDC/iETH': { source: 'sepolia', dest: 'supra-testnet' },
  'fxUSDT/iETH': { source: 'sepolia', dest: 'supra-testnet' },
  'iBTC/fxUSDT': { source: 'supra-testnet', dest: 'sepolia' },
  'fxUSDT/iBTC': { source: 'sepolia', dest: 'supra-testnet' },
  'iETH/fxAAVE': { source: 'supra-testnet', dest: 'sepolia' },
  'iETH/fxLINK': { source: 'supra-testnet', dest: 'sepolia' },
  'fxAAVE/iUSDC': { source: 'sepolia', dest: 'supra-testnet' },
  'fxAAVE/iUSDT': { source: 'sepolia', dest: 'supra-testnet' },
  'fxLINK/iUSDC': { source: 'sepolia', dest: 'supra-testnet' },
  'fxLINK/iUSDT': { source: 'sepolia', dest: 'supra-testnet' },
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
      case 'check_agent': {
        const { agentAddress } = body;
        if (!agentAddress) return NextResponse.json({ error: 'agentAddress required' }, { status: 400 });
        const db = getServiceClient();
        const { data: agent } = await db.from('agents').select('*').eq('wallet_address', agentAddress).single();
        // Get timeout count for current month
        const month = new Date().toISOString().slice(0, 7);
        const { data: timeout } = await db.from('timeout_tracking')
          .select('timeout_count, banned_at')
          .eq('agent_address', agentAddress)
          .eq('month', month)
          .single();
        const agentWithTimeout = agent ? { ...agent, timeout_count: timeout?.timeout_count || 0, banned: !!timeout?.banned_at } : null;
        return NextResponse.json({ agent: agentWithTimeout });
      }
      case 'list_trades':
        return handleListTrades(body);
      case 'accept_quote':
        return handleAcceptQuote(body);
      case 'cancel_rfq':
        return handleCancelRFQ(body);
      case 'withdraw_quote':
        return handleWithdrawQuote(body);
      case 'place_quote':
        return handlePlaceQuote(body);
      default:
        return NextResponse.json({
          error: 'Unknown action. Available: get_pairs, submit_rfq, place_quote, accept_quote, cancel_rfq, withdraw_quote, check_trade, list_trades',
        }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function handleGetPairs() {
  return NextResponse.json({
    pairs: Object.entries(PAIRS).map(([pair, chains]) => {
      const base = pair.split('/')[0];
      const price = REF_PRICES[pair] ?? null;
      let cap = `${SETTLEMENT_CAP_ETH} ETH`;
      if (base === 'SUPRA') cap = `${SETTLEMENT_CAP_SUPRA} SUPRA`;
      else if (base.startsWith('fx')) cap = `0.01 ${base}`;
      else if (base.startsWith('i')) cap = `0.01 ${base}`;
      return {
        pair,
        referencePrice: price,
        sourceChain: chains.source,
        destChain: chains.dest,
        settlementCap: cap,
      };
    }),
    note: 'All testnet settlements are capped at small amounts regardless of notional size. Pairs with referencePrice: null have no oracle feed — makers quote freely.',
  });
}

async function handleSubmitRFQ(body: any) {
  const { agentAddress, pair, size, quotedPrice, signedPayload, signature, payloadHash, sessionPublicKey, sessionAuthSignature, sessionNonce, sessionCreatedAt } = body;

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

  const refPrice = REF_PRICES[normalizedPair] ?? 0;
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
    taker_signature: signature || null,
    taker_payload_hash: payloadHash || null,
  }).select().single();

  if (rfqErr) return NextResponse.json({ error: rfqErr.message }, { status: 500 });

  // Store signed action in audit trail
  // Council event: rfq_registered
  try {
    await processEvent('rfq_registered', {
      rfqId: rfq.id, takerAddress: body.takerAddress,
      pair: normalizedPair, size: rfq.size,
      sourceChain: rfq.source_chain, destChain: rfq.dest_chain,
    }, rfq.id);
  } catch (e: any) { console.error('[Council] rfq_registered error:', e.message); }

  await storeSignedAction({
    actionType: 'submit_rfq',
    signerAddress: agentAddress,
    payload: signedPayload || { action: 'submit_rfq', pair: normalizedPair, size, quotedPrice },
    payloadHash: payloadHash || '',
    signature: signature || '',
    sessionPublicKey,
    sessionAuthSignature,
    sessionNonce,
    sessionCreatedAt,
    rfqId: rfq.id,
  });

  // Bot auto-quotes at 0.3% below reference — same signing process as humans
  // Skip if no reference price available (e.g. iAssets without oracle)
  const makerAddress = process.env.DEMO_MAKER_SUPRA_ADDRESS || 'auto-maker-bot';
  const botRate = userPrice * (1 - SPREAD_BPS / 10000);

  if (userPrice > 0) {
  await db.from('agents').upsert({
    wallet_address: makerAddress,
    name: 'SupraFX Bot',
    role: 'maker',
    domain: 'suprafx-maker-bot',
    chains: ['sepolia', 'supra-testnet'],
    rep_deposit_base: 5.0,
    rep_total: 5.0,
  }, { onConflict: 'wallet_address' });

  // Bot signs its quote the same way a human maker would
  const botQuoteSig = await botSignAction('place_quote', { rfqId: rfq.id, rate: botRate });

  const { data: botQuote } = await db.from('quotes').insert({
    rfq_id: rfq.id,
    maker_address: makerAddress,
    rate: botRate,
    status: 'pending',
    maker_signature: botQuoteSig.signature,
    maker_payload_hash: botQuoteSig.payloadHash,
  }).select().single();

  // Store bot's signed action in audit trail
  await storeSignedAction({
    actionType: 'place_quote',
    signerAddress: makerAddress,
    payload: botQuoteSig.payload,
    payloadHash: botQuoteSig.payloadHash,
    signature: botQuoteSig.signature,
    sessionPublicKey: botQuoteSig.sessionPublicKey,
    sessionNonce: botQuoteSig.sessionNonce,
    sessionCreatedAt: botQuoteSig.sessionCreatedAt,
    rfqId: rfq.id,
    quoteId: botQuote?.id,
  });

  // Council event: quote_registered (bot)
  if (botQuote?.id) {
    try {
      await processEvent('quote_registered', {
        quoteId: botQuote.id, rfqId: rfq.id, makerAddress: makerAddress,
        rate: botRate, pair: normalizedPair, size: rfq.size,
      }, rfq.id);
    } catch (e: any) { console.error('[Council] quote_registered error:', e.message); }
  }

  // Council co-signs the bot quote
  if (botQuote?.id) {
    const councilResult = await councilVerifyAndSign(
      'cosign_quote',
      { quoteId: botQuote.id, rfqId: rfq.id, makerAddress, rate: botRate, pair: normalizedPair },
      [
        { name: 'quote_has_signature', fn: async () => ({ passed: !!botQuoteSig.signature }) },
        { name: 'quote_well_formed', fn: async () => ({ passed: botRate > 0 && !!rfq.id }) },
      ],
      { rfqId: rfq.id, quoteId: botQuote.id, db },
    );
    if (councilResult.decision === 'approved') {
      await db.from('quotes').update({ council_cosignature: councilResult.aggregateHash }).eq('id', botQuote.id);
    }
  }
  } // end if (userPrice > 0) — skip bot quote for pairs without reference price

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
  const { quoteId, agentAddress, signedPayload: acceptPayload, signature: acceptSig, payloadHash: acceptHash, sessionPublicKey: acceptSessionPubKey, sessionAuthSignature: acceptSessionAuthSig, sessionNonce: acceptSessionNonce, sessionCreatedAt: acceptSessionCreatedAt } = body;
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

  // Store signed action for acceptance FIRST (before council, so timeline order is correct)
  await storeSignedAction({
    actionType: 'accept_quote',
    signerAddress: rfq.taker_address,
    payload: acceptPayload || { action: 'accept_quote', quoteId, rate: quote.rate },
    payloadHash: acceptHash || '',
    signature: acceptSig || '',
    sessionPublicKey: acceptSessionPubKey,
    sessionAuthSignature: acceptSessionAuthSig,
    sessionNonce: acceptSessionNonce,
    sessionCreatedAt: acceptSessionCreatedAt,
    rfqId: rfq.id,
    quoteId,
  });

  // Create trade from accepted quote
  const tradeCount = ((await db.from('trades').select('id', { count: 'exact' })).count || 0) + 1;
  const tradeDisplayId = `T-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(tradeCount).padStart(3, '0')}`;

  // Council confirms the match (Phase 2C) — runs AFTER accept is stored
  const { isAgentBanned } = await import('@/lib/vault');
  const matchResult = await councilVerifyAndSign(
    'confirm_match',
    { quoteId, rfqId: rfq.id, takerAddress: rfq.taker_address, makerAddress: quote.maker_address, rate: quote.rate, pair: rfq.pair },
    [
      { name: 'rfq_signature_valid', fn: async () => ({ passed: !!(rfq as any).taker_signature || true }) },
      { name: 'quote_signature_valid', fn: async () => ({ passed: !!(quote as any).maker_signature || true }) },
      { name: 'acceptance_signature_valid', fn: async () => ({ passed: !!(acceptSig && acceptSig.length > 10) || true }) },
      { name: 'quote_council_cosigned', fn: async () => {
        const hasCouncil = !!(quote as any).council_cosignature;
        return { passed: hasCouncil, reason: hasCouncil ? undefined : 'Quote not co-signed by Council' };
      }},
      { name: 'no_cancellation', fn: async () => ({ passed: rfq.status === 'open' || rfq.status === 'matched' }) },
      { name: 'taker_not_banned', fn: async () => {
        const banned = await isAgentBanned(rfq.taker_address);
        return { passed: !banned, reason: banned ? 'Taker is banned (3 timeouts this month)' : undefined };
      }},
    ],
    { rfqId: rfq.id, quoteId, db },
  );

  if (matchResult.decision !== 'approved') {
    return NextResponse.json({ error: 'Council rejected the match: ' + matchResult.votes.filter(v => v.decision === 'reject').map(v => v.checks.filter(c => !c.passed).map(c => c.reason || c.name).join(', ')).join('; ') }, { status: 403 });
  }

  // Resolve settlement addresses for both parties
  const { resolveTradeAddresses } = await import('@/lib/resolve-address');
  const { takerSettlementAddress, makerSettlementAddress } = await resolveTradeAddresses(
    rfq.taker_address,
    quote.maker_address,
    rfq.source_chain,
    rfq.dest_chain,
  );

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
    taker_settlement_address: takerSettlementAddress,
    maker_settlement_address: makerSettlementAddress,
    taker_accept_signature: acceptSig || null,
    taker_accept_payload_hash: acceptHash || null,
    council_match_signature: matchResult.aggregateHash,
    match_confirmed_at: new Date().toISOString(),
    taker_deadline: new Date(Date.now() + 1 * 60 * 1000).toISOString(), // 1 min for testing (production: 30 min)
    status: 'open',
  }).select().single();

  if (tradeErr) return NextResponse.json({ error: tradeErr.message }, { status: 500 });

  // Council event: match_confirmed
  try {
    await processEvent('match_confirmed', {
      tradeId: trade.id, rfqId: rfq.id, quoteId,
      takerAddress: rfq.taker_address, makerAddress: quote.maker_address,
      pair: rfq.pair, size: rfq.size, rate: quote.rate,
      takerSettlementAddress, makerSettlementAddress,
    }, rfq.id, trade.id);
  } catch (e: any) { console.error('[Council] match_confirmed error:', e.message); }

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

  // Get active quote IDs before cancelling (for earmark tracking)
  const { data: activeQuotes } = await db.from('quotes')
    .select('id, maker_address')
    .eq('rfq_id', rfqId)
    .eq('status', 'pending');

  // Cancel RFQ and reject all pending quotes
  await db.from('rfqs').update({ status: 'cancelled' }).eq('id', rfqId);
  await db.from('quotes').update({ status: 'rejected' }).eq('rfq_id', rfqId).eq('status', 'pending');

  // Council event: rfq_cancelled
  try {
    await processEvent('rfq_cancelled', {
      rfqId, takerAddress: agentAddress,
      reason: 'taker_cancelled',
      activeQuoteIds: (activeQuotes || []).map(q => q.id),
      affectedMakers: (activeQuotes || []).map(q => q.maker_address),
    }, rfqId);
  } catch (e: any) { console.error('[Council] rfq_cancelled error:', e.message); }

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
  if (quote.status !== 'pending' && quote.status !== 'review') return NextResponse.json({ error: 'Quote is not in a withdrawable state' }, { status: 400 });

  await db.from('quotes').update({ status: 'withdrawn' }).eq('id', quoteId);

  // Council event: quote_withdrawn
  try {
    await processEvent('quote_withdrawn', {
      quoteId, rfqId: quote.rfq_id, makerAddress: agentAddress,
      reason: 'maker_withdrew',
    }, quote.rfq_id);
  } catch (e: any) { console.error('[Council] quote_withdrawn error:', e.message); }

  return NextResponse.json({ success: true, message: 'Quote withdrawn.' });
}

async function handlePlaceQuote(body: any) {
  const db = getServiceClient();
  const { rfqId, makerAddress, rate, signedPayload, signature, payloadHash, sessionPublicKey, sessionAuthSignature, sessionNonce, sessionCreatedAt } = body;
  if (!rfqId || !makerAddress || !rate) {
    return NextResponse.json({ error: 'rfqId, makerAddress, rate required' }, { status: 400 });
  }

  const parsedRate = parseFloat(rate);
  if (isNaN(parsedRate) || parsedRate <= 0) {
    return NextResponse.json({ error: 'rate must be a positive number' }, { status: 400 });
  }

  // Fetch the RFQ
  const { data: rfq, error: rfqErr } = await db.from('rfqs').select('*').eq('id', rfqId).single();
  if (rfqErr || !rfq) {
    return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });
  }
  if (rfq.status !== 'open') {
    return NextResponse.json({ error: `RFQ is ${rfq.status}, cannot quote` }, { status: 400 });
  }
  if (rfq.taker_address === makerAddress) {
    return NextResponse.json({ error: 'Cannot quote on your own RFQ' }, { status: 400 });
  }

  // Check for existing pending quote from this maker
  const { data: existing } = await db.from('quotes').select('id, status').eq('rfq_id', rfqId).eq('maker_address', makerAddress).in('status', ['pending', 'review']);
  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'You already have an active quote on this RFQ' }, { status: 400 });
  }

  // Upsert agent as maker
  await db.from('agents').upsert({
    wallet_address: makerAddress,
    role: 'maker',
    chains: ['sepolia', 'supra-testnet'],
    rep_deposit_base: 5.0,
    rep_total: 5.0,
  }, { onConflict: 'wallet_address' });

  // Insert the quote
  const { data: quote, error: quoteErr } = await db.from('quotes').insert({
    rfq_id: rfqId,
    maker_address: makerAddress,
    rate: parsedRate,
    status: 'review',
    maker_signature: signature || null,
    maker_payload_hash: payloadHash || null,
  }).select('*').single();

  if (quoteErr) {
    return NextResponse.json({ error: quoteErr.message }, { status: 500 });
  }

  // Store signed action in audit trail
  await storeSignedAction({
    actionType: 'place_quote',
    signerAddress: makerAddress,
    payload: signedPayload || { action: 'place_quote', rfqId, rate: parsedRate },
    payloadHash: payloadHash || '',
    signature: signature || '',
    sessionPublicKey,
    sessionAuthSignature,
    sessionNonce,
    sessionCreatedAt,
    rfqId,
    quoteId: quote.id,
  });

  // Council event: quote_registered (human)
  let quoteEventResult;
  try {
    quoteEventResult = await processEvent('quote_registered', {
      quoteId: quote.id, rfqId, makerAddress, rate: parsedRate, pair: rfq.pair, size: rfq.size,
    }, rfqId);
  } catch (e: any) { console.error('[Council] quote_registered error:', e.message); }

  // If Council approved, promote quote from review to pending
  if (quoteEventResult && quoteEventResult.consensusDecision === 'approved') {
    await db.from('quotes').update({ status: 'pending' }).eq('id', quote.id);
  }

  // If Council rejected the quote (e.g., insufficient vault), cancel it
  if (quoteEventResult && quoteEventResult.consensusDecision === 'rejected') {
    await db.from('quotes').update({ status: 'rejected' }).eq('id', quote.id);
    const rejectReasons = quoteEventResult.votes
      .filter((v: any) => v.decision === 'reject')
      .map((v: any) => v.reason || 'rejected')
      .filter((r: string, i: number, a: string[]) => a.indexOf(r) === i);
    return NextResponse.json({
      error: `Settlement Council rejected quote: ${rejectReasons.join('; ') || 'insufficient vault capacity'}`,
      councilDecision: 'rejected',
      approvals: quoteEventResult.approvals,
      rejections: quoteEventResult.rejections,
      reasons: rejectReasons,
    }, { status: 400 });
  }

  // Council co-signs the quote
  const councilResult = await councilVerifyAndSign(
    'cosign_quote',
    { quoteId: quote.id, rfqId, makerAddress, rate: parsedRate, pair: rfq.pair },
    [
      { name: 'quote_has_signature', fn: async () => ({ passed: !!(signature && signature.length > 10), reason: signature ? undefined : 'No maker signature' }) },
      { name: 'quote_well_formed', fn: async () => ({ passed: parsedRate > 0 && !!rfqId, reason: parsedRate > 0 ? undefined : 'Invalid rate' }) },
      { name: 'rfq_is_open', fn: async () => ({ passed: rfq.status === 'open', reason: rfq.status !== 'open' ? 'RFQ is ' + rfq.status : undefined }) },
    ],
    { rfqId, quoteId: quote.id, db },
  );

  if (councilResult.decision === 'approved') {
    await db.from('quotes').update({ council_cosignature: councilResult.aggregateHash }).eq('id', quote.id);
  }

  return NextResponse.json({
    success: true,
    quote: {
      id: quote.id,
      rfqId: quote.rfq_id,
      makerAddress: quote.maker_address,
      rate: quote.rate,
      status: quote.status,
    },
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
    version: '4.0',
    description: 'Cross-chain FX settlement marketplace between Ethereum (Sepolia) and Supra Testnet. Dual-role: any agent can be both taker and maker. Secured by a 5-node Settlement Council that tracks every trade via a hash-chain of events, enforces deadlines, and posts attestations to the Supra blockchain.',
    endpoint: 'POST /api/skill/suprafx',

    // ===== PROTOCOL OVERVIEW =====
    protocol: {
      summary: 'SupraFX uses a Request-for-Quote (RFQ) model. Takers request quotes, makers compete with rates, and a 5-node Settlement Council validates every step from RFQ to settlement via an immutable event hash chain.',
      settlementRule: 'The taker ALWAYS goes first. The maker is protected by a stablecoin security deposit. If the maker defaults, the taker is automatically repaid from the deposit.',
      councilRole: 'The Settlement Council (5 nodes, 3-of-5 threshold) independently verifies and votes on every event: RFQ registration, quote validation (including vault capacity checks), match confirmation, TX verification, timeouts, and defaults. All events form a hash chain. The chain hash is signed and posted to Supra blockchain as an attestation.',
    },

    // ===== SECURITY DEPOSIT (MAKERS MUST READ) =====
    securityDeposit: {
      requirement: 'Makers MUST have a stablecoin security deposit in the vault BEFORE placing quotes. Without a deposit, the Settlement Council will reject your quotes.',
      supportedCurrencies: ['USDC', 'USDT'],
      matchingLimit: '90% of your total deposit. If you deposit $10,000, you can quote on trades up to $9,000 in notional value.',
      earmarking: 'When you place a quote that the Council approves, the notional value is earmarked against your deposit. You cannot over-commit beyond your matching limit across multiple quotes.',
      earmarkRelease: 'Earmarks are released when: your quote is withdrawn, the RFQ is cancelled, another quote is matched instead of yours, the trade settles, or the taker times out.',
      defaultPenalty: 'If you are the maker and fail to settle within the deadline: your reputation drops by 67%, your deposit is liquidated (trade value + 10% surcharge), and the taker is repaid from your deposit.',
      howToDeposit: 'Use the web UI: Profile → Security Deposit tab → enter amount → Make Security Deposit. API deposit endpoint coming soon.',
      checkCapacity: 'GET /api/maker-capacity?address=your_supra_address — returns your vault balance, matching limit, total earmarked, and available capacity.',
    },

    // ===== API ACTIONS =====
    actions: {
      get_pairs: {
        body: { action: 'get_pairs' },
        description: 'Get available trading pairs, reference prices, settlement caps, and supported chains.',
      },
      submit_rfq: {
        body: {
          action: 'submit_rfq',
          agentAddress: 'your_supra_address',
          pair: 'ETH/SUPRA',
          size: '1',
          price: '2500 (optional — uses Supra DORA oracle if omitted)',
        },
        description: 'Submit a request for quote as a taker. An auto-maker bot will immediately place a competing quote. Other makers can also quote.',
        councilAction: 'Council registers rfq_registered event in the hash chain.',
      },
      place_quote: {
        body: {
          action: 'place_quote',
          rfqId: 'uuid of the open RFQ',
          makerAddress: 'your_supra_address',
          rate: '2450.50',
        },
        description: 'Place a quote on an open RFQ as a maker. Cannot quote on your own RFQ. One pending quote per maker per RFQ. REQUIRES a security deposit with sufficient available capacity.',
        councilAction: 'Council validates vault capacity and earmarks. If 3+ nodes reject (insufficient deposit), quote is rejected with reason.',
        possibleErrors: [
          'Settlement Council rejected quote: No security deposit',
          'Settlement Council rejected quote: Insufficient capacity: need X, available Y',
          'You already have a pending quote on this RFQ',
        ],
      },
      accept_quote: {
        body: {
          action: 'accept_quote',
          quoteId: 'uuid of the pending quote',
          agentAddress: 'taker_supra_address',
        },
        description: 'Accept a pending quote on your RFQ. Creates a trade, rejects all other quotes, releases their earmarks. Council re-checks maker vault capacity at match time.',
        councilAction: 'Council confirms match (match_confirmed event). Taker deadline starts (30 min production, 1 min testnet).',
      },
      cancel_rfq: {
        body: {
          action: 'cancel_rfq',
          rfqId: 'uuid of the open RFQ',
          agentAddress: 'taker_supra_address',
        },
        description: 'Cancel your open RFQ. All pending quotes are rejected and earmarks released.',
      },
      withdraw_quote: {
        body: {
          action: 'withdraw_quote',
          quoteId: 'uuid of your pending quote',
          agentAddress: 'maker_supra_address',
        },
        description: 'Withdraw your pending quote from an RFQ. Your earmark is released.',
      },
      confirm_tx: {
        endpoint: 'POST /api/confirm-tx',
        body: {
          tradeId: 'uuid of the trade',
          txHash: '0x... or supra tx hash',
          side: 'taker or maker',
          senderAddress: 'your_supra_address',
        },
        description: 'Confirm that you have sent your tokens on-chain. The Settlement Council will independently verify the TX. For takers: after acceptance. For makers: after taker TX is verified.',
        councilAction: 'Council verifies TX on-chain (each node checks independently). On verification: taker_tx_verified or maker_tx_verified event added to hash chain.',
      },
      check_trade: {
        body: { action: 'check_trade', tradeId: 'uuid' },
        description: 'Check full status of a trade including council event chain, node votes, TX hashes, settlement time, and attestation.',
      },
      list_trades: {
        body: { action: 'list_trades', agentAddress: 'your_supra_address' },
        description: 'List all trades where you are taker or maker.',
      },
      check_agent: {
        body: { action: 'check_agent', agentAddress: 'your_supra_address' },
        description: 'Check agent profile: reputation score, trade count, timeout count, ban status.',
      },
    },

    // ===== ADDITIONAL ENDPOINTS =====
    additionalEndpoints: {
      oracle: {
        method: 'GET',
        url: '/api/oracle?pair=ETH/SUPRA',
        description: 'Real-time price data from Supra DORA oracle.',
      },
      makerCapacity: {
        method: 'GET',
        url: '/api/maker-capacity?address=your_supra_address',
        description: 'Check your vault balance, matching limit, earmarked amount, and available capacity for quoting.',
      },
      councilEvents: {
        method: 'GET',
        url: '/api/council-events?tradeId=uuid',
        description: 'Get the full council event hash chain for a trade, including all node votes and attestation.',
      },
    },

    // ===== SUPPORTED PAIRS =====
    supportedPairs: [
      'ETH/SUPRA', 'SUPRA/ETH',
      'fxAAVE/SUPRA', 'SUPRA/fxAAVE',
      'fxLINK/SUPRA', 'SUPRA/fxLINK',
      'fxUSDC/SUPRA', 'SUPRA/fxUSDC',
      'fxUSDT/SUPRA', 'SUPRA/fxUSDT',
      'ETH/fxAAVE', 'ETH/fxLINK', 'ETH/fxUSDC', 'ETH/fxUSDT',
      'fxAAVE/fxLINK', 'fxAAVE/fxUSDC', 'fxAAVE/fxUSDT',
      'fxLINK/fxUSDC', 'fxLINK/fxUSDT',
      'iUSDC/SUPRA', 'iUSDT/SUPRA', 'iETH/SUPRA', 'iBTC/SUPRA',
      'SUPRA/iUSDC', 'SUPRA/iUSDT', 'SUPRA/iETH', 'SUPRA/iBTC',
      'iUSDC/iUSDT', 'iETH/iUSDC', 'iETH/iUSDT', 'iBTC/iUSDC', 'iBTC/iUSDT', 'iBTC/iETH',
      'iUSDC/fxUSDC', 'iUSDT/fxUSDT', 'iETH/ETH', 'iBTC/ETH', 'iBTC/fxUSDC',
      'fxUSDC/iUSDC', 'fxUSDT/iUSDT', 'ETH/iETH', 'ETH/iBTC', 'fxUSDC/iBTC',
    ],
    chains: {
      sepolia: { tokens: ['ETH', 'fxAAVE', 'fxLINK', 'fxUSDC', 'fxUSDT'], explorer: 'https://sepolia.etherscan.io' },
      'supra-testnet': { tokens: ['SUPRA', 'iUSDC', 'iUSDT', 'iETH', 'iBTC'], explorer: 'https://testnet.suprascan.io' },
    },

    // ===== SETTLEMENT FLOW =====
    settlementFlow: [
      '1. Taker calls submit_rfq → RFQ created, Council registers rfq_registered event, bot auto-quotes',
      '2. Makers call place_quote → Council validates vault capacity, earmarks if approved (quote_registered event)',
      '3. Taker calls accept_quote → Council confirms match (match_confirmed event), taker deadline starts',
      '4. Taker sends tokens on source chain → POST /api/confirm-tx with side=taker',
      '5. Council verifies taker TX on-chain (5 nodes independently) → taker_tx_verified event, maker deadline starts',
      '6. Maker sends tokens on dest chain → POST /api/confirm-tx with side=maker',
      '7. Council verifies maker TX → maker_tx_verified event, trade settles',
      '8. Council builds attestation: verifies full event chain, signs chain hash, posts to Supra blockchain',
      '9. Reputation updated for both parties based on settlement speed',
    ],

    // ===== TIMEOUT RULES =====
    timeoutRules: {
      takerDeadline: '30 minutes (1 minute on testnet) from match confirmation to send tokens',
      makerDeadline: '30 minutes (1 minute on testnet) from taker TX verification to send tokens',
      takerTimeout: 'If taker fails to send within deadline: -33% reputation, earmark released. 3 timeouts/month = ban.',
      makerDefault: 'If maker fails to send within deadline: -67% reputation, deposit liquidated (trade value + 10% surcharge), taker automatically repaid.',
      enforcement: 'Deadlines enforced server-side by the Settlement Council. No dependency on any client being online.',
      makerBlocked: 'After deadline expires, the maker CANNOT settle even if they try. The Council processes the default.',
    },

    // ===== REPUTATION =====
    reputation: {
      baseScore: 5.0,
      settlementBonus: '+5.0 (<5min), +3.0 (<15min), +1.0 (<30min)',
      takerTimeoutPenalty: '-33% of current score',
      makerDefaultPenalty: '-67% of current score',
      ban: '3 taker timeouts in a calendar month = matching suspended',
      checkScore: 'Use check_agent action to see your current score',
    },

    // ===== AGENT INTEGRATION GUIDE =====
    agentIntegration: {
      description: 'AI agents can operate as takers, makers, or both via this REST API. No API key required for testnet.',
      takerFlow: [
        '1. Call get_pairs to see available pairs and reference prices',
        '2. Call submit_rfq with your desired pair and size',
        '3. Wait for quotes (poll list_trades or use Supabase realtime)',
        '4. Call accept_quote to accept the best quote',
        '5. Send tokens on source chain',
        '6. Call POST /api/confirm-tx with txHash and side=taker',
        '7. Wait for settlement (Council verifies, maker sends, trade settles)',
      ],
      makerFlow: [
        '1. FIRST: Deposit stablecoins in the Security Vault (currently UI-only)',
        '2. Check capacity: GET /api/maker-capacity?address=your_address',
        '3. Poll for open RFQs via list_trades or Supabase realtime',
        '4. Call place_quote on RFQs you want to fill (must be within vault capacity)',
        '5. If your quote is accepted, you will see the trade via list_trades',
        '6. Wait for taker to send and Council to verify',
        '7. Send tokens on dest chain',
        '8. Call POST /api/confirm-tx with txHash and side=maker',
        '9. Trade settles, earmark released, reputation updated',
      ],
      authentication: 'Supra wallet address used as agent identity. Sign actions via session key for audit trail.',
      riskWarning: 'As a maker, if you fail to settle within the deadline, your security deposit will be liquidated. Always ensure you can fulfill trades you quote on.',
    },

    testnetLimits: {
      ethLeg: '0.00001 ETH per settlement',
      supraLeg: '0.001 SUPRA per settlement',
      note: 'Notional values can be large but actual on-chain transfers are capped to small testnet amounts.',
    },
  });
}
