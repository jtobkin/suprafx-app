import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAKER_ADDRESS = 'auto-maker-bot';
const SPREAD_BPS = 10;

export async function GET() {
  const db = getServiceClient();
  const results: any[] = [];
  const debug: any[] = [];

  // Ensure maker bot is registered
  const { error: regErr } = await db.from('agents').upsert({
    wallet_address: MAKER_ADDRESS,
    role: 'maker',
    domain: 'automaker.supra',
    chains: ['sepolia', 'supra-testnet'],
    rep_deposit_base: 10.0,
    rep_total: 10.0,
  }, { onConflict: 'wallet_address' });

  if (regErr) debug.push({ step: 'register', error: regErr.message });

  // Get ALL rfqs for debug
  const { data: allRfqs, error: rfqErr } = await db
    .from('rfqs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  debug.push({
    step: 'all_rfqs',
    count: allRfqs?.length || 0,
    rfqs: allRfqs?.map(r => ({ id: r.display_id, status: r.status, expires: r.expires_at, taker: r.taker_address })),
    error: rfqErr?.message,
  });

  // Get open RFQs
  const now = new Date().toISOString();
  const { data: openRfqs, error: openErr } = await db
    .from('rfqs')
    .select('*')
    .eq('status', 'open')
    .gt('expires_at', now);

  debug.push({
    step: 'open_rfqs',
    count: openRfqs?.length || 0,
    now,
    error: openErr?.message,
  });

  for (const rfq of openRfqs || []) {
    const rate = rfq.reference_price * (1 - SPREAD_BPS / 10000);

    const { data: quote, error: qErr } = await db.from('quotes').insert({
      rfq_id: rfq.id,
      maker_address: MAKER_ADDRESS,
      rate,
      status: 'accepted',
    }).select().single();

    if (qErr) { debug.push({ step: 'quote', error: qErr.message }); continue; }

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

    if (tErr) { debug.push({ step: 'trade', error: tErr.message }); continue; }

    await db.from('rfqs').update({ status: 'matched' }).eq('id', rfq.id);
    results.push({ rfqId: rfq.display_id, tradeId: trade?.display_id, rate });
  }

  // Expire old
  await db.from('rfqs')
    .update({ status: 'expired' })
    .eq('status', 'open')
    .lt('expires_at', now);

  return NextResponse.json({ quoted: results.length, results, debug, timestamp: now });
}
