import { getServiceClient } from './supabase';

/**
 * Resolve the settlement address for a given supra_address on a target chain.
 * 
 * For Supra chains: the supra_address itself is the settlement address.
 * For EVM chains: look up the linked EVM address from linked_addresses or address_links.
 * 
 * Returns null if no address is found for that chain.
 */
export async function resolveSettlementAddress(
  supraAddress: string,
  targetChain: string
): Promise<string | null> {
  // Supra chains: the identity address IS the settlement address
  if (targetChain === 'supra-testnet' || targetChain === 'supra') {
    return supraAddress;
  }

  // EVM chains: look up linked address
  const db = getServiceClient();

  // Try linked_addresses table first (new multi-address table)
  try {
    const { data: links } = await db.from('linked_addresses')
      .select('linked_address')
      .eq('supra_address', supraAddress)
      .eq('chain', targetChain)
      .limit(1);

    if (links?.length) return links[0].linked_address;
  } catch {}

  // Try with broader chain matching (e.g. "sepolia" matches "ethereum" EVM addresses)
  try {
    const { data: anyEvmLinks } = await db.from('linked_addresses')
      .select('linked_address')
      .eq('supra_address', supraAddress)
      .limit(1);

    if (anyEvmLinks?.length) return anyEvmLinks[0].linked_address;
  } catch {}

  // Fall back to legacy address_links table
  try {
    const { data: legacy } = await db.from('address_links')
      .select('evm_address')
      .eq('supra_address', supraAddress)
      .single();

    if (legacy?.evm_address) return legacy.evm_address;
  } catch {}

  return null;
}

/**
 * Resolve settlement addresses for both parties in a trade.
 * 
 * taker sends on source_chain → taker needs to send TO maker's source_chain address
 *   Wait... taker sends their source asset. The recipient is the maker on source_chain.
 * 
 * Actually:
 * - Taker sends on source_chain. Recipient = maker's address on source_chain.
 * - Maker sends on dest_chain. Recipient = taker's address on dest_chain.
 * 
 * So:
 * - taker_settlement_address = taker's address on dest_chain (where maker sends TO taker)
 * - maker_settlement_address = maker's address on source_chain (where taker sends TO maker)
 * 
 * Wait, let's think about this from the trade record perspective:
 * - When taker settles: they send on source_chain TO the maker. They need maker's source_chain address.
 * - When maker settles: they send on dest_chain TO the taker. They need taker's dest_chain address.
 * 
 * So the fields should store:
 * - taker_settlement_address: taker's address on dest_chain (so maker knows where to send)
 * - maker_settlement_address: maker's address on source_chain (so taker knows where to send)
 */
export async function resolveTradeAddresses(
  takerSupraAddress: string,
  makerSupraAddress: string,
  sourceChain: string,
  destChain: string
): Promise<{
  takerSettlementAddress: string | null;  // taker's addr on dest_chain (maker sends here)
  makerSettlementAddress: string | null;  // maker's addr on source_chain (taker sends here)
}> {
  const [takerOnDest, makerOnSource] = await Promise.all([
    resolveSettlementAddress(takerSupraAddress, destChain),
    resolveSettlementAddress(makerSupraAddress, sourceChain),
  ]);

  return {
    takerSettlementAddress: takerOnDest,
    makerSettlementAddress: makerOnSource,
  };
}
