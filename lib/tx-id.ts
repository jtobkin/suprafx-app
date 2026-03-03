// Generate a deterministic TX ID from RFQ display_id + taker address
// Returns TX-{8 hex chars}
export function generateTxId(rfqDisplayId: string, takerAddress: string): string {
  const input = `${rfqDisplayId}:${takerAddress}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // Convert to 8-char hex, handle negative
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `TX-${hex}`;
}
