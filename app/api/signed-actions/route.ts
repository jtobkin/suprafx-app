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
    if (tradeId) {
      // Get the trade to know who the taker and maker are
      const { data: trade } = await db.from('trades')
        .select('rfq_id, taker_address, maker_address')
        .eq('id', tradeId)
        .single();

      if (!trade) {
        return NextResponse.json({ actions: [] });
      }

      // Only return actions signed by the taker, the maker, or council nodes
      const stakeholders = [trade.taker_address, trade.maker_address];
      // Council nodes will be identified by their signer_address starting with "N-" or "council-"

      const { data, error } = await db.from('signed_actions')
        .select('*')
        .or(`trade_id.eq.${tradeId},rfq_id.eq.${trade.rfq_id}`)
        .order('created_at', { ascending: true });

      if (error) {
        return NextResponse.json({ error: error.message, actions: [] }, { status: 500 });
      }

      // Filter to only stakeholders of THIS trade
      const filtered = (data || []).filter(a => {
        // Taker or maker of this trade
        if (stakeholders.includes(a.signer_address)) return true;
        // Council nodes
        if (a.signer_address.startsWith('N-') || a.signer_address.startsWith('council-')) return true;
        // Council action types
        if (a.action_type.startsWith('council_')) return true;
        return false;
      });

      return NextResponse.json({ actions: filtered });

    } else if (rfqId) {
      const { data, error } = await db.from('signed_actions')
        .select('*')
        .eq('rfq_id', rfqId)
        .order('created_at', { ascending: true });

      if (error) {
        return NextResponse.json({ error: error.message, actions: [] }, { status: 500 });
      }

      return NextResponse.json({ actions: data || [] });
    }

    return NextResponse.json({ actions: [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, actions: [] }, { status: 500 });
  }
}
