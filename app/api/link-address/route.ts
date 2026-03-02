export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { ethers } from 'ethers';

export async function POST(req: NextRequest) {
  try {
    const { supraAddress, evmAddress, signature } = await req.json();
    if (!supraAddress || !evmAddress || !signature) {
      return NextResponse.json({ error: 'supraAddress, evmAddress, and signature required' }, { status: 400 });
    }

    const message = `SupraFX: Link EVM address ${evmAddress.toLowerCase()} to Supra account ${supraAddress}`;
    const recoveredAddress = ethers.verifyMessage(message, signature);

    if (recoveredAddress.toLowerCase() !== evmAddress.toLowerCase()) {
      return NextResponse.json({ error: 'Signature verification failed' }, { status: 403 });
    }

    const db = getServiceClient();
    const { data, error } = await db.from('address_links').upsert({
      supra_address: supraAddress,
      evm_address: evmAddress.toLowerCase(),
      evm_signature: signature,
      evm_verified_at: new Date().toISOString(),
    }, { onConflict: 'supra_address' }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ link: data, verified: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const supraAddress = req.nextUrl.searchParams.get('supra');
  if (!supraAddress) return NextResponse.json({ error: 'supra param required' }, { status: 400 });

  const db = getServiceClient();
  const { data } = await db.from('address_links').select('*').eq('supra_address', supraAddress).single();
  return NextResponse.json({ link: data });
}
