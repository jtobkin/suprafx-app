import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { takerAddress, pair, size, sourceChain, destChain, referencePrice } = await req.json();

    if (!takerAddress || !pair || !size) {
      return NextResponse.json({ error: 'takerAddress, pair, and size required' }, { status: 400 });
    }

    const db = getServiceClient();

    // Register taker
    await db.from('agents').upsert({
      wallet_address: takerAddress,
      role: 'taker',
      chains: ['sepolia', 'supra-testnet'],
      rep_deposit_base: 5.0,
      rep_total: 5.0,
    }, { onConflict: 'wallet_address' });

    // Create open RFQ — no auto-match
    const { data: rfq, error: rfqErr } = await db.from('rfqs').insert({
      taker_address: takerAddress,
      pair,
      size: parseFloat(size),
      source_chain: sourceChain || 'sepolia',
      dest_chain: destChain || 'supra-testnet',
      max_slippage: 0,
      reference_price: referencePrice || 0,
      status: 'open',
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }).select().single();

    if (rfqErr) return NextResponse.json({ error: rfqErr.message }, { status: 500 });

    return NextResponse.json({ rfq, message: 'RFQ created. Makers will place quotes for taker to accept.' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
