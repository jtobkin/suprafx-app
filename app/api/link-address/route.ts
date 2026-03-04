export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { ethers } from 'ethers';

export async function POST(req: NextRequest) {
  try {
    const { supraAddress, evmAddress, signature, walletProvider, chain } = await req.json();
    if (!supraAddress || !evmAddress || !signature) {
      return NextResponse.json({ error: 'supraAddress, evmAddress, and signature required' }, { status: 400 });
    }

    const resolvedChain = chain || 'sepolia';
    const resolvedProvider = walletProvider || 'metamask';

    const message = `SupraFX: Link EVM address ${evmAddress.toLowerCase()} to Supra account ${supraAddress}`;
    const recoveredAddress = ethers.verifyMessage(message, signature);

    if (recoveredAddress.toLowerCase() !== evmAddress.toLowerCase()) {
      return NextResponse.json({ error: 'Signature verification failed' }, { status: 403 });
    }

    const db = getServiceClient();

    // Upsert into the legacy address_links table (backwards compatible)
    await db.from('address_links').upsert({
      supra_address: supraAddress,
      evm_address: evmAddress.toLowerCase(),
      evm_signature: signature,
      evm_verified_at: new Date().toISOString(),
    }, { onConflict: 'supra_address' });

    // Also upsert into the new linked_addresses table
    const { data, error } = await db.from('linked_addresses').upsert({
      supra_address: supraAddress,
      chain: resolvedChain,
      linked_address: evmAddress.toLowerCase(),
      wallet_provider: resolvedProvider,
      signature: signature,
      verified_at: new Date().toISOString(),
    }, { onConflict: 'supra_address,chain' }).select().single();

    // If linked_addresses table doesn't exist yet, use legacy
    if (error && error.code === '42P01') {
      return NextResponse.json({ verified: true, provider: resolvedProvider, chain: resolvedChain });
    }

    return NextResponse.json({
      verified: true,
      link: data,
      provider: resolvedProvider,
      chain: resolvedChain,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const supraAddress = req.nextUrl.searchParams.get('supra');
  if (!supraAddress) return NextResponse.json({ error: 'supra param required' }, { status: 400 });

  const db = getServiceClient();

  // Try new table first
  const { data: links, error } = await db.from('linked_addresses')
    .select('*')
    .eq('supra_address', supraAddress)
    .order('verified_at', { ascending: true });

  if (error && error.code === '42P01') {
    // Table doesn't exist, fall back to legacy
    const { data } = await db.from('address_links').select('*').eq('supra_address', supraAddress).single();
    return NextResponse.json({ link: data, links: data ? [{
      supra_address: data.supra_address,
      chain: 'sepolia',
      linked_address: data.evm_address,
      wallet_provider: 'metamask',
      verified_at: data.evm_verified_at,
    }] : [] });
  }

  const { data: legacy } = await db.from('address_links').select('*').eq('supra_address', supraAddress).single();

  return NextResponse.json({ link: legacy, links: links || [] });
}
