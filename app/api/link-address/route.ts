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

    // Legacy table: upsert (keeps backwards compat, stores most recent EVM link)
    await db.from('address_links').upsert({
      supra_address: supraAddress,
      evm_address: evmAddress.toLowerCase(),
      evm_signature: signature,
      evm_verified_at: new Date().toISOString(),
    }, { onConflict: 'supra_address' });

    // New table: insert (allows multiple addresses per chain)
    // Use supra_address + linked_address as unique key so same address isn't linked twice
    let linkData = null;
    try {
      const { data, error } = await db.from('linked_addresses').upsert({
        supra_address: supraAddress,
        chain: resolvedChain,
        linked_address: evmAddress.toLowerCase(),
        wallet_provider: resolvedProvider,
        signature: signature,
        verified_at: new Date().toISOString(),
      }, { onConflict: 'supra_address,linked_address' }).select().single();

      if (!error) linkData = data;
    } catch {
      // Table may not exist yet — legacy table handles it
    }

    return NextResponse.json({
      verified: true,
      link: linkData,
      provider: resolvedProvider,
      chain: resolvedChain,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { supraAddress, linkedAddress, chain } = await req.json();
    if (!supraAddress || !linkedAddress) {
      return NextResponse.json({ error: 'supraAddress and linkedAddress required' }, { status: 400 });
    }

    const db = getServiceClient();

    // Remove from linked_addresses
    try {
      await db.from('linked_addresses')
        .delete()
        .eq('supra_address', supraAddress)
        .eq('linked_address', linkedAddress.toLowerCase());
    } catch {}

    // If this was the address in the legacy table, clear it
    const { data: legacy } = await db.from('address_links')
      .select('evm_address')
      .eq('supra_address', supraAddress)
      .single();

    if (legacy?.evm_address?.toLowerCase() === linkedAddress.toLowerCase()) {
      // Find next linked address to promote, or clear
      let nextAddr = null;
      try {
        const { data: remaining } = await db.from('linked_addresses')
          .select('linked_address')
          .eq('supra_address', supraAddress)
          .limit(1);
        if (remaining?.length) nextAddr = remaining[0].linked_address;
      } catch {}

      if (nextAddr) {
        await db.from('address_links').update({ evm_address: nextAddr }).eq('supra_address', supraAddress);
      } else {
        await db.from('address_links').update({
          evm_address: null,
          evm_signature: null,
          evm_verified_at: null,
        }).eq('supra_address', supraAddress);
      }
    }

    return NextResponse.json({ deleted: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const supraAddress = req.nextUrl.searchParams.get('supra');
  if (!supraAddress) return NextResponse.json({ error: 'supra param required' }, { status: 400 });

  const db = getServiceClient();

  // Get legacy data
  const { data: legacy } = await db.from('address_links').select('*').eq('supra_address', supraAddress).single();

  // Try new table
  let links: any[] = [];
  try {
    const { data, error } = await db.from('linked_addresses')
      .select('*')
      .eq('supra_address', supraAddress)
      .order('verified_at', { ascending: true });
    if (!error && data) links = data;
  } catch {}

  // If no linked_addresses but legacy exists, synthesize
  if (!links.length && legacy?.evm_address) {
    links = [{
      supra_address: legacy.supra_address,
      chain: 'sepolia',
      linked_address: legacy.evm_address,
      wallet_provider: 'unknown',
      verified_at: legacy.evm_verified_at,
    }];
  }

  return NextResponse.json({ link: legacy, links });
}
