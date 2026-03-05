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
      const { data: trade } = await db.from('trades')
        .select('rfq_id, taker_address, maker_address')
        .eq('id', tradeId)
        .single();

      if (!trade) {
        return NextResponse.json({ actions: [] });
      }

      const stakeholders = [trade.taker_address, trade.maker_address];

      // Query actions linked to this trade OR its parent RFQ
      // Use two separate queries to avoid Supabase OR syntax issues with UUIDs
      const [byTrade, byRfq] = await Promise.all([
        db.from('signed_actions').select('*').eq('trade_id', tradeId).order('created_at', { ascending: true }),
        trade.rfq_id
          ? db.from('signed_actions').select('*').eq('rfq_id', trade.rfq_id).order('created_at', { ascending: true })
          : { data: [] },
      ]);

      // Merge and dedupe by id
      const allActions = [...(byTrade.data || []), ...(byRfq.data || [])];
      const seen = new Set<string>();
      const deduped = allActions.filter(a => {
        if (seen.has(a.id)) return false;
        seen.add(a.id);
        return true;
      });

      // Filter to stakeholders of THIS trade + council
      const filtered = deduped.filter(a => {
        if (stakeholders.includes(a.signer_address)) return true;
        if (a.signer_address.startsWith('N-') || a.signer_address.startsWith('council-')) return true;
        if (a.action_type.startsWith('council_')) return true;
        return false;
      });

      // Sort chronologically
      filtered.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

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
