export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

// Reset stuck trades back to open, or mark as failed
// GET /api/reset?trade_id=xxx or GET /api/reset to reset all stuck
export async function GET(req: Request) {
  const db = getServiceClient();
  const url = new URL(req.url);
  const tradeId = url.searchParams.get('trade_id');

  if (tradeId) {
    await db.from('trades').update({ 
      status: 'open', 
      taker_tx_hash: null, 
      maker_tx_hash: null,
      taker_tx_confirmed_at: null,
      maker_tx_confirmed_at: null,
    }).eq('id', tradeId);
    return NextResponse.json({ reset: tradeId });
  }

  // Reset all non-settled trades
  const { data } = await db.from('trades')
    .update({ 
      status: 'open', 
      taker_tx_hash: null, 
      maker_tx_hash: null,
      taker_tx_confirmed_at: null,
      maker_tx_confirmed_at: null,
    })
    .in('status', ['taker_sent', 'taker_verified', 'maker_sent'])
    .select();

  return NextResponse.json({ reset: data?.length || 0 });
}
