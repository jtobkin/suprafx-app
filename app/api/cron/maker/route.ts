import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

const MAKER_ADDRESS = 'auto-maker-bot';
const SPREAD_BPS = 10; // 0.1% spread

// Automated maker bot: quotes all open RFQs
export async function GET() {
  const db = getServiceClient();
  const results: any[] = [];

  // Ensure maker bot is registered
  await db.from('agents').upsert({
    wallet_address: MAKER_ADDRESS,
    role: 'maker',
    domain: 'automaker.supra',
    chains: ['sepolia', 'supra-testnet'],
    rep_deposit_base: 10.0,
    rep_total: 10.0,
  }, { onConflict: 'wallet_address' });

  // Get open RFQs
  const { data: openRfqs } = await db
    .from('rfqs')
    .select('*')
    .eq('status', 'open')
    .gt('expires_at', new Date().toISOString());

  for (const rfq of openRfqs || []) {
    // Calculate quote rate with spread
    const rate = rfq.reference_price * (1 - SPREAD_BPS / 10000);

    // Submit quote + auto-match
    const { data: quote } = await db.from('quotes').insert({
      rfq_id: rfq.id,
      maker_address: MAKER_ADDRESS,
      rate,
      status: 'accepted',
    }).select().single();

    const { data: trade } = await db.from('trades').insert({
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

    await db.from('rfqs').update({ status: 'matched' }).eq('id', rfq.id);

    results.push({ rfqId: rfq.id, tradeId: trade?.id, rate });
  }

  // Expire old RFQs
  await db.from('rfqs')
    .update({ status: 'expired' })
    .eq('status', 'open')
    .lt('expires_at', new Date().toISOString());

  return NextResponse.json({
    quoted: results.length,
    results,
    timestamp: new Date().toISOString(),
  });
}
