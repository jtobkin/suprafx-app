export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const rfqId = req.nextUrl.searchParams.get('rfqId');
  const tradeId = req.nextUrl.searchParams.get('tradeId');

  if (!rfqId && !tradeId) return NextResponse.json({ error: 'rfqId or tradeId required' }, { status: 400 });

  const db = getServiceClient();

  // If we have tradeId but not rfqId, look up the rfqId
  let resolvedRfqId = rfqId;
  if (!resolvedRfqId && tradeId) {
    const { data: trade } = await db.from('trades').select('rfq_id').eq('id', tradeId).single();
    resolvedRfqId = trade?.rfq_id;
  }
  if (!resolvedRfqId) return NextResponse.json({ events: [], votes: [] });

  const { data: events } = await db.from('council_event_chain')
    .select('*')
    .eq('rfq_id', resolvedRfqId)
    .order('sequence_number', { ascending: true });

  const { data: votes } = await db.from('council_node_votes_v2')
    .select('*')
    .eq('rfq_id', resolvedRfqId)
    .order('created_at', { ascending: true });

  // Also get signed_actions for user signatures (session keys, StarKey auth)
  const { data: signedActions } = await db.from('signed_actions')
    .select('*')
    .or(tradeId ? `trade_id.eq.${tradeId},rfq_id.eq.${resolvedRfqId}` : `rfq_id.eq.${resolvedRfqId}`)
    .order('created_at', { ascending: true });

  return NextResponse.json({
    events: events || [],
    votes: votes || [],
    signedActions: signedActions || [],
  });
}
