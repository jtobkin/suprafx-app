export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (!address) return NextResponse.json({ error: 'address required' }, { status: 400 });

  const db = getServiceClient();
  const history: Array<{
    timestamp: string;
    eventType: string;
    tradeId: string | null;
    change: number;
    changeLabel: string;
    resultingScore: number;
    details: string;
  }> = [];

  // Get settlement events (positive rep changes)
  const { data: settlements } = await db.from('council_event_chain')
    .select('trade_id, payload, consensus_at, created_at')
    .eq('event_type', 'maker_tx_verified')
    .eq('consensus_reached', true)
    .order('created_at', { ascending: false })
    .limit(50);

  for (const evt of settlements || []) {
    if (!evt.trade_id) continue;
    const { data: trade } = await db.from('trades')
      .select('taker_address, maker_address, settle_ms, pair, size')
      .eq('id', evt.trade_id).single();
    if (!trade) continue;
    if (trade.taker_address !== address && trade.maker_address !== address) continue;

    const settleMs = trade.settle_ms || evt.payload?.settlementTimeMs;
    let bonus = 0;
    let label = '';
    if (settleMs && settleMs <= 5 * 60 * 1000) { bonus = 5.0; label = '+5.0 (< 5 min)'; }
    else if (settleMs && settleMs <= 15 * 60 * 1000) { bonus = 3.0; label = '+3.0 (< 15 min)'; }
    else if (settleMs && settleMs <= 30 * 60 * 1000) { bonus = 1.0; label = '+1.0 (< 30 min)'; }
    else { bonus = 0; label = '+0.0'; }

    history.push({
      timestamp: evt.consensus_at || evt.created_at,
      eventType: 'settlement',
      tradeId: evt.trade_id,
      change: bonus,
      changeLabel: label,
      resultingScore: 0, // computed below
      details: `${trade.pair} — ${trade.size} settled`,
    });
  }

  // Get timeout/default events (negative rep changes)
  const { data: timeouts } = await db.from('council_event_chain')
    .select('trade_id, event_type, payload, consensus_at, created_at')
    .in('event_type', ['taker_timed_out', 'maker_defaulted'])
    .eq('consensus_reached', true)
    .order('created_at', { ascending: false })
    .limit(50);

  for (const evt of timeouts || []) {
    const party = evt.payload?.party;
    if (party !== address) continue;

    const penaltyPct = evt.event_type === 'taker_timed_out' ? 33 : 67;
    history.push({
      timestamp: evt.consensus_at || evt.created_at,
      eventType: evt.event_type,
      tradeId: evt.trade_id,
      change: -penaltyPct,
      changeLabel: `-${penaltyPct}%`,
      resultingScore: 0,
      details: evt.event_type === 'taker_timed_out' ? 'Taker timed out' : 'Maker defaulted — deposit liquidated',
    });
  }

  // Sort by timestamp descending
  history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Get current score
  const { data: agent } = await db.from('agents')
    .select('rep_total, rep_penalties, trade_count')
    .eq('wallet_address', address).single();

  return NextResponse.json({
    currentScore: Number(agent?.rep_total || 5),
    tradeCount: agent?.trade_count || 0,
    totalPenalties: Number(agent?.rep_penalties || 0),
    history,
  });
}
