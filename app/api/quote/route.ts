import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { rfqId, makerAddress, rate } = await req.json();

    if (!rfqId || !makerAddress || !rate) {
      return NextResponse.json({ error: 'rfqId, makerAddress, and rate required' }, { status: 400 });
    }

    const db = getServiceClient();

    // Get the RFQ
    const { data: rfq } = await db.from('rfqs').select('*').eq('id', rfqId).single();
    if (!rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });
    if (rfq.status !== 'open') return NextResponse.json({ error: 'RFQ no longer open' }, { status: 400 });

    // Check slippage
    const slippage = Math.abs(rate - rfq.reference_price) / rfq.reference_price;
    if (slippage > rfq.max_slippage) {
      return NextResponse.json({ error: 'Rate exceeds max slippage' }, { status: 400 });
    }

    // Insert quote
    const { data: quote, error: qErr } = await db.from('quotes').insert({
      rfq_id: rfqId,
      maker_address: makerAddress,
      rate,
      status: 'accepted',
    }).select().single();

    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

    // Auto-match: create trade
    const { data: trade, error: tErr } = await db.from('trades').insert({
      rfq_id: rfqId,
      pair: rfq.pair,
      size: rfq.size,
      rate,
      source_chain: rfq.source_chain,
      dest_chain: rfq.dest_chain,
      taker_address: rfq.taker_address,
      maker_address: makerAddress,
      status: 'open',
    }).select().single();

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

    // Update RFQ status
    await db.from('rfqs').update({ status: 'matched' }).eq('id', rfqId);

    return NextResponse.json({ quote, trade });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
