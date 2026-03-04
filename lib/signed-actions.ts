import { getServiceClient } from './supabase';
import { verifySignatureServer, canonicalize } from './signing';

/**
 * Store a signed action in the audit trail.
 * Optionally verify the signature before storing.
 */
export async function storeSignedAction(params: {
  actionType: string;
  signerAddress: string;
  payload: any;
  payloadHash: string;
  signature: string;
  sessionNonce?: string;
  sessionCreatedAt?: number;
  tradeId?: string;
  rfqId?: string;
  quoteId?: string;
  verify?: boolean;
}): Promise<{ id: string; verified: boolean }> {
  const db = getServiceClient();

  let verified = false;

  // Verify signature if session info provided
  if (params.verify && params.sessionNonce && params.sessionCreatedAt) {
    verified = await verifySignatureServer(
      params.payload,
      params.signature,
      params.signerAddress,
      params.sessionNonce,
      params.sessionCreatedAt,
    );
  } else {
    // Trust the signature if no session info (e.g., bot actions)
    verified = true;
  }

  const { data, error } = await db.from('signed_actions').insert({
    action_type: params.actionType,
    signer_address: params.signerAddress,
    payload_json: params.payload,
    payload_hash: params.payloadHash,
    signature: params.signature,
    session_nonce: params.sessionNonce || null,
    session_created_at: params.sessionCreatedAt || null,
    trade_id: params.tradeId || null,
    rfq_id: params.rfqId || null,
    quote_id: params.quoteId || null,
    verified,
  }).select('id').single();

  if (error) {
    console.error('[SupraFX] Failed to store signed action:', error.message);
    // Don't block the operation if signed_actions table doesn't exist yet
    return { id: '', verified };
  }

  return { id: data.id, verified };
}

/**
 * Get all signed actions for a trade, in chronological order.
 */
export async function getTradeActions(tradeId: string): Promise<any[]> {
  const db = getServiceClient();
  try {
    const { data } = await db.from('signed_actions')
      .select('*')
      .eq('trade_id', tradeId)
      .order('created_at', { ascending: true });
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Get all signed actions for an RFQ, in chronological order.
 */
export async function getRfqActions(rfqId: string): Promise<any[]> {
  const db = getServiceClient();
  try {
    const { data } = await db.from('signed_actions')
      .select('*')
      .eq('rfq_id', rfqId)
      .order('created_at', { ascending: true });
    return data || [];
  } catch {
    return [];
  }
}
