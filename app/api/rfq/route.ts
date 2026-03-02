export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

import { getBotAddresses } from '@/lib/bot-wallets';

const SPREAD_BPS = 10;

export async function POST(req: NextRequest) {
  try {
    const { takerAddress, pair, size, sourceChain, destChain, maxSlippage } = await req.json();

    if (!takerAddress || !pair || !size) {
      return NextResponse.json({ error: 'takerAddress, pair, and size required' }, { status: 400 });
    }

    const db = getServiceClient();
    const botAddrs = getBotAddresses();
    const MAKER_ADDRESS = 'auto-maker-bot';

    // Get reference price
    const { data: sv } = await db.from('s_values').select('price').eq('pair', pair).single();
    const referencePrice = sv?.price || 0;

    // Create RFQ
    const { data: rfq, error: rfqErr } = await db
      .from('rfqs')
      .insert({
        taker_address: takerAddress,
        pair,
        size,
        source_chain: sourceChain || 'sepolia',
        dest_chain: destChain || 'supra-testnet',
        max_slippage: maxSlippage || 0.005,
        reference_price: referencePrice,
        status: 'open',
        expires_at: new Date(Date.now() + 300000).toISOString(), // 5 min expiry
      })
      .select()
      .single();

    if (rfqErr) {
      return NextResponse.json({ error: rfqErr.message }, { status: 500 });
    }

    // === AUTO-MATCH: Maker bot immediately quotes ===
    // Ensure maker bot is registered
    await db.from('agents').upsert({
      wallet_address: MAKER_ADDRESS,
      role: 'maker',
      domain: 'automaker.supra',
      chains: ['sepolia', 'supra-testnet'],
      rep_deposit_base: 10.0,
      rep_total: 10.0,
    }, { onConflict: 'wallet_address' });

    const rate = referencePrice * (1 - SPREAD_BPS / 10000);

    // Create quote
    const { error: qErr } = await db.from('quotes').insert({
      rfq_id: rfq.id,
      maker_address: MAKER_ADDRESS,
      rate,
      status: 'accepted',
    });

    if (qErr) {
      return NextResponse.json({ rfq, matched: false, quoteError: qErr.message });
    }

    // Create trade
    const { data: trade, error: tErr } = await db.from('trades').insert({
      rfq_id: rfq.id,
      pair: rfq.pair,
      size: rfq.size,
      rate,
      source_chain: rfq.source_chain,
      dest_chain: rfq.dest_chain,
      taker_address: rfq.taker_address,
      maker_address: MAKER_ADDRESS,
      status: 'open',
    }).select().single();

    if (tErr) {
      return NextResponse.json({ rfq, matched: false, tradeError: tErr.message });
    }

    // Update RFQ to matched
    await db.from('rfqs').update({ status: 'matched' }).eq('id', rfq.id);

    return NextResponse.json({ rfq: { ...rfq, status: 'matched' }, trade, matched: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  const db = getServiceClient();
  const { data, error } = await db
    .from('rfqs')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rfqs: data });
}
