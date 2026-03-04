export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const tradeId = req.nextUrl.searchParams.get('tradeId');
  const rfqId = req.nextUrl.searchParams.get('rfqId');

  if (!tradeId && !rfqId) {
    return NextResponse.json({ error: 'tradeId or rfqId required' }, { status: 400 });
  }

  const db = getServiceClient();

  try {
    let query = db.from('signed_actions')
      .select('*')
      .order('created_at', { ascending: true });

    if (tradeId) {
      // Get actions for this trade AND the associated RFQ/quotes
      const { data: trade } = await db.from('trades').select('rfq_id').eq('id', tradeId).single();
      if (trade?.rfq_id) {
        query = db.from('signed_actions')
          .select('*')
          .or(`trade_id.eq.${tradeId},rfq_id.eq.${trade.rfq_id}`)
          .order('created_at', { ascending: true });
      } else {
        query = query.eq('trade_id', tradeId);
      }
    } else if (rfqId) {
      query = query.eq('rfq_id', rfqId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message, actions: [] }, { status: 500 });
    }

    return NextResponse.json({ actions: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, actions: [] }, { status: 500 });
  }
}
