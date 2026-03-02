import { getServiceClient } from './supabase';

export interface AddressLink {
  supra_address: string;
  evm_address: string | null;
  evm_signature: string | null;
  evm_verified_at: string | null;
  created_at: string;
}

export async function getAddressLink(supraAddress: string): Promise<AddressLink | null> {
  const db = getServiceClient();
  const { data } = await db.from('address_links').select('*').eq('supra_address', supraAddress).single();
  return data;
}

export async function upsertAddressLink(supraAddress: string, evmAddress: string, evmSignature: string): Promise<AddressLink> {
  const db = getServiceClient();
  const { data, error } = await db.from('address_links').upsert({
    supra_address: supraAddress,
    evm_address: evmAddress.toLowerCase(),
    evm_signature: evmSignature,
    evm_verified_at: new Date().toISOString(),
  }, { onConflict: 'supra_address' }).select().single();
  if (error) throw new Error(error.message);
  return data;
}
