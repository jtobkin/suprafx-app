import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { takerAddress, pair, size, sourceChain, destChain, maxSlippage } = await req.json();

    if (!takerAddress || !pair || !size) {
      return NextResponse.json({ error: 'takerAddress, pair, and size required' }, { status: 400 });
    }

    const db = getServiceClient();

    // Get reference price
    const { data: sv } = await db.from('s_values').select('price').eq('pair', pair).single();
    const referencePrice = sv?.price || 0;

    const { data, error } = await db
      .from('rfqs')
      .insert({
        taker_address: takerAddress,
        pair,
        size,
        source_chain: sourceChain || 'sepolia',
        dest_chain: destChain || 'supra-testnet',
        max_slippage: maxSlippage || 0.005,
        reference_price: referencePrice,
        status: 'open',
        expires_at: new Date(Date.now() + 120000).toISOString(), // 2 min expiry
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ rfq: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  const db = getServiceClient();
  const { data, error } = await db
    .from('rfqs')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rfqs: data });
}
