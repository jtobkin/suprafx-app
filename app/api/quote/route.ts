import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { rfqId, makerAddress, rate } = await req.json();

    if (!rfqId || !makerAddress || !rate) {
      return NextResponse.json({ error: 'rfqId, makerAddress, and rate required' }, { status: 400 });
    }

    const db = getServiceClient();

    const { data: rfq } = await db.from('rfqs').select('*').eq('id', rfqId).single();
    if (!rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });
    if (rfq.status !== 'open') return NextResponse.json({ error: 'RFQ no longer open' }, { status: 400 });

    // Register maker if needed
    await db.from('agents').upsert({
      wallet_address: makerAddress,
      role: 'maker',
      chains: ['sepolia', 'supra-testnet'],
      rep_deposit_base: 5.0,
      rep_total: 5.0,
    }, { onConflict: 'wallet_address' });

    // Create pending quote — taker must accept to create trade
    const { data: quote, error: qErr } = await db.from('quotes').insert({
      rfq_id: rfqId,
      maker_address: makerAddress,
      rate,
      status: 'pending',
    }).select().single();

    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

    return NextResponse.json({ quote, message: 'Quote placed. Taker must accept to create a trade.' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
