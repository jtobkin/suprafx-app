export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const makerAddress = req.nextUrl.searchParams.get('address');
  if (!makerAddress) return NextResponse.json({ error: 'address required' }, { status: 400 });

  const db = getServiceClient();

  // Get vault balance
  const { data: balance } = await db.from('vault_balances')
    .select('balance')
    .eq('maker_address', makerAddress)
    .single();

  const vaultBalance = Number(balance?.balance || 0);
  const matchingLimit = vaultBalance * 0.9;

  // Compute active earmarks from council event chain
  const { data: quoteEvents } = await db.from('council_event_chain')
    .select('id, rfq_id, payload, consensus_reached, consensus_decision, sequence_number')
    .eq('event_type', 'quote_registered')
    .eq('consensus_reached', true)
    .eq('consensus_decision', 'approved');

  let totalEarmarked = 0;
  const activeEarmarks: Array<{ rfqId: string; quoteId: string; amount: number }> = [];

  for (const evt of quoteEvents || []) {
    if (evt.payload?.makerAddress !== makerAddress) continue;
    const notional = (evt.payload?.size || 0) * (evt.payload?.rate || 0);
    if (notional <= 0) continue;

    // Check if released
    const { data: later } = await db.from('council_event_chain')
      .select('event_type, payload')
      .eq('rfq_id', evt.rfq_id)
      .eq('consensus_reached', true)
      .gt('sequence_number', evt.sequence_number);

    let released = false;
    for (const l of later || []) {
      if (l.event_type === 'quote_withdrawn' && l.payload?.quoteId === evt.payload?.quoteId) { released = true; break; }
      if (l.event_type === 'rfq_cancelled') { released = true; break; }
      if (l.event_type === 'match_confirmed' && l.payload?.quoteId !== evt.payload?.quoteId) { released = true; break; }
      if (l.event_type === 'match_confirmed' && l.payload?.quoteId === evt.payload?.quoteId) {
        for (const t of later || []) {
          if (['maker_tx_verified', 'taker_timed_out', 'maker_defaulted'].includes(t.event_type)) { released = true; break; }
        }
        break;
      }
    }

    if (!released) {
      totalEarmarked += notional;
      activeEarmarks.push({ rfqId: evt.rfq_id, quoteId: evt.payload?.quoteId, amount: notional });
    }
  }

  const availableCapacity = Math.max(0, matchingLimit - totalEarmarked);

  return NextResponse.json({
    vaultBalance,
    matchingLimit,
    totalEarmarked,
    availableCapacity,
    activeEarmarks,
  });
}
