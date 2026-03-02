import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { tradeId, txHash, side } = await req.json();

    if (!tradeId || !txHash || !side) {
      return NextResponse.json({ error: 'tradeId, txHash, and side (taker|maker) required' }, { status: 400 });
    }

    const db = getServiceClient();
    const { data: trade } = await db.from('trades').select('*').eq('id', tradeId).single();
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

    if (side === 'taker') {
      if (trade.status !== 'open') {
        return NextResponse.json({ error: 'Trade not in open state' }, { status: 400 });
      }
      await db.from('trades').update({
        taker_tx_hash: txHash,
        status: 'taker_sent',
      }).eq('id', tradeId);
    } else if (side === 'maker') {
      if (trade.status !== 'taker_verified') {
        return NextResponse.json({ error: 'Trade not in taker_verified state' }, { status: 400 });
      }
      await db.from('trades').update({
        maker_tx_hash: txHash,
        status: 'maker_sent',
      }).eq('id', tradeId);
    } else {
      return NextResponse.json({ error: 'side must be taker or maker' }, { status: 400 });
    }

    return NextResponse.json({ success: true, tradeId, side, txHash });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
