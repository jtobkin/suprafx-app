import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { walletAddress, role, domain, chains } = await req.json();

    if (!walletAddress || !role) {
      return NextResponse.json({ error: 'walletAddress and role required' }, { status: 400 });
    }

    if (!['maker', 'taker'].includes(role)) {
      return NextResponse.json({ error: 'role must be maker or taker' }, { status: 400 });
    }

    const db = getServiceClient();

    const { data, error } = await db
      .from('agents')
      .upsert({
        wallet_address: walletAddress,
        role,
        domain: domain || `${role}-${walletAddress.slice(0, 6)}`,
        chains: chains || ['sepolia', 'supra-testnet'],
        rep_deposit_base: 5.0,
        rep_total: 5.0,
      }, { onConflict: 'wallet_address' })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ agent: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
