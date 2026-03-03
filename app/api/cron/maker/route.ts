import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAKER_ADDRESS = 'auto-maker-bot';
const SPREAD_BPS = 30; // 0.3% below reference

// Bot places pending quotes on open RFQs — never auto-matches
export async function GET() {
  const db = getServiceClient();
  const results: any[] = [];
  const now = new Date().toISOString();

  // Ensure bot is registered
  await db.from('agents').upsert({
    wallet_address: MAKER_ADDRESS,
    role: 'maker',
    domain: 'suprafx-maker-bot',
    chains: ['sepolia', 'supra-testnet'],
    rep_deposit_base: 5.0,
    rep_total: 5.0,
  }, { onConflict: 'wallet_address' });

  // Get open RFQs that bot hasn't quoted on yet
  const { data: openRfqs } = await db
    .from('rfqs')
    .select('*')
    .eq('status', 'open')
    .gt('expires_at', now);

  for (const rfq of openRfqs || []) {
    // Check if bot already has a pending quote on this RFQ
    const { data: existing } = await db.from('quotes')
      .select('id')
      .eq('rfq_id', rfq.id)
      .eq('maker_address', MAKER_ADDRESS)
      .in('status', ['pending']);

    if (existing && existing.length > 0) continue; // already quoted

    const rate = rfq.reference_price * (1 - SPREAD_BPS / 10000);

    await db.from('quotes').insert({
      rfq_id: rfq.id,
      maker_address: MAKER_ADDRESS,
      rate,
      status: 'pending',
    });

    results.push({ rfqId: rfq.display_id, rate, status: 'pending' });
  }

  // Expire old RFQs
  await db.from('rfqs')
    .update({ status: 'expired' })
    .eq('status', 'open')
    .lt('expires_at', now);

  return NextResponse.json({ quoted: results.length, results, timestamp: now });
}
